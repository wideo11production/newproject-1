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
-- `psql -f` se manually chalti hai (koi runner nahi), isliye dobara chalana
-- routine hai. `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`.
--
-- Hinglish: refresh token ka hash store karo, raw token kabhi nahi
-- ============================================================================

BEGIN;

CREATE TABLE refresh_tokens (
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
CREATE UNIQUE INDEX idx_refresh_tokens_token_hash
  ON refresh_tokens (token_hash);

-- Listing a user's sessions, and revoking all of them on rollover.
CREATE INDEX idx_refresh_tokens_user_id
  ON refresh_tokens (user_id);

-- Cleanup worker scans on expiry.
CREATE INDEX idx_refresh_tokens_expires_at
  ON refresh_tokens (expires_at);

-- Refresh token hashes for the JWT refresh flow. Raw tokens are never stored;
-- token_hash holds a SHA-256 digest. The token_hash column must never contain
-- the token itself. revoked_at is set when the token is rotated, revoked, or
-- invalidated by a PIN/password change; NULL means still valid.

COMMIT;