-- ============================================================================
-- 009_widen_session_ip.sql
-- ============================================================================
-- PURPOSE: `sessions.ip_address` ka column size 45 tha, jo kuch legitimate
-- IP values ke liye chhota pada.
--
-- ---- KYUN 45 SEHAT NAHI THA ----
-- 45 characters ka matlab tha: maximum IPv6-mapped-IPv4 form
-- (`::ffff:255.255.255.255` = 22 chars) + headroom. Lekin:
--   - Full IPv6 addresses (e.g. `2001:0db8:85a3:0000:0000:8a2e:0370:7334`)
--     39 characters tak ja sakti hain
--   - Kuch proxy/CDN `X-Forwarded-For` me poori chain bhejte hain
--     (client, proxy1, proxy2) - jo 45 se kaafi upar ja sakti hai
--
-- Is overflow se register/login FAIL hota tha:
--   ERROR: value too long for type character varying(45) (SQLSTATE 22001)
-- User account ban hi nahi pa raha tha.
--
-- FIX: column ko 64 kar diya (click_events.ip_address already 64 hai -
-- dono tables ab consistent hain).
--
-- Hinglish: IP column chhota tha, bade IP me insert fail hota tha
-- ============================================================================

-- ---- STEP 1: view drop karo ----
--
-- `active_user_sessions` view (migration 007) isi column par depend karta
-- hai, aur Postgres ALTER ko view-dependent column pe BLOCK karta hai
-- ("cannot alter type of a column used by a view or rule"). Isliye pehle
-- view drop, phir ALTER, phir wapas recreate.
--
-- NOTE: view me koi custom logic nahi thi (bas SELECT + WHERE), isliye
-- recreate karna data-safe hai - koi row nahi badalti.
DROP VIEW IF EXISTS active_user_sessions;

-- ---- STEP 2: column widen karo ----
ALTER TABLE sessions
  ALTER COLUMN ip_address VARCHAR(64);

-- ---- STEP 3: view wapas banao (same definition as migration 007) ----
-- Keep CREATE VIEW isolated in its own batch for SQL tooling.
GO
CREATE VIEW active_user_sessions AS
SELECT
  s.id,
  s.user_id,
  s.device_id,
  s.ip_address,
  s.user_agent,
  s.created_at,
  s.updated_at AS last_seen,
  s.expires_at
FROM sessions s
WHERE s.deleted_at IS NULL
  AND s.revoked_at IS NULL
  AND s.expires_at > now();
GO

EXEC sys.sp_addextendedproperty
  @name = N'MS_Description',
  @value = N'Client IP from request headers (x-forwarded-for / cf-connecting-ip / x-real-ip). Sized for full IPv6 and proxy chains.',
  @level0type = N'SCHEMA',
  @level0name = N'dbo',
  @level1type = N'TABLE',
  @level1name = N'sessions',
  @level2type = N'COLUMN',
  @level2name = N'ip_address';

-- ============================================================================
-- NOTE: Go side par bhi defensive truncation jaayegi (truncateStr) taki koi
-- future me bada value aaye to insert fail na ho, balki kat jaye.
-- ============================================================================
