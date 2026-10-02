-- ============================================================================
-- 008_user_registrations.sql
-- ============================================================================
-- PURPOSE: har REAL registration ka permanent audit record - kaun, kab, kahan
-- se, kis device/browser se.
--
-- ---- WHY A SEPARATE TABLE (not click_events) ----
--   1. Registration ONE-TIME event hai; clicks bulk me aate hain. Mix karne
--      se "signups" query expensive ho jati.
--   2. Ye PERMANENT record hai. Click events purge ho sakte hain, par
--      "kaun account banata hai" kabhi nahi mita chahiye.
--   3. Analytics (country-wise signups, device split, browser share) seedha
--      is table par cheap hain.
--
-- ---- HONESTY ----
-- Koi dummy/fake row NAHI. Country/continent tabhi bharenge jab trusted
-- proxy geo header present ho; warna NULL rahega.
--
-- Hinglish comments: har step ka arth
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS user_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE CASCADE: user delete hua to uska registration record bhi
  -- jayega (orphaned rows nahi chhodni).
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  email      VARCHAR(255) NOT NULL,
  username   VARCHAR(100),

  -- ---- Where from ----
  ip_address VARCHAR(64),
  user_agent VARCHAR(512),
  -- ISO 3166-1 alpha-2. NULL when no trusted geo header was present.
  country    VARCHAR(2),
  continent  VARCHAR(8),

  -- ---- What device / browser ----
  device_type VARCHAR(16),   -- mobile | tablet | desktop | bot | unknown
  browser      VARCHAR(64),  -- "Chrome 131"
  os           VARCHAR(64),  -- "Windows 10/11"

  -- ---- Where they came from ----
  referrer VARCHAR(512),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Analytics queries in columns par index expect karti hain.
--
-- `IF NOT EXISTS` on every one of them, which is the whole reason this table
-- needs it: `user_registrations` is a GORM model, so AutoMigrate has already
-- created it before this file runs. Without the guard a second application fails
-- with `relation "user_registrations" already exists` and rolls the file back.
--
-- That was the actual state of this file until now - the comment below already
-- said `IF NOT EXISTS` was necessary while the statements carried no guard.
CREATE INDEX IF NOT EXISTS idx_user_reg_country   ON user_registrations(country);
CREATE INDEX IF NOT EXISTS idx_user_reg_continent ON user_registrations(continent);
CREATE INDEX IF NOT EXISTS idx_user_reg_device    ON user_registrations(device_type);
CREATE INDEX IF NOT EXISTS idx_user_reg_created   ON user_registrations(created_at DESC);

COMMENT ON TABLE user_registrations IS
  'Permanent audit record of every real registration: who, when, from where, on what device and browser. Separate from the click ledger because a registration is a one-time event and must never be purged with click data.';

COMMENT ON COLUMN user_registrations.country IS
  'ISO 3166-1 alpha-2 from a TRUSTED proxy geo header. NULL when no such header was present - never guessed, because a fabricated country would silently corrupt the country-wise signup analytics this table exists for.';

COMMENT ON COLUMN user_registrations.user_id IS
  'ON DELETE CASCADE: deleting the account removes its registration record, so the audit trail does not outlive the user it describes with nobody able to answer questions about it.';

COMMIT;
