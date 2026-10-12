/**
 * THE media upload flow. One implementation, every caller.
 *
 * =============================================================================
 * WHY THE FILE NEVER TOUCHES OUR SERVERS
 * =============================================================================
 *
 *   1. POST /api/media/initiate   -> asset row + presigned MinIO PUT URL
 *   2. browser -> MinIO DIRECTLY. The BYTES NEVER PASS THROUGH NEXT.JS OR GO.
 *   3. POST /api/media/:id/finalize -> marks `uploaded`, queues the transcode
 *
 * Step 2 going straight to the object store is not an optimisation. An 8 GB
 * upload through a Go handler would hold a request open for minutes, tie up a
 * worker for the whole transfer, and make the retry story hopeless - a dropped
 * connection at 90% loses the upload entirely. The browser retries against the
 * same key instead.
 *
 * =============================================================================
 * THE THREE STEPS ARE A STATE MACHINE, NOT A BOOLEAN
 * =============================================================================
 *
 * The asset moves `initiated -> uploaded -> scanning -> transcoding -> ready`.
 * A poller watches it, because the transcoder works asynchronously and a
 * "pending" that never reports would be indistinguishable from a broken
 * product. Each state is surfaced to the user with its own wording.
 *
 * =============================================================================
 * WHAT IS CHECKED WHERE
 * =============================================================================
 *
 * Client-side checks below are FEEDBACK, not security. The server re-validates
 * at `initiated`, the quota is checked server-side before a URL is minted, and
 * the transcode re-validates by DECODING the file - a `.html` file renamed
 * `.mp4` dies at the ffprobe stage. The client checks exist so the user is told
 * immediately instead of after an upload they did not need to make.
 *
 * The one thing the client is trusted with is the FILENAME and the hash, and
 * only as claims - the object key is minted server-side from the caller's user
 * id, so no client can write outside its own prefix.
 */

/** What the server returns from `POST /api/media/initiate`. */
export type MediaTicket = {
  asset: MediaAsset;
  upload?: {
    object_key: string;
    upload_url: string;
    method: string;
    content_type: string;
    expires_in_seconds: number;
  };
  /** True when the exact same file was already stored and encoded, so no
   *  bytes moved at all and no transcode was needed (SYSTEM-PLAN §5.3). */
  reused?: boolean;
  reused_from?: string;
  note?: string;
  message?: string;
};

/** The asset row, as the server models it. */
export type MediaAsset = {
  id: string;
  user_id: string;
  channel_id?: string;
  /** Channel display name as it was set. Missing on rows that predate the field. */
  channel_name?: string | null;
  kind: 'video' | 'reel' | 'audio';
  filename: string;
  content_type: string;
  declared_bytes: number;
  declared_duration_seconds: number;
  bytes: number;
  duration_seconds: number;
  width: number;
  height: number;
  has_audio: boolean;
  object_key?: string;
  public_url?: string;
  poster_public_url?: string;
  hls_url?: string;
  /** initiated | uploaded | scanning | transcoding | ready | failed */
  status: MediaStatus;
  failure_reason?: string;
  created_at: string;
  expires_at?: string;
  // ---- Content moderation (migration 030) ----
  //
  // A separate axis from `status`: `ready` means the file decoded, and this is the
  // POLICY verdict. `ready` alone does not make a video visible on the channel
  // page - `moderation_status === 'approved'` is also required, and the backend
  // filter is what actually withholds it.
  //
  // The type mirrors the backend constants. `not_required` is for technical assets
  // (audio stems, posters) that are never screened.
  moderation_status?:
    | 'not_required'
    | 'pending_review'
    | 'approved'
    | 'rejected'
    | 'flagged';
  // When the owner released this to the video page. A SECOND state, not a synonym
  // for an approved moderation verdict: screening answers "is it safe", this
  // answers "did the owner confirm and choose to publish" - and the record of that
  // confirmation is the only proof the responsibility was accepted.
  published_at?: string | null;
  moderation_reason?: string;
  moderation_score?: number;
};

export type MediaStatus =
  | 'initiated'
  | 'uploaded'
  | 'scanning'
  | 'transcoding'
  | 'ready'
  | 'failed';

/**
 * The server's own content-type allowlist.
 *
 * An allowlist, not a denylist: a denylist has to be updated every time
 * something new turns out to be dangerous, and the thing that turns out to be
 * dangerous is always the thing nobody thought of.
 */
