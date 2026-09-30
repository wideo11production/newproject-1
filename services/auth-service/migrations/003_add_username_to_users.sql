-- ============================================================================
-- 003_add_username_to_users.sql   (PostgreSQL)
-- ============================================================================
-- PURPOSE: `users.username` - creator ka public handle.
--
-- ---- KYUN YE ALAG MIGRATION HAI ----
-- `001` me `username` already tha, par wo table tab ban rahi thi jab ye
-- column abhi plan me nahi tha. Column add kiya gaya, phir backfill kiya
-- gaya, phir unique index. Teen steps - isiliye teen migrations nahi, ek.
--
-- ---- NULLABLE KYON ----
-- Backfill ke baad har row ka username ho jata hai, par NOT NULL nahi lagaya
-- gaya. Soft-deleted user ka username kya release hoga ye product decision
-- hai; jaise hi decide ho jaye, yeh file me `SET NOT NULL` add karna hai.
-- Naye registrations ke liye API-level validation hi asli guard hai.
--
-- ---- IDEMPOTENT ----
-- Har statement `IF [NOT] EXISTS` se guarded hai. `psql -f` se manually
-- chalti hai (koi runner nahi), isliye dobara chalana routine hai.
--
-- Hinglish comments: har step ka arth
-- ============================================================================

BEGIN;

-- ---- Step 1: column add karo (agar pehle se nahi hai) ----
IF NOT EXISTS (
  SELECT 1
  FROM sys.columns c
  INNER JOIN sys.tables t ON t.object_id = c.object_id
  WHERE t.name = 'users' AND c.name = 'username'
)
BEGIN
  ALTER TABLE users ADD username VARCHAR(100);
END;

-- ---- Step 2: backfill ----
-- Sirf un rows ke liye jinka username abhi NULL/empty hai.
--
-- Source: email ka local-part. `aarav.sharma@gmail.com` -> `aarav.sharma`.
-- Uske baad sirf `[a-z0-9._-]` characters rakhte hain, phir duplicate par
-- `-2`, `-3`... suffix lagate hain - taki unique index ban sake.
--
-- NOTE: ye ek baar chalega. `id` ko row_number se order karke `created_at`
-- ke kareeb sequence dete hain, jisse suffix consistently predictable rehta
-- hai. Kyunki ye deterministic order hai, replay par wahi names aate hain -
-- koi naya random data generate nahi hota.
WITH ordered AS (
  SELECT
    id,
    row_number() OVER (ORDER BY created_at, id) AS rn
  FROM users
  WHERE username IS NULL OR username = ''
),
candidates AS (
  SELECT
    o.id,
    NULLIF(
      regexp_replace(
        split_part(lower(u.email), '@', 1),
        '[^a-z0-9._-]', '', 'g'
      ),
      ''
    ) AS base,
    o.rn
  FROM ordered o
  JOIN users u ON u.id = o.id
),
deduped AS (
  SELECT
    id,
    -- suffix tabhi lagta hai jab base pehle se kisi aur row ka username hai
    CASE
      WHEN base IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM users x WHERE x.username = candidates.base
      )
      THEN base
      ELSE
        COALESCE(base, 'user')
        || '-' || (
             SELECT count(*) FROM users x WHERE x.username LIKE COALESCE(base, 'user') || '-%'
           )
    END AS candidate
  FROM candidates
)
UPDATE u
SET username = d.candidate
FROM users AS u
JOIN deduped AS d ON u.id = d.id
WHERE
  (u.username IS NULL OR u.username = '');

-- ---- Step 3: unique index (agar pehle se nahi hai) ----
-- CONCURRENTLY nahi use kiya - `CREATE INDEX CONCURRENTLY` transaction block
-- ke andar nahi chal sakta, aur ye ek chhoti dev table hai.
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'idx_users_username'
    AND object_id = OBJECT_ID('users')
)
BEGIN
  CREATE UNIQUE INDEX idx_users_username
    ON users (username);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.extended_properties ep
  WHERE ep.major_id = OBJECT_ID('users')
    AND ep.minor_id = COLUMNPROPERTY(OBJECT_ID('users'), 'username', 'ColumnId')
    AND ep.name = 'MS_Description'
)
BEGIN
  EXEC sys.sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'Public creator handle. Nullable only for legacy rows created before migration 003; new registrations require it via API validation.',
    @level0type = N'SCHEMA',
    @level0name = N'dbo',
    @level1type = N'TABLE',
    @level1name = N'users',
    @level2type = N'COLUMN',
    @level2name = N'username';
END
ELSE
BEGIN
  EXEC sys.sp_updateextendedproperty
    @name = N'MS_Description',
    @value = N'Public creator handle. Nullable only for legacy rows created before migration 003; new registrations require it via API validation.',
    @level0type = N'SCHEMA',
    @level0name = N'dbo',
    @level1type = N'TABLE',
    @level1name = N'users',
    @level2type = N'COLUMN',
    @level2name = N'username';
END;

COMMIT;