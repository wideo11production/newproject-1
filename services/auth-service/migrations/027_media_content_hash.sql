-- =============================================================================
-- 027: MEDIA CONTENT HASH - re-upload dedup
-- =============================================================================
--
-- WHAT THIS IS FOR
--
-- SYSTEM-PLAN.md §5.3: "Re-uploading the same file to the same channel reuses
-- the existing transcoded renditions when the content hash matches. This is the
-- single biggest cost saver in the system: a creator fixing a title does not
-- re-encode anything."
--
-- The concrete case it exists for: a creator uploads a 4 GB video, changes their
-- mind about the title ten minutes later, and re-uploads the same file. Without
-- a hash, that is two complete ffmpeg passes - two encodes, two sets of
-- segments, two sets of thumbnails, and twice the storage for identical output.
--
-- -----------------------------------------------------------------------------
-- WHAT IS AND IS NOT A UNIQUE CONSTRAINT HERE
-- -----------------------------------------------------------------------------
--
-- NOT UNIQUE, and deliberately. Two creators uploading the same stock clip
-- produce the same hash, and a unique index on (user_id, content_hash) would
-- only stop the second upload per user - which is actually the wanted
-- behaviour, so the scoping is what matters, not the constraint.
--
-- The lookup is (user_id, content_hash) folded with the channel, and it is a
-- QUERY rather than a constraint because a re-upload is not an error to be
-- rejected: it is a shortcut to be taken. A constraint turns a legitimate
-- re-upload into a database exception.
--
-- -----------------------------------------------------------------------------
-- WHY THE CLIENT COMPUTES IT
-- -----------------------------------------------------------------------------
--
-- The bytes never reach this service - they go browser -> MinIO directly on a
-- presigned PUT. So the hash is computed in the browser (SubtleCrypto, off the
-- main thread) and sent as a CLAIM at `initiated`.
--
-- A hash is therefore not a security boundary, and this migration does not
-- treat it as one: it cannot verify the file the claim refers to. What it does
-- do is make the common case cheap, and the worst case of a lying client is a
-- wasted transcode - the same outcome as having no dedup at all. The claim is
-- ALSO re-measured for real: `MarkTranscodeResult` writes the ffprobe values,
-- so a file whose size claim is a lie is caught there rather than here.
--
-- -----------------------------------------------------------------------------
-- WHY THE COLUMN IS NULLABLE AND INDEXED, NOT PART OF THE PRIMARY SHAPE
-- -----------------------------------------------------------------------------
--
-- Most rows created before this migration have no hash, and a client that does
-- not compute one must still be able to upload. NULL means "no claim was
-- made" and never matches anything, so those rows simply take the slow path
-- forever - correct, and nothing to backfill.
--
-- Partial index on the non-null values only: indexing NULLs would bloat the
-- index with rows that can never be matched.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'media_assets'
          AND column_name = 'content_hash'
    ) THEN
        ALTER TABLE media_assets
            ADD COLUMN content_hash VARCHAR(64);
    END IF;
END $$;

-- 64 chars exactly: a SHA-256 hex digest. The length is a constraint, not a
-- hint - a longer value is a different algorithm and a shorter one is a
-- truncated hash, and silently accepting either would make two different files
-- compare equal under a colliding prefix.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'media_assets'::regclass
          AND conname = 'chk_media_content_hash_len'
    ) THEN
        ALTER TABLE media_assets
            DROP CONSTRAINT chk_media_content_hash_len;
    END IF;
END $$;
ALTER TABLE media_assets
    ADD CONSTRAINT chk_media_content_hash_len
    CHECK (content_hash IS NULL OR char_length(content_hash) = 64);

-- The dedup lookup: "does THIS user already have THIS file". Leads with
-- user_id because every read is scoped by owner - a global hash index would be
-- far larger and would let one user probe another user's uploads by hash.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = 'media_assets'
          AND indexname = 'idx_media_assets_user_hash'
    ) THEN
        CREATE INDEX idx_media_assets_user_hash
            ON media_assets(user_id, content_hash)
            WHERE content_hash IS NOT NULL;
    END IF;
END $$;

COMMENT ON COLUMN media_assets.content_hash IS
  'SHA-256 hex of the file bytes, computed in the browser and claimed at initiate. Enables re-upload dedup (SYSTEM-PLAN §5.3): the same file re-uploaded by the same user reuses the existing renditions instead of re-encoding. NULL means no claim was made; NULL never matches. A claim, not a verification - the bytes never reach the server.';

COMMIT;
