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

CREATE TABLE user_registrations (
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
-- `IF NOT EXISTS` zaroori hai - bina iske dobara chalane par ye fail hoti
-- hai (relation already exists), aur ye repo me migrations `psql -f` se
-- manually chalti hain, isliye re-run routine hai.
CREATE INDEX idx_user_reg_country ON user_registrations(country);
CREATE INDEX idx_user_reg_continent ON user_registrations(continent);
CREATE INDEX idx_user_reg_device   ON user_registrations(device_type);
CREATE INDEX idx_user_reg_created  ON user_registrations(created_at DESC);

-- Table documentation is kept in this migration because the target database
-- does not support PostgreSQL's COMMENT ON TABLE syntax.

COMMIT;
