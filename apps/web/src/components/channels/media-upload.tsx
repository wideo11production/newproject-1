'use client';

/**
 * MEDIA UPLOAD  -  the whole pipeline, from file pick to queued transcode.
 *
 * =============================================================================
 * WHY THIS IS A STATE MACHINE IN THE UI AND NOT A SPINNER
 * =============================================================================
 *
 * An upload here is five distinct things, and collapsing them into one
 * indeterminate "Uploading..." is how a user ends up believing the product is
 * broken when nothing is:
 *
 *   hashing   - SHA-256 of the file, so a re-upload skips the encode
 *   uploading - bytes browser -> MinIO, direct
 *   scanning  - ffprobe: is this even a decodable video?
 *   encoding  - the ffmpeg ladder (1080p/720p/480p/audio/reel, one pass)
 *   ready     - watchable
 *
 * Each is shown with its own wording, because "checking the file" and
 * "encoding" are things a user waits for differently - the first is seconds,
 * the second is minutes, and a user who is not told which is happening
 * reasonable assumes the second has hung.
 *
 * =============================================================================
 * THE BYTES NEVER PASS THROUGH THIS APP
 * =============================================================================
 *
 * `/api/media/initiate` returns a presigned MinIO PUT URL and the browser
 * uploads straight to it. See `@/lib/media-upload` for why that matters at all.
 *
 * The progress bar therefore tracks the MINIO transfer only, which is the part
 * the user is actually waiting on. Once the bar hits 100 the pipeline states
 * take over, and they are reported by polling - long jobs need a visible
 * "still working" rather than a spinner that never resolves.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileVideo,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { Card } from '@wideo11/ui/card';
import { Progress } from '@wideo11/ui/progress';
import { ModerationBadge } from './moderation-badge';
import { HoverVideoCard } from '@/components/HoverVideoCard';
import {
  MEDIA_STATUS_LABEL,
  MEDIA_ACCEPT_ATTR,
  MediaUploadError,
  formatBytes,
  formatDuration,
  pollAssetStatus,
  signedMediaUrl,
  uploadMedia,
  validateMediaFile,
  type MediaAsset,
  type MediaStatus,
} from '@/lib/media-upload';

export type UploadTarget = {
  id: string;
  label: string;
};

type Props = {
  /** Channels the caller owns, newest first. Optional: a creator may upload
   *  before they have a channel, and the file simply sits in their library. */
  channels?: UploadTarget[];
  /** `video` is the default. A reel keeps the vertical rendition and is the
   *  one subject to the 90 s / 9:16 budget. */
  defaultKind?: 'video' | 'reel' | 'audio';
    /** Called after an asset reaches `ready` or is deduped, so the caller can
     *  refresh its list. */
    onStored?: (asset: MediaAsset) => void;
    /** Files handed in from an OUTSIDE dropzone.
     *
     *  Optional, and adding it is not a convenience: the studio page has its own
     *  dashed drop box as the front door, and duplicating the presign -> PUT ->
     *  finalize chain to serve it would mean two copies of the pipeline, one of
     *  which would be tested. So the outside box forwards its files here.
     *
     *  When supplied, these take precedence over the component's own picker for
     *  as long as they are non-empty. */
    files?: File[];
    /** Called once every handed-in file has been queued, so the caller can clear
     *  its list. Without it the same files would be re-fed on the next render. */
    onQueued?: () => void;
  };

type Stage =
  | { kind: 'idle' }
  | { kind: 'hashing' }
  | { kind: 'uploading'; percent: number }
  | { kind: 'processing'; status: MediaStatus }
  | { kind: 'done'; asset: MediaAsset; reused: boolean }
  // ---- A failed UPLOAD, which is recoverable in the browser ----
  //
  // The previous upload in this session failed. No asset id is known yet, so
  // there is nothing to retry server-side and the honest action is "start over".
  | { kind: 'failed'; message: string }
  // ---- A failed ASSET, which is retryable and deletable ----
  //
  // A different and much more useful state: the bytes ARE stored, the row
  // exists, and the pipeline gave up on it (usually a transcode that ran out of
  // memory). `POST /:id/retry` re-queues the transcode against the SAME file -
  // no re-upload - and `DELETE /:id` drops the row and the bytes.
  //
  // The distinction from `failed` matters because the actions differ: one says
  // "upload again", the other says "we still have your file".
  | {
      kind: 'failed-asset';
      assetId: string;
      message: string;
      status?: MediaStatus;
    };

