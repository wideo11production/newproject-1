'use client';

/**
 * CHANNEL COVER UPLOADER  -  real file upload to self-hosted MinIO
 *
 * ---- WHY 3 STEPS (and not a plain form post) ----
 * File BYTES kabhi app server par nahi aate:
 *   1. `POST /api/channels/:id/cover/upload-url` -> presigned MinIO PUT URL
 *   2. browser seedha `PUT uploadUrl` (bytes -> MinIO, straight from browser)
 *   3. `POST /api/channels/:id/cover/finalize`   -> magic-bytes verify, and
 *      the server saves `cover_url` onto the channel itself
 *
 * The three steps themselves live in `lib/channel-cover-upload.ts`. They used to
 * be written out here as well, and the two copies disagreed - see that file's
 * header for how the create-time copy ended up reading `ticket.upload_url` while
 * the server sends `uploadUrl`, and why the create path failed 100% of the time
 * while this one always worked.
 *
 * ---- DIFFERENCES FROM AvatarUploader (deliberate, not accidental) ----
 *  1. Rectangular 16:9 preview, not a circle. A cover is a wide banner;
 *     forcing it into `rounded-full` would crop it to nothing.
 *  2. No local size constant. The limit comes from the server's own `maxBytes`,
 *     so this component cannot disagree with the rule that is enforced.
 *  3. NO `onUploaded` persist step. The finalize endpoint writes `cover_url`
 *     itself, unlike avatars where the client must PATCH the profile. This is
 *     why this component takes `channelId` and not a save callback.
 */

import { useCallback, useRef, useState } from 'react';
import { Image as ImageIcon, Upload, X } from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { COVER_ACCEPTED, uploadChannelCover } from '@/lib/channel-cover-upload';

type Props = {
  /** Which channel this cover belongs to */
  channelId: string;
  /** Current cover URL (existing, from the API) */
  currentUrl?: string;
  /** Fires after a successful upload so the parent can refresh its list */
  onUploaded: (publicUrl: string) => Promise<void> | void;
};

export function CoverUploader({ channelId, currentUrl, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Object URL track karte hain taki revoke kar sakein (memory leak nahi)
  const objectUrlRef = useRef<string | null>(null);

  const setPreviewSafely = useCallback((url: string | null) => {
    // Purana object URL revoke karo - warna memory leak
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (url) objectUrlRef.current = url;
    setPreview(url);
  }, []);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      setBusy(true);
      setProgress(0);

      try {
        const publicUrl = await uploadChannelCover({
          file,
          scope: { channelId },
          onProgress: setProgress,
        });
        // Step 4: parent ko refresh karne do
        await onUploaded(publicUrl);
        setProgress(100);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed. Please retry.');
      } finally {
        setBusy(false);
      }
    },
    [channelId, onUploaded]
  );

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Turant local preview dikhao (upload start hone se pehle hi feedback)
    setPreviewSafely(URL.createObjectURL(file));
    void upload(file);
    // Same file dobara select karne par change event na fire ho - isliye reset
    e.target.value = '';
  }

  const shown = preview ?? currentUrl;
  // unique id per instance - do channels ek page pe ho to duplicate DOM ids nahi
  const inputId = `cover-file-input-${channelId}`;

  return (
    <div className="space-y-2">
      {/* 16:9 banner preview */}
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-[#0d0f11]">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shown}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center">
            <ImageIcon className="h-2.5 w-2.5 text-[#9fa7b3]" aria-hidden="true" />
            <p className="mt-1 text-[11px] text-[#9fa7b3]">No cover image</p>
          </div>
        )}

        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#111217]/85 text-xs font-bold text-white">
            {progress}%
          </div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        {/* `hidden` + label ke zaroori `htmlFor` se native file dialog khulta hai */}
        <input
          ref={inputRef}
          type="file"
          accept={COVER_ACCEPTED.join(',')}
          onChange={onPick}
          data-track={`channel-cover-${channelId}`}
          className="hidden"
          id={inputId}
        />

        {busy ? (
          <div className="space-y-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1f2227]">
              <div
                className="h-full rounded-full bg-[#5794f2] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[11px] text-[#9fa7b3]">Uploading {progress}%…</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor={inputId}
              className="inline-flex h-9 cursor-pointer items-center rounded-md bg-[#1f2227] px-3 text-sm text-[#d8d9da] transition-colors hover:bg-[#2c3235] focus-within:ring-2 focus-within:ring-[#5794f2]/50"
            >
              <Upload className="mr-1.5 h-2.5 w-2.5" aria-hidden="true" />
              {preview || currentUrl ? 'Replace cover' : 'Upload cover'}
            </label>

            {/* Local preview hatao (server par already save nahi hua) */}
            {preview && !busy ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPreviewSafely(null);
                  setProgress(0);
                  setError(null);
                }}
                className="h-9 px-2 text-[#9fa7b3] hover:text-[#d8d9da]"
                aria-label="Clear selection"
              >
                <X className="h-2.5 w-2.5" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        )}

        <p className="mt-1 text-[11px] text-[#9fa7b3]">
          PNG, JPEG or WebP. Under 4 MB. Stored on your own server.
        </p>

        {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      </div>
    </div>
  );
}

export default CoverUploader;
