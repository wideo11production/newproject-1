-- 032: uploader context on the asset row
--
-- T&C clause 6 promises that a violator's "credentials and digital footprints"
-- can be reported to law enforcement. That promise is only true if the footprint
-- was recorded, and the only moment it is knowable is when the upload happens.
--
-- =============================================================================
-- WHY THESE COLUMNS ARE ON `media_assets` AND NOT ONLY IN THE AUDIT TABLE
-- =============================================================================
--
-- `media_moderation_audits` already holds ip_address, device_fingerprint and
-- user_agent - denormalised copies written at moderation time. That table is the
-- record of a VERDICT. These columns are the record of the UPLOAD.
--
-- The distinction matters for retention. The PII purge worker sweeps `sessions` on
-- a schedule, and the audit table deliberately survives it (see migration 030).
-- But an upload's origin is a property of the asset, not of one decision about it:
-- an asset that is re-reviewed, re-moderated, or appealed a year later still
-- needs "who put this here", and its moderation audit rows are one verdict each.
--
-- So the flow is: capture at `initiate` -> store here -> copy into every audit row
-- written for this asset. The copies can disagree with each other across time only
-- in the fields that describe the reviewer, never in the ones that describe the
-- uploader.
--
-- =============================================================================
-- WHY `device_fingerprint` IS AN OPAQUE STRING AND NOT A PARSE
-- =============================================================================
--
-- It is whatever the client sends, length-bounded, stored verbatim. Parsing it
-- would require agreeing a schema with the browser code, and a schema that changes
-- becomes a column nobody can read back. Its value is in being CONSISTENT: the same
-- browser produces the same value, which is what "the same device" means for a
-- multi-account detection signal.
--
-- It is NOT an identity. It is a fingerprint - it correlates, it does not
-- authenticate, and it is one input among several.

ALTER TABLE media_assets
    ADD COLUMN IF NOT EXISTS upload_ip          VARCHAR(64)  NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS upload_user_agent  VARCHAR(500) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(128) NOT NULL DEFAULT '';

COMMENT ON COLUMN media_assets.upload_ip IS 'Client IP at upload time, for law-enforcement cooperation (T&C clause 6). Survives the session PII purge.';
COMMENT ON COLUMN media_assets.upload_user_agent IS 'Client user agent at upload time. Bounded at 500 to match the session table.';
COMMENT ON COLUMN media_assets.device_fingerprint IS 'Opaque client-supplied device fingerprint. Correlates accounts; does not authenticate.';

-- Index for "what did this device upload", which is the multi-account and
-- repeat-offender question. Partial on the empty string because most rows have
-- a fingerprint and the ones without cannot answer the question at all.
CREATE INDEX IF NOT EXISTS idx_media_assets_device_fp
    ON media_assets (device_fingerprint, created_at DESC)
    WHERE device_fingerprint <> '';

-- ---- Backfill ----
--
-- Existing rows have no recorded uploader context: the columns were added after
-- the uploads happened, and the `sessions` rows that once held the same data have
-- been purged. Leaving them empty is the honest state - inventing a value would
-- put words in a log nobody wrote.
--
-- NOTE: this means assets uploaded before 032 have no footprint, and the T&C
-- promise applies to what was recorded. That is stated rather than hidden because
-- a policy that claims coverage it cannot deliver is worse than one with a gap.