export const MEDIA_ACCEPTED: Record<string, string[]> = {
  'video/mp4': ['.mp4', '.m4v'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
  'video/x-matroska': ['.mkv'],
  'audio/mpeg': ['.mp3'],
  'audio/wav': ['.wav'],
};

/** Everything a file input can offer, as one `accept` attribute. */
export const MEDIA_ACCEPT_ATTR =
  '.mp4,.m4v,.webm,.mov,.mkv,.mp3,.wav,video/*,audio/*';

/** The server's own caps (SYSTEM-PLAN §5.2). A hardcoded copy of a server rule
 *  is how the cover-upload path came to allow 6 MB against a 4 MB limit; these
 *  are transport hints and the server is the authority.
 *
 *  MAX_MEDIA_BYTES / MAX_REEL_BYTES used to be 8 GB and 512 MB. Neither was ever
 *  enforced anywhere - not in this file's validators, not in the service, and the
 *  Go constants that named the same numbers were dead code. What they were was a
 *  LIMIT PRINTED IN THE UI: the upload panel told a creator their clip could be
 *  at most 8 GB, which was a rule nobody was applying.
 *
 *  Uploading is free and unlimited for every plan now, so the number is gone
 *  rather than raised. A ceiling that does not exist should not be described.
 *
 *  The format allowlist below still exists, because THAT is enforced. */
export const MEDIA_HAS_NO_SIZE_LIMIT = true;

/** Thrown for every failure, so a caller only needs one catch. */
export class MediaUploadError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'MediaUploadError';
    this.status = status;
  }
}

/**
 * SHA-256 of the file bytes, as a lowercase hex string.
 *
 * This is what makes re-upload dedup possible: the file goes browser -> MinIO
 * directly, so the server never sees it. A hash is the only thing that can say
 * "this is the file I already have" - and if it matches, the server hands back
 * the renditions that already exist instead of encoding them again.
 *
 * WebCrypto's `digest` is one-shot - there is no incremental API - so the file
 * is read whole. For an 8 GB source that may exceed the tab's memory, and that
 * is handled by returning `''` rather than throwing: a missing hash costs the
 * optimisation, never the upload, and an upload is always possible.
 *
 * Returns `''` when WebCrypto is unavailable, when the read fails, or when the
 * caller aborts. All three mean "no claim was made", and the server takes the
 * slow path.
 */
export async function hashFile(file: File, signal?: AbortSignal): Promise<string> {
  try {
    if (!globalThis.crypto?.subtle) return '';
    if (signal?.aborted) return '';

    const buf = await file.arrayBuffer();
    if (signal?.aborted) return '';

    const out = await crypto.subtle.digest('SHA-256', buf);
    const bytes = new Uint8Array(out);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    return '';
  }
}

/** Cheap client-side feedback, mirroring the server's allowlist. */
export function validateMediaFile(file: File): string | null {
  const type = file.type.split(';')[0].trim().toLowerCase();
  const exts = MEDIA_ACCEPTED[type];
  if (!exts) {
    return 'Unsupported file type. Use MP4, WebM, MOV, MKV, MP3 or WAV.';
  }
  const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
  if (!exts.includes(ext)) {
    return `A .${ext.replace('.', '')} file cannot be ${type}.`;
  }
  return null;
}

export type UploadMediaOptions = {
  file: File;
  /** File the asset under a channel so it appears on that channel's page. */
  channelId?: string;
  kind?: 'video' | 'reel' | 'audio';
  /** 0-100, reported on every tick of the byte transfer. */
  onProgress?: (percent: number) => void;
  /** Called when the asset's state changes as the pipeline works. */
  onStatus?: (status: MediaStatus) => void;
  signal?: AbortSignal;
};

export type MediaUploadResult = {
  asset: MediaAsset;
  reused: boolean;
};

/**
 * Upload a media file all the way to a transcode being queued.
 *
 * Resolves once the file is stored and the transcode is queued. It does NOT
 * wait for the transcode to finish - that is a long, asynchronous job, and the
 * caller should poll `pollAssetStatus` for `ready`.
 */