const KIND_LABEL: Record<string, string> = {
  video: 'Video',
  reel: 'Reel (9:16, under 90 s)',
  audio: 'Audio',
};

export function MediaUpload({
  channels = [],
  defaultKind = 'video',
  onStored,
  files,
  onQueued,
}: Props) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [kind, setKind] = useState<'video' | 'reel' | 'audio'>(defaultKind);
  const [channelId, setChannelId] = useState<string>('');
  const [hint, setHint] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // The in-flight upload's abort handle, so Cancel means cancel.
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Abort an in-flight upload on unmount. Without this, navigating away leaves
  // the PUT running against a component that no longer exists.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(
    async (file: File) => {
      // ---- Client-side feedback, before any round trip ----
      //
      // The server re-validates and the transcode re-validates by DECODING, so
      // these checks are convenience, not security. They exist so the user is
      // told now rather than after an upload they did not need to make.
      const invalid = validateMediaFile(file);
      if (invalid) {
        setStage({ kind: 'failed', message: invalid });
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setHint(null);
      setStage({ kind: 'hashing' });

      try {
        // Hashing is not a separate visible step the user cares about, so it is
        // reported as part of the upload beginning: the file has been accepted
        // and work has started.
        setStage({ kind: 'uploading', percent: 0 });

        const { asset, reused } = await uploadMedia({
          file,
          kind,
          channelId: channelId || undefined,
          // The hash is computed inside `uploadMedia` before the request, so
          // the 0% tick here covers the wait.
          onProgress: (percent) => setStage({ kind: 'uploading', percent }),
          onStatus: (status) => setStage({ kind: 'processing', status }),
          signal: controller.signal,
        });

        // A dedup hit means nothing was uploaded and nothing was encoded. The
        // asset is already `ready` - it is the SAME bytes as one already stored.
        if (reused) {
          setStage({ kind: 'done', asset, reused: true });
          setHint(
            'This exact file was already stored and encoded, so nothing was re-uploaded.'
          );
          onStored?.(asset);
          return;
        }

        // ---- Poll until the pipeline finishes ----
        //
        // `scanning` and `transcoding` are minutes-long on a real file. A
        // spinner that never resolves is indistinguishable from a broken
        // product, so the state is surfaced as it changes.
        setStage({ kind: 'processing', status: asset.status });
        const final = await pollAssetStatus(
          asset.id,
          (status) => setStage({ kind: 'processing', status }),
          controller.signal
        );

        setStage({ kind: 'done', asset: final, reused: false });
        if (final.status === 'failed') {
          // The bytes are stored and the row exists - only the pipeline gave up.
          // That is the `failed-asset` state, which offers RETRY (re-queue the
          // transcode against the same file) and DELETE, rather than the
          // `failed` state whose only next step is to upload the whole file again.
          setStage({
            kind: 'failed-asset',
            assetId: final.id,
            message:
              final.failure_reason ||
              'The file could not be processed. It may not be a valid video.',
            status: final.status,
          });
          return;
        }
        onStored?.(final);
      } catch (e) {
        if (controller.signal.aborted) {
          setStage({ kind: 'idle' });
          return;
        }
        setStage({
          kind: 'failed',
          message: e instanceof MediaUploadError ? e.message : 'The upload failed.',
        });
      } finally {
        abortRef.current = null;
      }
    },
    [channelId, kind, onStored]
  );

  const busy =
    stage.kind === 'hashing' ||
    stage.kind === 'uploading' ||
    stage.kind === 'processing';

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (busy) return;
      const file = e.dataTransfer.files?.[0];
      if (file) void start(file);
    },
    [busy, start]
  );

  // ---------------------------------------------------------------------------
  // RETRY and DELETE for a failed asset
  // ---------------------------------------------------------------------------
  //
  // Before these existed, a `failed` row was permanent. The bytes were fine in
  // the bucket, the transcode was cheap to redo, and the only route the UI
  // offered was re-uploading the whole file - which for a 4K source is a very
  // expensive way to say "try again".
  //
  // Both calls go through the BFF like every other authenticated request, so the
  // session cookie is attached server-side and the asset id never leaves it.
  const [assetBusy, setAssetBusy] = useState<'retry' | 'delete' | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);

  const retryAsset = useCallback(async (assetId: string) => {
    setAssetBusy('retry');
    setAssetError(null);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(assetId)}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = (await res.json().catch(() => ({}))) as {
        asset?: MediaAsset;
        transcode_queued?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setAssetError(
          body.message ??
            body.error ??
            'Could not queue the retry. The file is still stored.'
        );
        return;
      }
      // The row moved to `uploaded` and the transcode is queued against the SAME
      // bytes, so polling resumes from the pipeline rather than from the browser.
      if (body.asset) {
        setStage({ kind: 'processing', status: body.asset.status });
        const final = await pollAssetStatus(
          assetId,
          (status) => setStage({ kind: 'processing', status })
        );
        if (final.status === 'failed') {
          setStage({
            kind: 'failed-asset',
            assetId: final.id,
            message:
              final.failure_reason || 'The retry could not process the file.',
            status: final.status,
          });
          return;
        }
        setStage({ kind: 'done', asset: final, reused: false });
        onStored?.(final);
      }
    } catch {
      setAssetError('Could not reach the server. The file is still stored.');
    } finally {
      setAssetBusy(null);
    }
  }, [onStored]);

  // ---- files handed in from an outside dropzone ----
  //
  // Sequentially, not all at once: `start` drives one file through hash ->
  // presign -> PUT -> finalize -> transcode, and two of those in flight would
  // race on `stage` and leave one asset with no progress to report.
  //
  // `onQueued` is called at the END so the caller can clear its list. Clearing
  // from inside the loop would make `files` empty while the loop still runs, and
  // the effect would re-run on the next render with nothing in it.
  useEffect(() => {
    if (!files || files.length === 0) return;
    let abandoned = false;

    (async () => {
      for (const file of files) {
        // Bail the moment the parent changes its mind; an upload the viewer has
        // navigated away from is an upload nobody is watching.
        if (abandoned) return;
        await start(file);
      }
      if (!abandoned) onQueued?.();
    })();

    return () => {
      abandoned = true;
    };
  }, [files, start, onQueued]);

  const deleteAsset = useCallback(async (assetId: string) => {
    setAssetBusy('delete');
    setAssetError(null);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(assetId)}`, {
        method: 'DELETE',
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setAssetError(body.message ?? 'Could not remove the upload.');
        return;
      }
      setStage({ kind: 'idle' });
      setHint('The failed upload was removed.');
    } catch {
      setAssetError('Could not reach the server.');
    } finally {
      setAssetBusy(null);
    }
  }, []);

  return (
    <Card className="p-5 space-y-4">
      {/* ---- Kind + channel ----
          Both chosen BEFORE the file, because the server needs to know at
          `initiate`: the kind decides which entitlement quota is checked (a
          reel and a 4-hour upload are not interchangeable uses of one cap), and
          the channel decides where the asset appears publicly. */}
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Type</span>
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={kind}
            disabled={busy}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">
            Channel <span className="text-xs">(optional)</span>
          </span>
          <select
            className="h-9 min-w-[180px] rounded-md border bg-background px-2 text-sm"
            value={channelId}
            disabled={busy}
            onChange={(e) => setChannelId(e.target.value)}
          >
            <option value="">No channel (library only)</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ---- Drop zone ----
          A hidden input driven by the label, so the whole area is a target and
          the button is a convenience for anyone who would rather click. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          'relative rounded-md border-0 border-dashed border-[#2a2a2a] p-8 text-center transition-colors',
          dragging ? 'border-[#ff6500] bg-[#ff6500]/5' : '',
          busy ? 'opacity-60' : 'hover:border-[#ff6500]/50',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept={MEDIA_ACCEPT_ATTR}
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset the input so picking the same file twice still fires - a
            // change event does not fire when the value is "unchanged".
            e.target.value = '';
            if (file) void start(file);
          }}
        />

        {stage.kind === 'idle' && (
          <>
            <FileVideo className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">Drop a video, reel or audio file here</p>
            <p className="mt-1 text-xs text-muted-foreground">
              MP4, WebM, MOV, MKV, MP3, WAV · no size limit
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              Choose a file
            </Button>
          </>
        )}

        {stage.kind === 'hashing' && (
          <Processing label="Preparing the file" />
        )}

        {stage.kind === 'uploading' && (
          <div className="space-y-3">
            <Processing label="Uploading" />
            <Progress value={stage.percent} className="mx-auto max-w-sm" />
            <p className="text-xs text-muted-foreground">{stage.percent}%</p>
          </div>
        )}

        {stage.kind === 'processing' && (
          <div className="space-y-2">
            <Processing label={MEDIA_STATUS_LABEL[stage.status]} />
            <p className="text-xs text-muted-foreground">
              {stage.status === 'transcoding'
                ? 'Encoding every quality once, in a single pass. This takes a few minutes.'
                : 'This takes a moment.'}
            </p>
          </div>
        )}

        {stage.kind === 'done' && (
          <div className="space-y-2">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
            <p className="text-sm font-medium">
              {stage.reused ? 'Already stored — nothing re-uploaded' : 'Uploaded'}
            </p>
            <p className="text-xs text-muted-foreground">
              {stage.asset.filename}
              {stage.asset.duration_seconds
                ? ` · ${formatDuration(stage.asset.duration_seconds)}`
                : ''}
              {stage.asset.width && stage.asset.height
                ? ` · ${stage.asset.width}x${stage.asset.height}`
                : ''}
            </p>

            {/* ---- The moderation badge ----
                Without this, a creator whose upload is held sees a green
                "Uploaded" and then silently cannot find it on their channel page.
                The backend withholds it correctly, which is the wrong experience:
                the creator concludes the upload failed.

                So the three withheld states are named here, with the reason from
                the server, and the wording is about what happens next rather than
                about the violation. */}
            <ModerationBadge asset={stage.asset} />

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                setStage({ kind: 'idle' });
                setHint(null);
              }}
            >
              Upload another
            </Button>
          </div>
        )}

        {stage.kind === 'failed' && (
          <div className="space-y-2">
            <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
            <p className="text-sm font-medium text-destructive">Upload failed</p>
            <p className="mx-auto max-w-md text-xs text-muted-foreground">{stage.message}</p>
            {/* A retry is offered rather than a dead end: most failures here
                are transient (a dropped connection), and making the user
                re-navigate to retry is a needless cost. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setStage({ kind: 'idle' })}
            >
              Try again
            </Button>
          </div>
        )}

        {/* ---- A failed ASSET: retry without re-uploading ----
            The bytes are stored and the row exists; only the pipeline gave up.
            The two actions here are the whole point of the `POST /:id/retry`
            and `DELETE /:id` endpoints that back them. */}
        {stage.kind === 'failed-asset' && (
          <div className="space-y-2">
            <AlertCircle className="mx-auto h-10 w-10 text-amber-500" />
            <p className="text-sm font-medium">Processing failed</p>
            {/* The reason first, in full. A creator who spent an hour editing
                needs to know what broke before being offered a button. */}
            <p className="mx-auto max-w-md text-xs text-muted-foreground">
              {stage.message}
            </p>
            <p className="mx-auto max-w-md text-xs text-muted-foreground">
              Your file is safely stored. You can retry encoding without
              uploading it again.
            </p>

            {assetError && (
              <p className="mx-auto max-w-md text-xs text-destructive">{assetError}</p>
            )}

            <div className="mt-3 flex items-center justify-center gap-2">
              {/* disabled:opacity-50 disabled:pointer-events-none during the
                  call, so a double-click cannot queue two transcodes for one
                  asset. */}
              <Button
                type="button"
                size="sm"
                disabled={assetBusy !== null}
                onClick={() => void retryAsset(stage.assetId)}
                className="disabled:opacity-50 disabled:pointer-events-none"
              >
                {assetBusy === 'retry' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Retry encoding
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={assetBusy !== null}
                onClick={() => void deleteAsset(stage.assetId)}
                className="disabled:opacity-50 disabled:pointer-events-none"
              >
                {assetBusy === 'delete' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Remove
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ---- Cancel + hints ----
          Cancel only exists while something is genuinely in flight. Rendering
          it greyed-out during `idle` invites a click that does nothing. */}
      {busy && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => abortRef.current?.abort()}
        >
          <X className="mr-2 h-4 w-4" />
          Cancel upload
        </Button>
      )}

      {hint && stage.kind === 'done' && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}

      {/* The bytes-never-pass-through-it line, stated once and up front. It is
          the single most surprising thing about this flow to a creator who has
          used tools that upload through the app server. */}
      <p className="text-xs text-muted-foreground">
        Your file is uploaded straight to storage — it never passes through our servers.
      </p>
    </Card>
  );
}

function Processing({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

/** Compact list of what the caller already has, so the uploader is not the
 *  only thing on the screen. */
export function MediaLibrary({ 
  assets, 
  onDelete,
}: { 
  assets: MediaAsset[]; 
  onDelete?: (assetId: string) => void;
}) {
  // The poster needs a SIGNED url: the `video` bucket is private, so the object
  // path stored on the asset is not directly fetchable. Resolved here per asset
  // rather than in the parent, because the parent would need to hold one
  // pending request per row to do the same thing.
  const [posters, setPosters] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    const load = async () => {
      for (const a of assets) {
        if (a.status !== 'ready') continue;
        // The poster is derivable from the asset prefix; ask for it by name.
        const url = await signedMediaUrl(a.id, 'poster.jpg');
        if (alive && url) setPosters((prev) => ({ ...prev, [a.id]: url }));
      }
    };
    void load();
    return () => {
      alive = false;
    };
    // `assets` is a fresh array from each poll, so re-running is by design.
  }, [assets]);

  if (assets.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nothing uploaded yet.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {assets.map((a) => (
        <div key={a.id} className="group">
          {a.status === 'ready' && a.hls_url && (
            <HoverVideoCard
              src={a.hls_url}
              poster={posters[a.id]}
              title={a.filename}
              duration={a.duration_seconds}
              aspect={a.kind === 'reel' ? '9:16' : a.kind === 'audio' ? '1:1' : '16:9'}
              showDelete={!!onDelete}
              onDelete={() => onDelete?.(a.id)}
            />
          )}
          {a.status !== 'ready' && (
            <div className="flex items-center gap-3 py-3">
              {posters[a.id] ? (
                <img
                  src={posters[a.id]}
                  alt=""
                  className="h-10 w-16 rounded object-cover"
                />
              ) : (
                <div className="flex h-10 w-16 items-center justify-center rounded bg-muted">
                  <FileVideo className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{a.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(a.bytes || a.declared_bytes)}
                  {a.duration_seconds ? ` · ${formatDuration(a.duration_seconds)}` : ''}
                  {a.width && a.height ? ` · ${a.width}x${a.height}` : ''}
                </p>
              </div>
              <span className="text-xs capitalize text-muted-foreground">
                {MEDIA_STATUS_LABEL[a.status]}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

