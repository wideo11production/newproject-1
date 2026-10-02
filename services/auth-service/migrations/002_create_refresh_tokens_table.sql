-- ============================================================================
-- 002_create_refresh_tokens_table.sql   (PostgreSQL)
-- ============================================================================
-- PURPOSE: refresh token storage for the JWT refresh flow.
--
-- ---- SECURITY MODEL ----
-- Raw refresh tokens are NEVER stored. `token_hash` holds a SHA-256 hash
-- (`internal/password.HashToken`). A dump of this table is therefore not
-- enough to impersonate anyone - the attacker would still need the token
-- itself, which only ever existed in the user's browser.
--
-- `revoked_at` (not a boolean) is the revocation marker, so the reason and
-- time of revocation are recoverable for audit instead of being lost.
--
-- ---- WHY THIS FILE WAS REWRITTEN ----
-- The original described a much larger table - `token_family`, `token_index`,
-- `is_revoked`, `issued_at`, `user_agent`, `ip_address`, `device_fingerprint`,
-- `revoked_reason`, `replaced_by_token_id`, `revoked_at_actual`, `deleted_at`.
-- None of it is referenced by any Go code, and `internal/model.RefreshToken`
-- has never had those fields. Left as-is it was a drift bomb in two ways:
--
--   1. It declared `token_hash VARCHAR(255)` where the model wants 512. Had
--      this file run before AutoMigrate, every long token hash would have
--      failed insert with "value too long".
--   2. It was not idempotent - a second run failed outright on
--      `relation "refresh_tokens" already exists` (SQLSTATE 42P07), which is
--      what a fresh environment provisioning from 001 upward would hit.
--
-- The Go model is the source of truth for anything a query touches. This
-- file exists so a database can be built without starting the service, and
-- so the shape matches what `AutoMigrate` would produce. The two must stay
-- in step - `TestMigrationChainReplays` in internal/database applies this
-- file after AutoMigrate and fails on any disagreement.
--
-- ---- IDEMPOTENT ----
-- `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
-- `ADD COLUMN IF NOT EXISTS`. Every statement is a no-op on a second run.
--
-- The runner in `internal/database/migrator.go` applies this file inside its own
-- transaction and records it in `schema_migrations`, so a normal boot will not
-- re-apply it at all. These guards are for the OTHER case - a database that was
-- built by hand, which is every existing deployment - where the chain is applied
-- to tables AutoMigrate has already created.
--
-- Hinglish: refresh token ka hash store karo, raw token kabhi nahi
-- ============================================================================

BEGIN;

-- ---- THE `IF NOT EXISTS` THAT WAS MISSING ----
--
-- This file's own header said "it was rewritten to be idempotent" and then
-- declared `CREATE TABLE refresh_tokens` with no `IF NOT EXISTS`.
--
-- The comment documented the fix; the statement never received it. That is the
-- same failure migration 011 had, and it is invisible for as long as nobody
-- provisions a database - because on an EXISTING database AutoMigrate has
-- already created the table, so a manual re-run is where you would see it, and a
-- re-run is the case the comment was claiming to handle.
--
-- It was found by `TestMigrationChainReplays`, which had never actually reached
-- this file: the test was failing at step 1 on a view whose table did not exist
-- yet, so no amount of passing at step 1 proved anything about steps 2 and 3.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE CASCADE: user delete hote hi tokens hat jaate hain. Bina iske
  -- ek deleted user ke valid refresh tokens DB me pade rehte - wahi stale
  -- token se authenticate ho sakte hain.
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- SHA-256 hash of the refresh token. 512 chars, not 255: the model tags
  -- it `size:512` and a narrower column fails inserts rather than truncating.
  token_hash VARCHAR(512) NOT NULL,

  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ
);

-- Lookup path: every refresh attempt resolves a token by its hash.
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash
  ON refresh_tokens (token_hash);

-- Listing a user's sessions, and revoking all of them on rollover.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
  ON refresh_tokens (user_id);

-- Cleanup worker scans on expiry.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
  ON refresh_tokens (expires_at);

-- ---- session_id: migration 013 ----
--
-- The COLUMN only. The foreign key is 013's job, deliberately, and adding an
-- inline `REFERENCES` here was a mistake worth recording:
--
-- An inline `REFERENCES sessions(id) ON DELETE CASCADE` makes PostgreSQL name the
-- constraint `refresh_tokens_session_id_fkey` - and then 013 adds a SECOND
-- constraint on the same column, `fk_refresh_tokens_session`. Two foreign keys,
-- one column, both cascading: correct by accident and confusing on purpose.
--
-- Worse, the reason this file has no FK at all is not tidiness. GORM's
-- AutoMigrate runs FIRST and creates `fk_refresh_tokens_session` from
-- `model.RefreshToken` with no delete rule, which is exactly the constraint name
-- 013's original guard looked for - so that guard skipped on every database and
-- the CASCADE never landed anywhere. 013 now compares the RULE, and the model
-- carries `constraint:OnDelete:CASCADE`. One owner per constraint.
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS session_id UUID;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id
  ON refresh_tokens (session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN refresh_tokens.token_hash IS
  'SHA-256 digest of the refresh token. The token itself must never be stored here: a dump of this table must not be enough to impersonate anyone.';

COMMENT ON COLUMN refresh_tokens.revoked_at IS
  'Set when the token is rotated, revoked, or invalidated by a PIN or password change. NULL means still valid. A timestamp rather than a boolean so the reason and time survive for audit.';

COMMENT ON COLUMN refresh_tokens.session_id IS
  'The session this token belongs to, which is what makes "log out of THIS device only" expressible. NULL for tokens minted before migration 013; their access token is still dead on logout, but the row cannot be attributed to a device until it expires.';

COMMIT;