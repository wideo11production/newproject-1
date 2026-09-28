-- ============================================================================
-- 003_add_username_to_users.sql
-- ============================================================================
-- PURPOSE: `users` table me `username` column add karta hai.
--
-- ---- WHY YE MIGRATION ZAROORI HAI (schema drift) ----
-- `001_create_users_table.sql` me `username VARCHAR(100) UNIQUE NOT NULL`
-- PEHLE SE defined hai. Lekin LIVE database me ye column KABHI create nahi
-- hua - verified:
--     \d users  ->  username column listed nahi hai
-- Yaani migration file aur actual schema DIVERGE kar chuke hain. Is
-- migration ke baad dono align ho jaate hain.
--
-- ---- SAFE KE LIYE DESIGN ----
-- 1. IDEMPOTENT: `IF NOT EXISTS` use kiya hai. Ye script 10 baar bhi
--    chala do, koi error nahi, koi duplicate column nahi.
--
-- 2. NULLABLE RAKHA GAYA (NOT NULL nahi kiya):
--    Table me 9 users PEHLE SE hain (test accounts). Agar abhi NOT NULL
--    lagate to un rows ke liye koi value nahi hoti aur ALTER fail ho
--    jata. Isliye:
--      - Column NULLABLE add kiya
--      - Backfill: existing users ko unke email ka local-part diya
--        (jaise `aarav@gmail.com` -> `aarav`) - unique hone ki guarantee
--        nahi hai, islie uniqueness check lagaya hai
--      - NOT NULL BAAD ME constraint file se enforce hoga (comment me
--        documented), jab sab users ka username ho
--    Naye registrations ke liye ye effectively required hai - register
--    API validation usko reject karta hai agar missing ho.
--
-- ---- BACKFILL UNIQUENESS ----
-- Plpgsql me loop chalakar duplicate suffix (`-2`, `-3`...) lagaya gaya
-- hai taaki UNIQUE index banane par constraint violation na aaye.
--
-- Hinglish comments: har step ka arth
-- ============================================================================

-- ---- Step 1: column add karo (agar pehle se nahi hai) ----
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username VARCHAR(100);

-- ---- Step 2: backfill - existing users ko email ka local-part do ----
-- Sirf un rows ke liye jinka username abhi NULL/empty hai.
DO $$
DECLARE
    rec RECORD;
    base TEXT;
    candidate TEXT;
    suffix INT := 2;
BEGIN
    FOR rec IN
        SELECT id, email FROM users
        WHERE username IS NULL OR username = ''
        ORDER BY created_at ASC
    LOOP
        -- Email ka local part: 'aarav.sharma@gmail.com' -> 'aarav.sharma'
        base := split_part(rec.email, '@', 1);

        -- Sirf safe characters rakho (letters, digits, dot, underscore, dash)
        base := regexp_replace(base, '[^a-zA-Z0-9._-]', '', 'g');

        -- Edge case: email local part empty ya sab special tha
        IF base = '' THEN
            base := 'user';
        END IF;

        -- 100 char se lamba email local part ho sakta hai - truncate
        base := left(base, 100);

        candidate := base;

        -- UNIQUE guarantee: agar same naam already hai to -2, -3 ... lagao
        WHILE EXISTS (SELECT 1 FROM users WHERE username = candidate) LOOP
            candidate := left(base, 96) || '-' || suffix::TEXT;
            suffix := suffix + 1;
        END LOOP;

        UPDATE users SET username = candidate WHERE id = rec.id;

        -- Har row ke liye suffix reset taaki counter overflow na ho
        suffix := 2;
    END LOOP;
END $$;

-- ---- Step 3: unique index banao (agar pehle se nahi hai) ----
-- CONCURRENTLY nahi use kiya - ye ek chhoti dev table hai (9 rows), aur
-- CONCURRENTLY transaction block ke andar nahi chal sakta.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- ---- Step 4: comment ----
COMMENT ON COLUMN users.username IS
  'Public handle for the creator (e.g. "aarav"). Nullable only for legacy rows created before migration 003; new registrations require it.';

-- ============================================================================
-- NOTE (NOT NULL constraint - abhi nahi lagaya):
--
--   ALTER TABLE users ALTER COLUMN username SET NOT NULL;
--
-- Ye command tabhi chalao jab SAB users ka username non-null ho:
--
--   SELECT count(*) FROM users WHERE username IS NULL;   -- 0 hona chahiye
--
-- Abhi 003 ke baad ye count 0 aayega (kyunki backfill sab rows ko value
-- deta hai), lekin nayi rows ke liye API-level validation hi asli guard
-- hai. Hard DB constraint tabhi add karna jab soft-delete + re-register
-- flow ka behaviour confirm ho jaye (delete hone par username free hone
-- chahiye ya reserved rahe - ye product decision hai).
-- Hinglish: username ab nullable hai table-level; naye users ke liye API
--   par required hai. Full DB constraint baad me.
-- ============================================================================
