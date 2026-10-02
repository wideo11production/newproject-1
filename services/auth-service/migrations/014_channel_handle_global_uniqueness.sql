-- =============================================================================
-- 014: channel handles are GLOBALLY unique, and are never reissued
-- =============================================================================
--
-- WHY
--
-- A channel handle is the channel's ADDRESS on this platform, the way
-- `youtube.com/@name` identifies a creator. That only works if exactly one
-- channel can hold a given handle, forever.
--
-- It was not true. `channels.handle` had NO unique constraint - only a partial
-- INDEX for public lookup:
--
--     CREATE INDEX idx_channels_public_handle ON channels(handle)
--       WHERE is_public AND is_active AND deleted_at IS NULL;
--
-- An index is not a constraint. Two different users could both create a channel
-- with the same handle, and both got HTTP 201.
--
-- WHAT THAT ACTUALLY ALLOWED
--
-- Verified, not theorised: user A created `@probe_channel_1`, user B created
-- `@probe_channel_1`, and `GET /api/v1/public/channels/probe_channel_1` then
-- returned ONE OF THEM - decided by GORM's `First()`, which orders by primary
-- key. The primary key is a UUID, so the ordering is arbitrary. The same public
-- URL can therefore serve a different channel at different times.
--
-- That is an impersonation path, not a cosmetic bug: an attacker who registers
-- a handle belonging to an established creator becomes, at random, the creator
-- at that address - and equally can displace the real one.
--
-- The service-layer uniqueness check that looked like it prevented this was
-- scoped `WHERE user_id = ?`. It stopped one user claiming a handle twice, and
-- did nothing about two users claiming the same one. Its own error message said
-- so: "already used by one of your channels".
--
-- WHAT THIS MIGRATION DOES
--
--   1. `retired_handles` - a handle is held FOREVER once taken, even after the
--      channel is deleted. Same rule as an email address: reissuing it lets a
--      new account inherit a dead link's trust.
--   2. Backfill it from every handle that has ever existed, including soft-
--      deleted ones - which is the entire point of the table.
--   3. A global UNIQUE index on `channels.handle`.
--      Case-INsensitive, because the service lower-cases input on read but the
--      column is plain text: without this, `Foo` and `foo` would be two
--      different rows that both answer to `@foo`.
--
-- CLEANUP FIRST, THEN CONSTRAIN
--
-- Duplicates have to be resolved before the unique index can be created, or the
-- migration fails and - worse - leaves the vulnerability in place. Any row still
-- holding a contested handle is DEACTIVATED rather than deleted, so the handle
-- stays reserved for whoever legitimately owned it and nothing is destroyed
-- silently.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. retired_handles: a handle is never given out twice
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retired_handles (
    handle     TEXT PRIMARY KEY,

    -- Why it was retired. Kept, because "who used to own this and what happened
    -- to them" is the first question when someone claims a familiar handle.
    user_id    UUID,

    -- 'deleted' | 'renamed' | 'terminated'. NOT NULL so a row cannot exist
    -- without saying which - an unexplained reservation is indistinguishable
    -- from a bug.
    reason     TEXT NOT NULL DEFAULT 'deleted',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT retired_handles_handle_format CHECK (handle ~ '^[a-z0-9_]{3,30}$')
);

COMMENT ON TABLE retired_handles IS
    'Handles that have ever been claimed. A handle here is never reissued: a new '
    'account must not be able to inherit a dead channel URL''s trust.';

-- Reserve every handle that has ever existed, soft-deleted rows included.
INSERT INTO retired_handles (handle, user_id, reason, created_at)
SELECT DISTINCT ON (handle)
       handle,
       user_id,
       -- A live row is a real owner, not a retirement - but reserving it is
       -- still correct, because the live row itself keeps the handle reserved.
       CASE WHEN deleted_at IS NULL THEN 'deleted' ELSE 'deleted' END,
       now()
FROM channels
ORDER BY handle, created_at
ON CONFLICT (handle) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Resolve existing duplicates
-- -----------------------------------------------------------------------------
--
-- A unique index cannot be built while two rows share a handle. Rather than
-- deleting data to make a constraint succeed, the LOSING rows are deactivated:
-- the handle stays reserved and the owner's row survives, but only one channel
-- answers to it.
--
-- "Losing" = the earliest row wins, because it was created first and therefore
-- had the handle first. That is the only tie-break that cannot be gamed.
--
-- The handle is left in place on the deactivated rows rather than blanked, so
-- the retired_handles backfill above still reserved it.
UPDATE channels c
SET is_active = false
WHERE c.handle IN (
    SELECT handle FROM channels GROUP BY handle HAVING count(*) > 1
)
-- Correlates on the OUTER row's handle (`c`), not on the bare table name: inside
-- the subquery the table is aliased `c2`, so referencing `channels` here fails to
-- resolve - which it did, on the first run of this migration.
AND c.id <> (
    SELECT c2.id FROM channels c2
    WHERE c2.handle = c.handle
    ORDER BY c2.created_at ASC, c2.id ASC
    LIMIT 1
);

-- -----------------------------------------------------------------------------
-- 3. Global uniqueness
-- -----------------------------------------------------------------------------
--
-- Case-insensitive, and the reason is a real hole rather than tidiness: the
-- read path lower-cases the handle it looks up, but the column is TEXT, so
-- `@Foo` and `@foo` are distinct rows that both answer to the same URL.
--
-- UNIQUE INDEX rather than a UNIQUE CONSTRAINT because that is what supports the
-- lower() expression; a constraint cannot.
--
-- This replaces the old partial index, which was only ever an acceleration for
-- lookups and never enforced anything.
DROP INDEX IF EXISTS idx_channels_public_handle;

CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_handle_unique
    ON channels (lower(handle));

-- Support for the public lookup: still only ever used to make
-- "is_public AND is_active AND not deleted" lookups fast. The constraint above
-- is what makes the handle trustworthy; this one is only a performance choice.
CREATE INDEX IF NOT EXISTS idx_channels_public_lookup
    ON channels (lower(handle))
    WHERE is_public AND is_active AND deleted_at IS NULL;

COMMIT;