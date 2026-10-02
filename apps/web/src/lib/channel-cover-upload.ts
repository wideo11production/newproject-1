/**
 * THE channel-cover upload flow. One implementation, two callers.
 *
 * =============================================================================
 * WHY THIS FILE EXISTS
 * =============================================================================
 *
 * The cover was uploaded from two places - while creating a channel, and while
 * editing one - and they were two separate copies of the same three-step
 * presigned PUT. They disagreed:
 *
 *   - the create copy read `ticket.upload_url`; the server sends `uploadUrl`
 *   - the create copy allowed 6 MB; the server's limit is 4 MB
 *   - the create copy sent a CLIENT-CHOSEN `objectKey` the server ignores
 *
 * The edit copy was correct, so the feature "worked" - one screen away. That is
 * the worst shape a copy-paste bug can have: the second copy is proof the first
 * was wrong, and it is also why nobody noticed.
 *
 * Copy-paste across a monorepo guarantees drift. It is not a discipline problem,
 * it is arithmetic: two copies means every future change has to be applied twice,
 * and the second application is the one nobody does. One function cannot drift
 * from itself.
 *
 * =============================================================================
 * THE THREE STEPS, AND WHY THE FILE NEVER TOUCHES OUR SERVERS
 * =============================================================================
 *
 *   1. POST /api/channels/[...]/cover/upload-url  -> presigned MinIO PUT URL
 *   2. browser -> MinIO directly. The BYTES NEVER PASS THROUGH NEXT.JS OR GO.
 *   3. POST /api/channels/[...]/cover/finalize    -> magic-bytes verify, save
 *
 * Step 2 going straight to the object store is not an optimisation. It means a
 * 4 MB upload costs the app server nothing, and a creator on a slow link is not
 * holding an open request against auth-service while they wait.
 *
 * =============================================================================
 * WHAT IS CHECKED WHERE
 * =============================================================================
 *
 * Client-side checks below are FEEDBACK, not security: the server verifies by
 * magic bytes at finalize, so a `.html` file renamed `.png` still dies there.
 * The client check exists so the user is told immediately instead of after an
 * upload they did not need to make.
 *
 * The one thing the client is trusted with is the FILENAME, and only as a hint -
 * the server derives the real object key from the caller's own user id.
 */

export type CoverTicket = {
  objectKey: string;
  uploadUrl: string;
  publicUrl: string;
  method: string;
  expiresIn: number;
  contentType: string;
  maxBytes: number;
};

/** The server's own image allowlist. GIF is deliberately excluded. */
export const COVER_ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * `null` when the channel is not created yet.
 *
 * This ONE difference is the whole reason there are two call sites: the
 * create-time endpoints have no channel id to scope the object to, so they
 * validate against the user alone.
 */
export type CoverScope = { channelId: string } | { pending: true };

function endpoints(scope: CoverScope) {
  // A discriminated union, so `pending` and `channelId` narrow instead of both
  // being optional properties that both exist and are both undefined half the
  // time - which is how `upload_url` happened in the first place.
  if ('pending' in scope) {
    return { uploadUrl: '/api/channels/cover/upload-url', finalize: '/api/channels/cover/finalize' };
  }
  const id = encodeURIComponent(scope.channelId);
  return {
    uploadUrl: `/api/channels/${id}/cover/upload-url`,
    finalize: `/api/channels/${id}/cover/finalize`,
  };
}

/** Thrown for every failure, so a caller only needs one catch. */
export class CoverUploadError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'CoverUploadError';
    this.status = status;
  }
}

export type UploadCoverOptions = {
  file: File;
  scope: CoverScope;
  /** 0-100. Called on every progress tick; the byte transfer is not instant. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
};

/**
 * Upload a channel cover and return its public URL.
 *
 * Rejects with a `CoverUploadError` whose `message` is safe to show to a user:
 * the server's own wording for its own rules, and plain sentences for the rest.
 */
export function uploadChannelCover({
  file,
  scope,
  onProgress,
  signal,
}: UploadCoverOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const fail = (message: string, status = 0) => reject(new CoverUploadError(message, status));

    const run = async () => {
      // ---- 0. Cheap checks, before any round trip ----
      if (!COVER_ACCEPTED.includes(file.type)) {
        fail('Choose a PNG, JPEG or WebP image.');
        return;
      }

      // ---- 1. presigned PUT URL ----
      const { uploadUrl, finalize } = endpoints(scope);
      let res: Response;
      try {
        res = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // `filename` and `contentType` only. NO `objectKey`: the server mints
          // the key from the caller's own user id, and a client that may choose
          // its own key is a client that may write outside its prefix.
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
          signal,
        });
      } catch {
        fail('Could not reach the upload service. Check your connection.');
        return;
      }

      const ticket = (await res.json().catch(() => ({}))) as Partial<CoverTicket> & {
        message?: string;
      };
      if (!res.ok) {
        fail(ticket?.message ?? 'Could not start the upload.', res.status);
        return;
      }
      if (typeof ticket.uploadUrl !== 'string' || typeof ticket.objectKey !== 'string') {
        // A contract change, not a user problem. Saying so is more useful than a
        // generic failure three steps later.
        fail('The upload service returned an unexpected response. Please retry.', res.status);
        return;
      }

      // The size limit is the SERVER'S number. A hardcoded copy of it is how the
      // create path came to allow 6 MB against a 4 MB limit - the file uploaded
      // fully and was rejected only after the creator had waited for it.
      const maxBytes = typeof ticket.maxBytes === 'number' ? ticket.maxBytes : 4 * 1024 * 1024;
      if (file.size > maxBytes) {
        fail(
          `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${Math.round(
            maxBytes / 1024 / 1024
          )} MB.`,
          res.status
        );
        return;
      }

      // ---- 2. PUT the bytes straight to MinIO ----
      try {
        await new Promise<void>((ok, no) => {
          const xhr = new XMLHttpRequest();
          // `XMLHttpRequest`, not `fetch`: `fetch` has no upload progress, and
          // this is a 4 MB transfer on an unknown connection.
          xhr.open(ticket.method ?? 'PUT', ticket.uploadUrl as string, true);
          // MUST be byte-identical to what the URL was signed with, or MinIO
          // rejects the PUT and the error reads as a network fault.
          xhr.setRequestHeader('Content-Type', ticket.contentType ?? file.type);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
              onProgress(Math.round((e.loaded / e.total) * 100));
            }
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? ok()
              : no(new CoverUploadError(`The image did not upload (${xhr.status}).`, xhr.status));
          xhr.onerror = () => no(new CoverUploadError('Network error during upload.'));
          xhr.onabort = () => no(new CoverUploadError('Upload cancelled.'));
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
        fail(e instanceof Error ? e.message : 'The image did not upload.');
        return;
      }

      // ---- 3. finalize: the server verifies and returns the public URL ----
      let fin: Response;
      try {
        fin = await fetch(finalize, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The SERVER'S key. Never one reconstructed here.
          body: JSON.stringify({ objectKey: ticket.objectKey }),
          signal,
        });
      } catch {
        fail('The image uploaded but could not be verified. Please retry.');
        return;
      }

      const body = (await fin.json().catch(() => ({}))) as { publicUrl?: string; message?: string };
      if (!fin.ok || typeof body.publicUrl !== 'string') {
        fail(body?.message ?? 'That file is not a valid image.', fin.status);
        return;
      }

      onProgress?.(100);
      resolve(body.publicUrl);
    };

    void run();
  });
}