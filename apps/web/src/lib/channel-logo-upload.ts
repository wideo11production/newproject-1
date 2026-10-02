/**
 * THE channel-LOGO upload flow.
 *
 * A sibling of `channel-cover-upload.ts`, and deliberately NOT merged into it.
 *
 * =============================================================================
 * WHY A SEPARATE FILE AND NOT A SHARED ONE WITH A `kind` PARAMETER
 * =============================================================================
 *
 * The two uploads share a shape: presigned PUT to MinIO, then verify by magic
 * bytes, then save. What differs is everything that matters:
 *
 *   - the byte ceiling is different (a logo is 2 MB, a cover is 4 MB)
 *   - the aspect ratio is different (square versus 2:1)
 *   - the key prefix is different
 *   - the SAVE semantics are different: a cover uploaded before a channel exists
 *     returns a URL for the create call to carry, while a logo is saved onto an
 *     existing channel by finalize
 *
 * One function with a `kind` argument would have all four of those as a branch -
 * and a branch nobody reads is the one that gets the wrong limit. Which is
 * exactly what happened with the cover's size limit once already: a hardcoded 6 MB
 * on the create path against a 4 MB server rule, so a 5 MB file uploaded in full
 * and was refused at the end.
 *
 * The shared part that WAS worth sharing is the failure handling, and that is
 * what `CoverUploadError` is for: both flows reject with it, so a caller needs one
 * `catch`.
 *
 * =============================================================================
 * WHY THE LIMIT IS PASSED IN
 * =============================================================================
 *
 * `maxBytes` comes from the server, which is the only authority on it. The
 * alternative - a constant here - is how two numbers drift apart without anybody
 * noticing, because both are correct in isolation.
 */

import { COVER_ACCEPTED, CoverUploadError } from './channel-cover-upload';

export { COVER_ACCEPTED as LOGO_ACCEPTED };

/**
 * Re-exported so a caller needs one import for the shared pieces.
 *
 * The name is a little off for a logo, and it is worth saying why it was kept
 * rather than renamed: it is the error type for "this file upload did not work",
 * and renaming it per-asset produces `CoverUploadError` and `LogoUploadError` -
 * two types with identical semantics and a `catch` that has to handle both. One
 * error type for one meaning is the more useful shape, even when the name is not
 * a perfect fit.
 */
export { CoverUploadError };

export type UploadLogoOptions = {
  channelId: string;
  file: File;
  /** From the server. Never a local constant. */
  maxBytes: number;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
};

/**
 * Upload a channel logo and save it. Returns the stored public URL.
 *
 * Rejects with a `CoverUploadError` whose message is safe to show to a user.
 */
export function uploadChannelLogo({
  channelId,
  file,
  maxBytes,
  onProgress,
  signal,
}: UploadLogoOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // A plain `new CoverUploadError(...)`, NOT `require(...)`.
    //
    // The first version reached for `require` here, which happens to work under
    // Next's CommonJS interop and fails outright in a real ESM browser bundle. The
    // import at the top of this file is the correct way to reach a sibling module,
    // and the `require` was only ever an accident of reaching for something
    // nearby.
    const fail = (message: string, status = 0) =>
      reject(new CoverUploadError(message, status));

    const run = async () => {
      const base = `/api/channels/${encodeURIComponent(channelId)}/logo`;

      // ---- 0. Cheap checks, before any round trip ----
      //
      // Feedback only. The server verifies by magic bytes at finalize, so an HTML
      // file with a .png name still dies there - this just stops a wasted upload.
      if (!COVER_ACCEPTED.includes(file.type)) {
        fail('Choose a PNG, JPEG or WebP image.');
        return;
      }
      if (file.size > maxBytes) {
        fail(
          `That logo is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${Math.round(
            maxBytes / 1024 / 1024
          )} MB.`,
        );
        return;
      }

      // ---- 1. presigned PUT URL ----
      let res: Response;
      try {
        res = await fetch(`${base}/upload-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // NO `objectKey`. The server mints the key from the caller's own user id;
          // a client that may choose its key may write outside its own prefix,
          // which is an IDOR on the object store.
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
          signal,
        });
      } catch {
        fail('Could not reach the upload service. Check your connection.');
        return;
      }

      const ticket = (await res.json().catch(() => ({}))) as {
        objectKey?: string;
        uploadUrl?: string;
        contentType?: string;
        method?: string;
        message?: string;
      };
      if (!res.ok) {
        fail(ticket.message ?? 'Could not start the upload.', res.status);
        return;
      }
      if (typeof ticket.uploadUrl !== 'string' || typeof ticket.objectKey !== 'string') {
        fail('The upload service returned an unexpected response. Please retry.', res.status);
        return;
      }

      // ---- 2. PUT the bytes straight to MinIO ----
      //
      // XHR rather than fetch: fetch has no upload progress, and this is a transfer
      // on an unknown connection. The Content-Type header MUST match what the URL
      // was signed with, or MinIO rejects the PUT and it reads as a network fault.
      try {
        await new Promise<void>((ok, no) => {
          const xhr = new XMLHttpRequest();
          xhr.open(ticket.method ?? 'PUT', ticket.uploadUrl as string, true);
          xhr.setRequestHeader('Content-Type', ticket.contentType ?? file.type);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
              onProgress(Math.round((e.loaded / e.total) * 100));
            }
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? ok()
              : no(new Error(`The logo did not upload (${xhr.status}).`));
          xhr.onerror = () => no(new Error('Network error during upload.'));
          xhr.onabort = () => no(new Error('Upload cancelled.'));
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
        fail(e instanceof Error ? e.message : 'The logo did not upload.');
        return;
      }

      // ---- 3. finalize: verify AND save ----
      //
      // No PATCH afterwards. This finalize writes `logo_url` itself and deletes the
      // previous logo AFTER the replacement is verified, so a failed swap leaves
      // the creator with the logo they already had.
      let fin: Response;
      try {
        fin = await fetch(`${base}/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objectKey: ticket.objectKey }),
          signal,
        });
      } catch {
        fail('The logo uploaded but could not be verified. Please retry.');
        return;
      }

      const body = (await fin.json().catch(() => ({}))) as {
        channel?: { logo_url?: string };
        message?: string;
      };
      if (!fin.ok) {
        fail(body.message ?? 'That file is not a valid image.', fin.status);
        return;
      }

      const saved = body.channel?.logo_url;
      if (typeof saved !== 'string' || saved.length === 0) {
        // The upload and the save both reported success but no URL came back, so
        // there is nothing to show. Treating that as success would leave the field
        // blank with no message, which is the one outcome worth being loud about.
        fail('The logo was saved but the server did not return its address. Please retry.');
        return;
      }

      onProgress?.(100);
      resolve(saved);
    };

    void run();
  });
}
