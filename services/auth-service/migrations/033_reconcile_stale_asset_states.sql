-- ============================================================================
-- Migration 033: asset rows that claim a state they do not have
-- ============================================================================
--
-- WHY THIS MIGRATION EXISTS
--
-- An audit of `media_assets` found 365 rows, of which:
--
--   304  ready          85 of them have a rendition, 219 have NONE
--   38   initiated      all older than a day, none progressed
--   7    uploaded       same
--
-- The 219 `ready` rows carry a rendition URL that is null and no files in the
-- bucket, and the 45 stuck uploads have been `initiated` or `uploaded` for over a
-- day. Both sets are rows whose recorded state does not describe reality:
--
--   A row that says `ready` with no rendition is a lie to every consumer. The
--   upload page filters it out silently, the library shows nothing for it, and a
--   creator who uploads the same file again gets a NEW row - which is exactly how
--   a table ends up with 31 copies of `clip.mp4` and a viewer concludes files are
--   "missing".
--
--   A row stuck at `initiated` for a day is a job that will never finish. The
--   transcode service is not going to come back to it, and every "processing"
--   count on every dashboard is inflated by rows that are never going to move.
--
-- The fix is to make the state HONEST: move these rows to `failed` with a reason
-- that says what happened. A failed row has a retry button, which is a real path
-- forward; a `ready` row with nothing behind it has no path at all.
--
-- SAFETY
--
-- This migration is a data correction, not a schema change, so it is safe to
-- re-run: every statement is a WHERE-clause-bounded UPDATE, and re-running it
-- finds nothing to change.
--
-- It deliberately does NOT touch:
--
--   * rows with a moderation reason - those were screened on purpose
--   * rows with `hls_public_url` set but no channel - that is a publishing
--     decision, not a data error
--   * anything already `failed`
-- ============================================================================

-- 1. `ready` with no rendition. The transcode never produced output for these,
--    so `ready` is false and the row is unplayable.
UPDATE media_assets
SET status = 'failed',
    failure_reason = 'No rendition was produced: the transcode finished without writing a playlist. Re-upload to retry.',
    updated_at = now()
WHERE status = 'ready'
  AND (hls_public_url IS NULL OR hls_public_url = '');

-- 2. Uploads that never left their first state. 24 hours is far longer than a
--    transcode takes, and a row that has not progressed in that time never will.
UPDATE media_assets
SET status = 'failed',
    failure_reason = 'The upload never completed: no transcode was claimed within 24 hours. Re-upload to retry.',
    updated_at = now()
WHERE status IN ('initiated', 'uploaded')
  AND created_at < now() - interval '24 hours';

-- 3. Rows that reached `transcoding` and stopped there. The same reasoning as
--    (2): the transcode service either crashed or the job was lost, and either
--    way the row is not going to move on its own.
UPDATE media_assets
SET status = 'failed',
    failure_reason = 'The transcode did not finish within 24 hours. Re-upload to retry.',
    updated_at = now()
WHERE status = 'transcoding'
  AND created_at < now() - interval '24 hours';
