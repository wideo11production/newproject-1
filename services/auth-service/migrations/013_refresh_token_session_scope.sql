-- ============================================================================
-- 013_refresh_token_session_scope.sql   (PostgreSQL)
-- ============================================================================
--
-- PURPOSE: har refresh token ko us SESSION se jodna, taaki logout EK device
--          par doosre devices ko maar na sake.
--
-- ---- BUG ----
--
-- `Logout` aaj ye karta hai:
--
--     sessionRepo.Revoke(session.ID)              -- sirf ye session
--     tokenRepo.RevokeAllByUserID(session.UserID) -- user ke SAARE tokens
--
-- Doosri line saare devices ke refresh tokens ek saath revoke kar deti hai.
-- Matlab user apne phone se logout karta hai aur uska laptop bhi logout ho
-- jata hai - bina uske kuch kiye. Ye "logged out everywhere" behaviour koi
-- nahi maangta, aur jo user multiple tabs/devices par kaam karta hai uske
-- liye ye kaam karna band kar deta hai.
--
-- ---- ROOT CAUSE: refresh_tokens me SESSION KA TRACE HI NAHI THA ----
--
--     CREATE TABLE refresh_tokens (
--       id, user_id, token_hash, expires_at, revoked_at, created_at
--     )
--
-- Sirf `user_id` hai. Token dekh kar ye PATA hi nahi chalta ki wo kis
-- session/device se belong karta hai - `sessions` table me wo hash nahi hai.
-- Isliye "sirf ye token" kehna database level par IMPOSSIBLE tha, aur broad
-- query hi ek available option bachi.
--
-- ---- FIX ----
--
-- Naya nullable column `session_id`, aur uspe:
--   - index (login/refresh dono me lookup hai)
--   - foreign key -> sessions(id) ON DELETE CASCADE
--
-- CASCADE isliye: session delete hua to uska refresh token bhi delete hona
-- chahiye. Warna orphan token row reh jayegi jo kabhi match nahi hogi par
-- table me rahegi - yahi "orphaned rows" pattern jo migration 012 ne users
-- ke liye theek kiya tha, aur ab sessions ke liye theek ho raha hai.
--
-- ---- NULLABLE KYUN ----
--
-- Jo tokens PEHLE se maujood hain unme session_id NULL hoga. Unhe NOT NULL
-- karne se purana data migrate nahi hoga, aur app start hi nahi hoga.
-- NULL ka matlab: "purana token, unknown session" - jise rotation par
-- turant ek session se baad diya jayega, aur logout unhe
-- `RevokeAllByUserID` se hi marega, jaise aaj ho raha hai. Matlab purane
-- tokens ke liye BEHAVIOUR UNCHANGED hai; naye tokens precise path par jate
-- hain. Ye gradual cutover hai, big bang nahi.
--
-- ---- NOTES ----
--   - `IF NOT EXISTS` se idempotent hai: dobara chalane par kuch nahi hota.
--   - Constraint name GORM ke pattern me hai taaki AutoMigrate (jo ye table
--     kabhi kabhi create karta hai) se clash na ho.
--   - Hinglish: refresh token ko us session se jodo. Bina iske "sirf ye device
--     logout karo" database par likha hi nahi ja sakta.
-- ============================================================================

BEGIN;

-- ---- Step 1: column ----
-- `gen_random_uuid()` se nahi: ye column kisi row par NULL ho sakta hai (purane
-- tokens), aur default sirf INSERT ke waqt lagta hai.
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS session_id uuid NULL;

-- ---- Step 2: index ----
-- Login aur refresh dono me `WHERE session_id = ?` lookup hai. Bina index ke
-- ye WHERE un-indexed column par jayega - aur refresh token rotation har
-- request par hota hai, yaani ye NUCLEAR hot-path query hai.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id
  ON refresh_tokens (session_id);

-- ---- Step 3: foreign key with CASCADE ----
-- Session delete -> uske saare refresh tokens delete.
-- Ye `sessions.id` par hai (user par nahi), kyunki hum device-scope
-- isolation chahte hain, user-scope nahi.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_refresh_tokens_session'
  ) THEN
    ALTER TABLE refresh_tokens
      ADD CONSTRAINT fk_refresh_tokens_session
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
  END IF;
END
$$;

-- ---- Step 4: backfill what we can ----
-- Purane sessions (jo abhi bhi live hain) ke tokens ko unke user ke sabse
-- naye live session se jod dete hain. Ye perfect nahi hai - user ek se zyada
-- device par ho to galat session mil sakta hai - lekin ye UNIQUE constraint
-- nahi hai (refresh_tokens pe koi unique nahi hai), aur isse existing rows
-- NULL nahi rehengi. Jo galat associate hua, wo apni TTL par expire hokar
-- hat jayega.
--
-- `DISTINCT ON` zaroori hai: ek user ke paas kai tokens ho sakte hain, aur
-- bina iske UPDATE ek token ko kai baar match kar sakta hai (ek row, kai
-- source rows) - jo GORM/Postgres me "UPDATE ... FROM" se unpredictable
-- pairing de sakta hai.
UPDATE refresh_tokens rt
SET session_id = s.id
FROM (
  SELECT DISTINCT ON (user_id) id, user_id
  FROM sessions
  WHERE revoked_at IS NULL
  ORDER BY user_id, created_at DESC
) s
WHERE s.user_id = rt.user_id
  AND rt.session_id IS NULL
  AND rt.revoked_at IS NULL;

COMMIT;

-- ============================================================================
-- Verification (run AFTER applying)
-- ============================================================================
-- -- Column exists?
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'refresh_tokens' AND column_name = 'session_id';
--
-- -- Index + FK present?
-- SELECT indexname FROM pg_indexes WHERE tablename = 'refresh_tokens';
-- SELECT conname, confdeltype FROM pg_constraint
--  WHERE conname = 'fk_refresh_tokens_session';
--
-- -- Kitne tokens ab bhi NULL (purane, un-tracked)?
-- SELECT count(*) FROM refresh_tokens WHERE session_id IS NULL;
--
-- -- Live check (dummy user, phir undo):
--   BEGIN;
--   INSERT INTO users (email, password_hash, username) VALUES ('rt@test.local','x','rttest');
--   -- ... register + login twice (do alag sessions) ...
--   -- phir ek session logout karo aur doosri ZINDA rahe:
--   SELECT count(*) FROM refresh_tokens WHERE revoked_at IS NULL;
--   ROLLBACK;