export async function uploadMedia({
  file,
  channelId,
  kind = 'video',
  onProgress,
  onStatus,
  signal,
}: UploadMediaOptions): Promise<MediaUploadResult> {
  const fail = (message: string, status = 0) => {
    throw new MediaUploadError(message, status);
  };

  // ---- 0. Cheap checks, before any round trip ----
  const invalid = validateMediaFile(file);
  if (invalid) fail(invalid);

  // ---- 1. Content hash, in parallel with the request prep ----
  //
  // Off the critical path for the user: the initiate request is fired as soon
  // as the hash is ready, and if hashing fails the upload still proceeds
  // without the optimisation.
  const contentHash = await hashFile(file, signal);
  if (signal?.aborted) fail('Upload cancelled.');

  // ---- 2. Initiate: quota check + asset row + presigned PUT ----
  let res: Response;
  try {
    res = await fetch('/api/media/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        filename: file.name,
        content_type: file.type,
        declared_bytes: file.size,
        channel_id: channelId,
        content_hash: contentHash,
      }),
      signal,
    });
  } catch {
    fail('Could not reach the upload service. Check your connection.');
  }

  const ticket = (await res!.json().catch(() => ({}))) as MediaTicket;
  if (!res!.ok) {
    fail(ticket?.message ?? 'Could not start the upload.', res!.status);
  }

  // ---- 2b. Re-upload dedup: the file is already stored and encoded ----
  //
  // Nothing to upload, nothing to transcode. This is the whole point of the
  // hash - a creator who fixes a title and re-uploads should not pay a second
  // ffmpeg pass for identical output.
  if (ticket.reused || !ticket.upload) {
    onProgress?.(100);
    onStatus?.(ticket.asset?.status ?? 'ready');
    return { asset: ticket.asset, reused: true };
  }

  // ---- 3. PUT the bytes straight to MinIO ----
  //
  // XMLHttpRequest, not fetch: `fetch` has no upload progress, and this is a
  // potentially multi-gigabyte transfer on an unknown connection.
  try {
    await new Promise<void>((ok, no) => {
      const xhr = new XMLHttpRequest();
      xhr.open(ticket.upload!.method ?? 'PUT', ticket.upload!.upload_url, true);
      // MUST be byte-identical to what the URL was signed with, or MinIO
      // rejects the PUT and the error reads as a network fault.
      xhr.setRequestHeader('Content-Type', ticket.upload!.content_type || file.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? ok()
          : no(new MediaUploadError(`The file did not upload (${xhr.status}).`, xhr.status));
      xhr.onerror = () => no(new MediaUploadError('Network error during upload.'));
      xhr.onabort = () => no(new MediaUploadError('Upload cancelled.'));
      if (signal) {
        if (signal.aborted) {
          xhr.abort();
          return;
        }
        signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }
      xhr.send(file);
    });
  } catch (e) {
    fail(e instanceof Error ? e.message : 'The file did not upload.');
  }

  if (signal?.aborted) fail('Upload cancelled.');

  // ---- 4. Finalize: mark `uploaded`, queue the transcode ----
  let fin: Response;
  try {
    fin = await fetch(`/api/media/${ticket.asset.id}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
    });
  } catch {
    fail('The file uploaded but could not be registered. Please retry.');
  }

  const body = (await fin!.json().catch(() => ({}))) as {
    asset?: MediaAsset;
    message?: string;
  };
  if (!fin!.ok || !body.asset) {
    fail(body?.message ?? 'The file uploaded but could not be registered.', fin!.status);
  }

  onProgress?.(100);
  onStatus?.(body.asset!.status);
  return { asset: body.asset!, reused: false };
}

/**
 * Poll an asset until it leaves the pipeline.
 *
 * `scanning` and `transcoding` are long, and a UI that shows a spinner forever
 * is indistinguishable from a broken product. This resolves on any TERMINAL
 * state (`ready` or `failed`) so the caller can show the outcome, and rejects
 * only on a transport failure - never on a failed transcode, which is a valid
 * outcome the user needs to see.
 */
export async function pollAssetStatus(
  assetId: string,
  onStatus?: (status: MediaStatus) => void,
  signal?: AbortSignal
): Promise<MediaAsset> {
  const deadlined = Date.now() + 30 * 60 * 1000;
  let delay = 2000;

  for (;;) {
    if (signal?.aborted) throw new MediaUploadError('Cancelled.');
    if (Date.now() > deadlined) {
      throw new MediaUploadError('The video is still processing after 30 minutes. Check back later.');
    }

    const res = await fetch(`/api/media/${assetId}`, { signal, cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as { asset?: MediaAsset };
    const asset = body.asset;
    if (!res.ok || !asset) {
      throw new MediaUploadError('Could not read the upload status.', res.status);
    }

    onStatus?.(asset.status);
    if (asset.status === 'ready' || asset.status === 'failed') return asset;

    await new Promise((r) => setTimeout(r, delay));
    // Back off up to 8s. A 2s poll on an 8 GB file would hit the endpoint
    // hundreds of times for a job that takes minutes.
    delay = Math.min(delay * 1.5, 8000);
  }
}

/** Human wording for each pipeline state. */
export const MEDIA_STATUS_LABEL: Record<MediaStatus, string> = {
  initiated: 'Waiting for upload',
  uploaded: 'Uploaded',
  scanning: 'Checking the file',
  transcoding: 'Encoding',
  ready: 'Ready',
  failed: 'Failed',
};

/**
 * Resolve a relative path inside an asset to a short-lived signed URL.
 *
 * The `video` bucket is PRIVATE by design, so a plain `poster_public_url` or
 * `hls_url` returns `AccessDenied` for everyone - including the uploader. Every
 * media URL the app renders therefore goes through here, which asks
 * auth-service to sign it for the caller's own session.
 *
 * The response is short-lived (the presign TTL) and never cached: a URL that
 * outlived its signature would 403, and a stale one is worse than a fresh
 * request.
 *
 * Resolves to `null` rather than throwing, because a missing poster should show
 * a placeholder, not break the whole list.
 */
export async function signedMediaUrl(
  assetId: string,
  path: string,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/media/${encodeURIComponent(assetId)}/signed-url?path=${encodeURIComponent(path)}`,
      { cache: 'no-store', signal }
    );
    const body = (await res.json().catch(() => ({}))) as { url?: string };
    return res.ok && typeof body.url === 'string' ? body.url : null;
  } catch {
    return null;
  }
}

export function formatBytes(n: number): string {
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
