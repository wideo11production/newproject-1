-- ============================================================================
-- 012_cascade_user_deletions.sql   (PostgreSQL)
-- ============================================================================
-- PURPOSE: har user-referencing foreign key par ON DELETE CASCADE.
--
-- ---- BUG ----
-- `users` ko 9 foreign keys reference karti thi, aur unme se sirf 3 par
-- CASCADE tha. Baaki 6 par NO ACTION (Postgres ka default) tha:
--
--   fk_users_sessions           sessions
--   fk_users_devices            devices
--   fk_users_pi_ns              pins
--   fk_refresh_tokens_user      refresh_tokens
--   fk_verification_tokens_user verification_tokens
--   fk_webauthn_credentials_user webauthn_credentials
--
-- Iska matlab: `DELETE FROM users WHERE id = ...` CHALTA HI NAHI.
--
--     ERROR: update or delete on table "users" violates foreign key
--            constraint "fk_users_sessions" on table "sessions"
--     DETAIL: Key (id)=(...) is still referenced from table "sessions".
--
-- Ye teen problems banata hai:
--
--   1. ACCOUNT DELETION / DATA ERASURE AAJ KABHI COMPLETE NAHI HOTI. User
--      khud ya admin account hatana chahe, database refuse kar deta hai. Jo
--      GDPR/erasure request aati hai wo deliver hi nahi ho sakti - aur ye
--      PII (IP, user agent) ko saalon tak rok deta hai.
--
--   2. ORPHANED ROWS. Soft delete (`deleted_at`) se user "delete" hota to
--      bhi ye rows waise hi padh rehti hain. Ye retention worker ke
--      scope se bahar hoti hain, isliye kabhi clean nahi hoti.
--
--   3. SILENT DATA LEAK. `webauthn_credentials`, `sessions` aur
--      `refresh_tokens` me authentication material hota hai. Ye rows user
--      ke delete hone ke baad bhi mehsoos hoti hain.
--
-- ---- WHY CASCADE AUR NAHI KOI AUR RULE ----
-- Ye sab CHILD rows hain - unki existence ka matlab hi parent user se hai.
-- `SET NULL` galat hota (user_id NOT NULL hai), `RESTRICT` to current
-- behaviour hi hai.
--
-- CASCADE safe hai kyunki `internal/purge.HardDelete` already ye children
-- EXPLICITLY pehle delete karta hai, phir user ko. Explicit delete ke baad
-- cascade ko kuch nahi milta - dono raaste compatible hain. Isiliye ye
-- change application logic ko touch nahi karta, sirf woh gap fill karta hai
-- jahan koi aur code path user row delete kare.
--
-- ---- sessions -> devices ----
-- `fk_sessions_device` bhi NO ACTION tha. Device delete karte hi sessions
-- orphan ho jaati thin, jabki wo device ka hissa hain. Ye bhi CASCADE.
--
-- ---- NOTES ----
--   - Constraint ko drop karke dobara banana ZAROORI hai: `ALTER TABLE ...
--     DROP CONSTRAINT` ke bina `ON DELETE` clause change nahi hota.
--   - Ye DROP + CREATE pattern `ALTER CONSTRAINT` se zyada robust hai -
--     chahe constraint GORM ne banayi ho (jiska exact naam pata nahi) ya SQL
--     migration ne. Constraint name match nahi hua to `IF EXISTS` se drop
--     chupke se ho jata hai aur naya wahi naam se banta hai.
--   - GORM AutoMigrate ye generate karta hai, par sirf tab jab wo table
--     create kare. Existing tables par woh constraint modify nahi karta.
--     Isi liye ye SQL step zaroori hai.
--
-- Hinglish: user delete hua to uska saara data bhi jaye - warna PII aur
--           auth material orphan rows me atak jate hain
-- ============================================================================

BEGIN;

-- ---- Step 1: sessions -> users ----
ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS fk_users_sessions;

ALTER TABLE sessions
  ADD CONSTRAINT fk_users_sessions
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ---- Step 2: devices -> users ----
ALTER TABLE devices
  DROP CONSTRAINT IF EXISTS fk_users_devices;

ALTER TABLE devices
  ADD CONSTRAINT fk_users_devices
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ---- Step 3: pins -> users ----
ALTER TABLE pins
  DROP CONSTRAINT IF EXISTS fk_users_pi_ns;

ALTER TABLE pins
  ADD CONSTRAINT fk_users_pi_ns
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ---- Step 4: refresh_tokens -> users ----
ALTER TABLE refresh_tokens
  DROP CONSTRAINT IF EXISTS fk_refresh_tokens_user;

ALTER TABLE refresh_tokens
  ADD CONSTRAINT fk_refresh_tokens_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ---- Step 5: verification_tokens -> users ----
ALTER TABLE verification_tokens
  DROP CONSTRAINT IF EXISTS fk_verification_tokens_user;

ALTER TABLE verification_tokens
  ADD CONSTRAINT fk_verification_tokens_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ---- Step 6: webauthn_credentials -> users ----
-- Ye sabse sensitive hai. Credential row user ke delete hone ke baad bhi
-- bachti to wo ek chhupa hua login path ban sakti thi.
ALTER TABLE webauthn_credentials
  DROP CONSTRAINT IF EXISTS fk_webauthn_credentials_user;

ALTER TABLE webauthn_credentials
  ADD CONSTRAINT fk_webauthn_credentials_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ---- Step 7: sessions -> devices ----
ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS fk_sessions_device;

ALTER TABLE sessions
  ADD CONSTRAINT fk_sessions_device
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE;

COMMIT;

-- ============================================================================
-- Verification (run AFTER applying)
-- ============================================================================
-- -- Expect every row to be CASCADE:
-- SELECT c.conname,
--        src.relname AS child,
--        tgt.relname AS parent,
--        CASE c.confdeltype
--          WHEN 'c' THEN 'CASCADE'
--          WHEN 'a' THEN 'NO ACTION'
--          WHEN 'n' THEN 'SET NULL'
--          WHEN 'r' THEN 'RESTRICT'
--          ELSE c.confdeltype::text
--        END AS on_delete
--   FROM pg_constraint c
--   JOIN pg_class src ON src.oid = c.conrelid
--   JOIN pg_class tgt ON tgt.oid = c.confrelid
--  WHERE c.contype = 'f'
--  ORDER BY tgt.relname, src.relname;
--
-- Koi bhi 'NO ACTION' bacha to wo abhi bhi delete block karega.
--
-- Live check (ek dummy user ke saath, phir undo):
--   BEGIN;
--   INSERT INTO users (email, password_hash, username) VALUES ('fk@test.local','x','fktest');
--   DELETE FROM users WHERE email = 'fk@test.local';   -- must succeed
--   ROLLBACK;