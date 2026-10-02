-- ============================================================================
-- 007_user_settings_and_telemetry_geo.sql
-- ============================================================================
-- PURPOSE:
--   1. `user_settings` table  - SSOT for theme, language, accent, toggles
--   2. `click_events` geo cols - country / continent / device / browser
--
-- ---- WHY user_settings CHAHYE (SSOT principle) ----
-- Requirement: "user ko setting baar baar na karni pade - ek jagah set karo,
-- har jagah same rahe".
-- Iske liye settings DB me PERSIST hone chahiye. Bina iske:
--   - theme sirf localStorage me hota (per-device, sync nahi)
--   - phone aur laptop par alag theme
--   - logout = settings chala gaye
-- Ek dedicated table iska SSOT hai - ek read, har jagah same.
--
-- ---- 1:1 RELATIONSHIP (why its own table not a column) ----
-- Settings ka apna lifecycle hai (created_at/updated_at alag, frequently
-- updated hoti hain). `users` row har baar UPDATE hota hai (last_login_at),
-- isliye settings ko alag rakhna hai taaki frequent settings-write se user
-- row ki contention na ho.
--
-- Hinglish comments: har step ka arth
-- ============================================================================

-- ============================================================================
-- TABLE 1: user_settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_settings (
  -- 1:1 with users. ON DELETE CASCADE: user delete hua to settings bhi
  -- jayengi (orphaned settings nahi chhodni).
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- ---- THEME ----
  -- Allowed values rakhe hain CHECK se, taaki frontend ka ek typo
  -- database me ghus na jaaye aur app half-broken na ho.
  --   dark      - current Grafana dark (default)
  --   light     - clean light
  --   midnight  - deep blue-black (OLED friendly)
  --   highcontrast - accessibility
  theme TEXT NOT NULL DEFAULT 'dark'
    CHECK (theme IN ('dark', 'light', 'midnight', 'highcontrast')),

  -- ---- ACCENT COLOUR ----
  -- Hex string, validated format me. Frontend se allowed palette aata hai,
  -- par DB level par bhi shape validate karte hain (7 char #RRGGBB).
  accent TEXT NOT NULL DEFAULT '#5794f2'
    CHECK (accent ~ '^#[0-9A-Fa-f]{6}$'),

  -- ---- LANGUAGE ----
  -- IETF BCP-47 style codes. Hinglish/English default.
  language TEXT NOT NULL DEFAULT 'en'
    CHECK (char_length(language) BETWEEN 2 AND 10),

  -- ---- CONTENT + SUBSCRIPTION TOGGLES (Block 2.7) ----
  -- Ye do flags user-controlled hain: kya wo content upload kar sakta hai,
  -- aur kya viewers uski subscription le sakte hain.
  --
  -- SECURITY NOTE: ye sirf USER PREFERENCE hain, authorization nahi.
  -- Real content-upload permission backend me alag check hogi (upload
  -- endpoint par). Ye flag UI ko batata hai ki toggle kya dikhana hai.
  content_upload_enabled BOOLEAN NOT NULL DEFAULT true,
  subscriptions_enabled BOOLEAN NOT NULL DEFAULT true,

  -- ---- NOTIFICATIONS (bhi ek jagah, future-proof) ----
  email_notifications BOOLEAN NOT NULL DEFAULT true,

  -- ---- Timestamps ----
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_settings IS
  'Single source of truth for user preferences (theme, language, accent, feature toggles). One row per user, created lazily on first settings read.';

-- ============================================================================
-- TABLE 2: click_events geo/device enrichment - RETIRED LEDGER
-- ============================================================================
--
-- ---- WHY THIS SECTION NO LONGER CREATES ANYTHING ON A FRESH DATABASE ----
--
-- Original purpose: "superadmin ko pata chale user KIS DESH se, KIS DEVICE se,
-- KIS BROWSER se aaya". So `click_events` gained `country`, `continent`,
-- `device_type`, `browser`, `os` and `session_id`.
--
-- That ledger has since MOVED. `ui_click_events` in `analytics-service` is
-- authoritative, and `model.ClickEvent` was deliberately removed from
-- `MigratedModels()` - with the reason written down there: leaving it registered
-- would make AutoMigrate recreate `click_events` on every boot, so the table
-- could never actually go away and you would have TWO ledgers with no way to tell
-- which one is read.
--
-- But this migration kept `ALTER TABLE click_events ...` unguarded. On a database
-- where the table still exists that is harmless. On a fresh one it is fatal:
--
--     ERROR: relation "click_events" does not exist
--
-- which is how the chain came to be un-runnable from 001 upward - the service
-- could not be provisioned at all. Verified against a real empty database while
-- fixing this.
--
-- ---- WHAT IT DOES INSTEAD ----
--
--   * Table present (every existing deployment) -> the columns are added, exactly
--     as before. Nothing about a live database changes.
--   * Table absent (a fresh deployment) -> the section is SKIPPED with a NOTICE.
--     No dead ledger is resurrected, because resurrecting it is precisely the
--     outcome the Go-side removal was trying to prevent.
--
-- The equivalence it gives up is stated rather than hidden: a brand-new install
-- no longer has geo/device columns on a legacy table, because it does not have
-- that table. The equivalent data is in `analytics-service.ui_click_events`.
--
-- ---- PRIVACY, unchanged ----
--
-- Location data is country-level only - never city, never precise - and is
-- visible only in the superadmin panel, for analytics and audit. That is the
-- GDPR-shaped choice: exact location would require consent and a stated purpose.
-- Values are derived from request headers; when a header is missing the column
-- stays NULL. A faked default would be worse than a gap.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'click_events'
  ) THEN
    RAISE NOTICE
      '007: click_events is absent - skipping geo/device enrichment. That ledger '
      'has moved to analytics-service.ui_click_events, and recreating the table '
      'here would produce a second, unread one. Nothing to do.';

    -- Country (ISO 3166-1 alpha-2, e.g. "IN", "US")
  END IF;

  -- ---- Everything below is a no-op unless the legacy table is still here ----
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'click_events'
  ) THEN

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'click_events' AND column_name = 'country'
  ) THEN
    ALTER TABLE click_events ADD COLUMN country VARCHAR(2);
  END IF;

  -- Continent (e.g. "AS", "EU", "NA")
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'click_events' AND column_name='continent'
  ) THEN
    ALTER TABLE click_events ADD COLUMN continent VARCHAR(8);
  END IF;

  -- ---- DEVICE CLASS ----
  -- 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown'
  -- Derived from UA + client hints. NULL = could not determine.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'click_events' AND column_name='device_type'
  ) THEN
    ALTER TABLE click_events ADD COLUMN device_type VARCHAR(16);
  END IF;

  -- ---- BROWSER (name + major version) ----
  -- "Chrome 131" jaisa. Raw UA se parse.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'click_events' AND column_name='browser'
  ) THEN
    ALTER TABLE click_events ADD COLUMN browser VARCHAR(64);
  END IF;

  -- ---- OS ----
  -- "Windows 11", "Android 14", "iOS 17" jaisa.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'click_events' AND column_name='os'
  ) THEN
    ALTER TABLE click_events ADD COLUMN os VARCHAR(64);
  END IF;

  -- ---- SESSION ID (click ko login session se jodne ke liye) ----
  -- Bina iske "kaun sa user, kaun sa device" correlate nahi hoga - ek
  -- anonymous visitor ke clicks alag, ek logged-in user ke alag.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'click_events' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE click_events ADD COLUMN session_id UUID;
  END IF;

  END IF; -- table present
