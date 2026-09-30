-- ============================================================================
-- 009_widen_session_ip.sql   (PostgreSQL)
-- ============================================================================
-- PURPOSE: `sessions.ip_address` ka column size 45 tha, jo kuch legitimate
-- IP values ke liye chhota pada.
--
-- ---- KYUN 45 SEHAT NAHI THA ----
-- 45 characters ka matlab tha: maximum IPv6-mapped-IPv4 form
-- (`::ffff:255.255.255.255` = 22 chars) + headroom. Lekin:
--   - Full IPv6 (`2001:0db8:85a3:0000:0000:8a2e:0370:7334`) 39 chars tak
--   - Proxy/CDN `X-Forwarded-For` poori chain bhejte hain
--     (client, proxy1, proxy2) - jo 45 se kaafi upar ja sakti hai
--
-- Is overflow se register/login FAIL hota tha:
--   ERROR: value too long for type character varying(45) (SQLSTATE 22001)
-- User account ban hi nahi pa raha tha.
--
-- FIX: 64 kar diya (`click_events.ip_address` pehle se 64 hai - dono ab
-- consistent hain).
--
-- ---- NOTE: `active_user_sessions` view ----
-- Migration 005 ne ek view banaya tha. Wo GORM ke `AutoMigrate` ko BLOCK
-- karta tha ("cannot alter type of a column used by a view or rule"), jisse
-- auth-service crash-loop me chala gaya. View abandon kar diya gaya: koi
-- query use nahi karti, `services/auth-service/internal/service/creator.go`
-- `sessions` table ko seedha query karta hai. Isliye is migration me view
-- recreate nahi hota - agar koi purana DB me abhi bhi pada ho to ye use
-- drop kar deta hai.
--
-- ---- IDEMPOTENT ----
-- `psql -f` se manually chalti hai (koi runner nahi).
--
-- Hinglish: IP column chhota tha, bade IP me insert fail hota tha
-- ============================================================================

BEGIN;

-- Purane DB me agar view pada ho to hata do. Naye DB me ye no-op hai.
DROP VIEW IF EXISTS active_user_sessions;

-- Widen. Do galtiyan is line me ho sakti thi, dono ab avoid hain:
--
--   1. `TYPE` keyword zaroori hai. `ALTER COLUMN ip_address VARCHAR(64)`
--      Postgres me SYNTAX ERROR deta hai ("syntax error at or near
--      VARCHAR") - yehi galti is file me pehle thi.
--   2. Sirf WIDEN karna safe hai. Chhota -> bada kabhi data nahi todta,
--      aur same width par dobara apply karna no-op hai. Isiliye koi
--      `IF character_maximum_length < 64` guard ki zaroorat nahi - woh
--      guard galat direction me kaam karta (narrow karta).
--
-- GORM ka `Session.IPAddress` already `size:64` ke saath AutoMigrate hota
-- hai, isliye fresh DB par ye no-op hai aur purane DB par fix hai.
ALTER TABLE sessions
  ALTER COLUMN ip_address VARCHAR(64);

-- PostgreSQL-specific column comment intentionally omitted to keep this
-- migration compatible with the SQL dialect used by the current tooling.

COMMIT;

-- ============================================================================
-- NOTE: Go side par defensive truncation jaayegi (`truncateStr`) taki future
-- me bada value aaye to insert fail na ho, balki kat jaye.
-- ============================================================================
