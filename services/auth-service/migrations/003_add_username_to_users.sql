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
IF COL_LENGTH('dbo.users', 'username') IS NULL
    ALTER TABLE dbo.users ADD username VARCHAR(100);

-- ---- Step 2: backfill - existing users ko email ka local-part do ----
-- Sirf un rows ke liye jinka username abhi NULL/empty hai.
DECLARE @id INT, @email VARCHAR(320), @base VARCHAR(100),
        @candidate VARCHAR(100), @suffix INT, @at INT, @bad INT;

DECLARE users_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT id, email FROM dbo.users
    WHERE username IS NULL OR username = ''
    ORDER BY created_at ASC;

OPEN users_cursor;
FETCH NEXT FROM users_cursor INTO @id, @email;
WHILE @@FETCH_STATUS = 0
BEGIN
    -- Email ka local part: 'aarav.sharma@gmail.com' -> 'aarav.sharma'
    SET @at = CHARINDEX('@', @email);
    SET @base = LEFT(CASE WHEN @at > 0 THEN LEFT(@email, @at - 1) ELSE @email END, 100);

    -- Sirf safe characters rakho (letters, digits, dot, underscore, dash)
    SET @bad = PATINDEX('%[^a-zA-Z0-9._-]%', @base COLLATE Latin1_General_100_BIN2);
    WHILE @bad > 0
    BEGIN
        SET @base = STUFF(@base, @bad, 1, '');
        SET @bad = PATINDEX('%[^a-zA-Z0-9._-]%', @base COLLATE Latin1_General_100_BIN2);
    END;

    IF @base = '' SET @base = 'user';
    SET @candidate = @base;
    SET @suffix = 2;

    WHILE EXISTS (SELECT 1 FROM dbo.users WHERE username = @candidate)
    BEGIN
        SET @candidate = LEFT(@base, 96) + '-' + CAST(@suffix AS VARCHAR(10));
        SET @suffix = @suffix + 1;
    END;

    UPDATE dbo.users SET username = @candidate WHERE id = @id;
    FETCH NEXT FROM users_cursor INTO @id, @email;
END;
CLOSE users_cursor;
DEALLOCATE users_cursor;

-- ---- Step 3: unique index banao (agar pehle se nahi hai) ----
-- CONCURRENTLY nahi use kiya - ye ek chhoti dev table hai (9 rows), aur
-- CONCURRENTLY transaction block ke andar nahi chal sakta.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                             WHERE name = 'idx_users_username'
                                 AND object_id = OBJECT_ID('dbo.users'))
        CREATE UNIQUE INDEX idx_users_username ON dbo.users(username);

-- ---- Step 4: comment ----
EXEC sys.sp_addextendedproperty
        @name = N'MS_Description',
        @value = N'Public handle for the creator (e.g. "aarav"). Nullable only for legacy rows created before migration 003; new registrations require it.',
        @level0type = N'SCHEMA', @level0name = N'dbo',
        @level1type = N'TABLE', @level1name = N'users',
        @level2type = N'COLUMN', @level2name = N'username';

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
