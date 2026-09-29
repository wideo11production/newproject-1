'use client';

/**
 * ============================================================================
 * AVATAR UPLOADER  -  real file upload to self-hosted MinIO
 * ============================================================================
 *
 * REQUIREMENT: "profile image upload" - pehle sirf URL paste box tha.
 *
 * ---- WHY 3 STEPS (and not a plain form post) ----
 * File BYTES kabhi app server par nahi aate:
 *   1. `POST /avatar/upload-url`  -> presigned MinIO PUT URL
 *   2. browser seedha `PUT uploadUrl` (bytes -> MinIO)
 *   3. `POST /avatar/finalize`    -> magic-bytes verify + public URL
 * Isse upload par app-server load ZERO rehta hai. Chhoti avatars ke liye
 * bhi scalable.
 *
 * ---- PROGRESS UI ----
 * `XMLHttpRequest` use kiya hai (fetch nahi) kyunke `fetch` me upload
 * progress nahi milti, aur user ko "kitna upload hua" dikhana zaroori hai -
 * warna 5MB ke liye screen par kuch nahi hota aur user dobara click kar
 * deta hai.
 *
 * ---- CLIENT-SIDE CHECKS (UX ke liye, security ke liye NAHI) ----
 * Size aur type yahan check hote hain taki user ko turant feedback mile.
 * ASLI security server par hai - magic bytes verify backend me hota hai.
 * Agar client check na bhi ho, tab bhi server reject karega.
 *
 * Hinglish comments: har block ka arth
 */

import { useCallback, useRef, useState } from 'react';
import { Upload, Loader2, X } from 'lucide-react';
import { Button } from '@wideo11/ui/button';

type Props = {
  /** Current avatar URL (existing) */
  currentUrl?: string;
  /** Initials fallback jab avatar na ho */
  initials?: string;
  /** Save hone ke baad call hota hai - parent DB me persist karta hai */
  onUploaded: (publicUrl: string) => Promise<void> | void;
};

const MAX_BYTES = 5 * 1024 * 1024; // 5MB - backend ka limit bhi yahi hai
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function AvatarUploader({ currentUrl, initials, onUploaded }: Props) {
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
    (file: File) => {
      setError(null);
      setBusy(true);
      setProgress(0);

      // ---- CLIENT PRE-CHECKS (UX, not security) ----
      if (!ACCEPTED.includes(file.type)) {
        setError('Please choose a PNG, JPEG, WebP or GIF image.');
        setBusy(false);
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`Image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 5 MB.`);
        setBusy(false);
        return;
      }

      // ---- STEP 1: presigned URL ----
      (async () => {
        try {
          const urlRes = await fetch('/api/auth/avatar/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type,
            }),
          });
          const ticket = await urlRes.json().catch(() => ({}));
          if (!urlRes.ok) {
            setError(ticket?.message ?? 'Could not start the upload.');
            setBusy(false);
            return;
          }

          // ---- STEP 2: PUT bytes DIRECTLY to MinIO ----
          // NOTE: `Content-Type` EXACTLY wahi hona chahiye jo signed URL me
          // hai (backend ne bheja tha). Galat bheja to MinIO reject karega.
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', ticket.uploadUrl, true);
            xhr.setRequestHeader('Content-Type', ticket.contentType);

            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                setProgress(Math.round((e.loaded / e.total) * 100));
              }
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) resolve();
              else reject(new Error(`Upload failed (${xhr.status})`));
            };
            xhr.onerror = () => reject(new Error('Network error during upload.'));
            xhr.send(file);
          });

          // ---- STEP 3: finalize (server magic bytes verify karta hai) ----
          const finRes = await fetch('/api/auth/avatar/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ objectKey: ticket.objectKey }),
          });
          const final = await finRes.json().catch(() => ({}));
          if (!finRes.ok) {
            setError(final?.message ?? 'That file is not a valid image.');
            setBusy(false);
            return;
          }

          // ---- STEP 4: parent ko persist karne do ----
          await onUploaded(final.publicUrl);
          setProgress(100);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : 'Upload failed. Please retry.'
          );
        } finally {
          setBusy(false);
        }
      })();
    },
    [onUploaded]
  );

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Turant local preview dikhao (upload start hone se pehle hi feedback)
    setPreviewSafely(URL.createObjectURL(file));
    upload(file);
    // Same file dobara select karne par change event na fire ho - isliye reset
    e.target.value = '';
  }

  const shown = preview ?? currentUrl;

  // ---- Duplicate avatar circle ko rokna ----
  // Jab koi file select nahi hui aur upload chal nahi raha, to uploader ka
  // apna preview circle REDUNDANT ho jata hai - kyunki uske theek upar (ya
  // aage) bada avatar pehle se dikh raha hota hai. Do circles ek saath dekhne
  // se UI awkward lagta tha (screenshot me yahi dikha).
  //
  // Isliye circle TABHI dikhate hain jab wo actually kuch naya dikha raha ho:
  //   - user ne file select ki (local preview), ya
  //   - upload chal raha hai (progress ke saath)
  // Warna sirf "Upload / Replace" button bacha rehta hai - clean.
  const showCircle = busy || preview !== null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        {/* ---- Preview circle (conditional - duplicate se bachata hai) ----
            Local preview (object URL) upload ke dauraan instant feedback
            deta hai; finalize ke baad real public URL use hota hai. */}
        {showCircle ? (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-[#2c3235] bg-[#0d0f11]">
            {shown ? (
              <img src={shown} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-bold text-[#5794f2]">
                {initials || '?'}
              </div>
            )}

            {/* Upload progress overlay */}
            {busy ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#111217]/85 text-[10px] font-bold text-white">
                {progress}%
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          {/* ---- Pick button ----
              `hidden` + label ke zaroori `htmlFor` se native file dialog
              khulta hai, styling button jaisi rehti hai. Ye cross-browser
              sabse reliable tarika hai. */}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(',')}
            onChange={onPick}
            className="hidden"
            id="avatar-file-input"
          />

          {busy ? (
            <div className="space-y-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1f2227]">
                <div
                  className="h-full rounded-full bg-[#5794f2] transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[11px] text-[#9fa7b3]">
                Uploading {progress}%…
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="avatar-file-input"
                className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-[#1f2227] px-3 text-sm text-[#d8d9da] transition-colors hover:bg-[#2c3235] focus-within:ring-2 focus-within:ring-[#5794f2]/50"
              >
                {preview || currentUrl ? (
                  <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
                ) : (
                  <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
                )}
                {preview || currentUrl ? 'Replace image' : 'Upload image'}
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
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          )}

          <p className="mt-1 text-[11px] text-[#9fa7b3]">
            PNG, JPEG, WebP or GIF. Max 5 MB. Stored on your own server.
          </p>

          {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
