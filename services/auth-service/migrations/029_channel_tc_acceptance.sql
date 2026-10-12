-- 029: channel T&C acceptance fields
--
-- PURPOSE: Add mandatory Terms & Conditions acceptance fields to channels table.
-- Every channel creation (free or paid) requires the creator to accept the T&C.
-- This stores when, which version, and that they accepted.
--
-- Fields:
--   tc_accepted           BOOLEAN NOT NULL DEFAULT false
--   tc_accepted_at        TIMESTAMPTZ NULL
--   tc_accepted_version   VARCHAR(32) NULL
--
-- WHY NOT NULL DEFAULT FALSE:
--   Existing channels get false (they never accepted the new T&C).
--   New channels MUST pass true from the API, which validates it.
--   The column cannot be NULL because every channel either accepted or not.
--
-- tc_accepted_version stores the T&C version (e.g. "2026-10-v1") so we know
-- exactly what text the creator agreed to. When T&C updates, version bumps.
--
-- tc_accepted_at records the exact timestamp of acceptance for audit trail.

ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS tc_accepted BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS tc_accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS tc_accepted_version VARCHAR(32);

COMMENT ON COLUMN channels.tc_accepted IS 'Whether the creator accepted the mandatory T&C for this channel. Required for ALL channels (free or paid).';
COMMENT ON COLUMN channels.tc_accepted_at IS 'Timestamp when the creator accepted the T&C. NULL if not accepted.';
COMMENT ON COLUMN channels.tc_accepted_version IS 'Version of T&C accepted (e.g. "2026-10-v1"). Bumps when T&C text changes.';

-- Index for finding channels that haven't accepted T&C (if needed for auditing)
CREATE INDEX IF NOT EXISTS idx_channels_tc_accepted ON channels (tc_accepted) WHERE tc_accepted = false;