END $$;

-- ---------------------------------------------------------------------------
-- Indexes and comments - ALSO guarded.
-- ---------------------------------------------------------------------------
--
-- These were bare statements. `CREATE INDEX ... ON click_events(country)` on an
-- absent table fails exactly like the ALTER did, so guarding only the columns
-- would have moved the failure three lines down rather than removing it.
--
-- `EXECUTE` with a quoted literal, because a plain `CREATE INDEX` inside plpgsql
-- is a DDL statement and plpgsql only accepts DDL through EXECUTE - it will not
-- plan `CREATE INDEX` as static SQL. The same applies to `COMMENT ON`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'click_events'
  ) THEN
    -- Index: superadmin panel filters by country/device/time
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_click_events_country ON click_events(country)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_click_events_device  ON click_events(device_type)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_click_events_session ON click_events(session_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_click_events_time    ON click_events(timestamp DESC)';

    EXECUTE $cmt$
      COMMENT ON COLUMN click_events.country IS
        'ISO 3166-1 alpha-2 country derived from request IP geo headers. NULL when unavailable (never faked).'
    $cmt$;
    EXECUTE $cmt$
      COMMENT ON COLUMN click_events.continent IS
        'Continent derived from country. NULL when country unknown.'
    $cmt$;
    EXECUTE $cmt$
      COMMENT ON COLUMN click_events.device_type IS
        'Device class parsed from User-Agent/client hints: mobile, tablet, desktop, bot, or unknown.'
    $cmt$;
  END IF;
END $$;

-- ============================================================================
-- PROMOTION: koi user ko superadmin banana ho to:
--   UPDATE users SET role = 'superadmin' WHERE email = 'aapka@email.com';
-- ============================================================================
