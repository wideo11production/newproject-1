-- ============================================================================
-- Migration 034: backfill the poster path for rows that never recorded one
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- An audit of `ready` rows found 78 of 102 with `poster_public_url` NULL while the
-- poster file existed in the bucket at `{asset_id}/poster.jpg`. The on-screen
-- result was a library of grey tiles carrying filenames, which reads to a creator
-- as "the media has no data" - and it is what was reported.
--
-- The cause was in `MarkReady`: it wrote the poster URL only when the transcoder's
-- callback happened to carry one, even though the transcoder always writes that
-- file to a deterministic path. That is now fixed at the source (the service
-- derives the path when the caller omits it), and this migration repairs the rows
-- the old code produced.
--
-- The path written here is the SAME one the fixed `MarkReady` constructs: a
-- path-like key the client slices the asset id out of, not a browsable URL. The
-- video bucket is private by design, so every read goes through a signed stream
-- route regardless - writing `http://minio:9000/...` here would produce a URL that
-- 403s for every caller including the uploader.
--
-- SAFE TO RE-RUN
--
-- Every statement is a `WHERE poster_public_url IS NULL OR = ''` scoped UPDATE, so
-- a second run finds nothing to change. The column is also backfilled only for
-- rows that already have a rendition, because a row with no playlist has nothing
-- to show a poster OF.
-- ============================================================================

-- 1. Rows that already reached `ready` with a rendition. The poster path is
--    derived from the id, which is exactly what `MarkReady` now writes.
UPDATE media_assets
SET poster_public_url = id::text || '/poster.jpg',
    updated_at = now()
WHERE (poster_public_url IS NULL OR poster_public_url = '')
  AND hls_public_url IS NOT NULL
  AND hls_public_url <> '';

-- 2. Rows that reached `ready` with no rendition are still lying about their state,
--    and 033 already moved them to `failed`. They get no poster, because a poster
--    for a file that cannot be played is decoration.
