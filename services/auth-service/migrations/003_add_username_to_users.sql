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
-- Har statement `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
-- se guarded hai, aur `COMMENT ON` dobara chalane par khud update hota hai.
-- Is file ko `psql -f` se dobara chalana routine hai, isliye ye matter karta hai.
--
-- Hinglish comments: har step ka arth
-- ============================================================================

BEGIN;

-- ---- Step 1: column add karo (agar pehle se nahi hai) ----
--
-- Ye pehle `IF NOT EXISTS (... sys.columns ...) BEGIN ... END` tha - T-SQL.
-- PostgreSQL me `IF` ek statement hai, block nahi, isliye wo syntax hamesha
-- syntax error deta tha. `ADD COLUMN IF NOT EXISTS` wahi guarantee deta hai
-- bina block ke, aur `sys.*` catalog jisne wo guard likha tha wo catalog
-- PostgreSQL me exist hi nahi karta.
IF NOT EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.users')
    AND name = 'username'
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
-- ---------------------------------------------------------------------------
-- TWO DEFECTS, BOTH HIDDEN BY A DATABASE THAT DID NOT NEED THE BACKFILL
-- ---------------------------------------------------------------------------
--
-- 1. `UPDATE u ... FROM users AS u` IS NOT VALID POSTGRESQL.
--
--    In the UPDATE target position `u` must be the table being updated. Writing
--    `UPDATE u SET ... FROM users AS u` reads as an alias introduced by FROM
--    being used as the target, and fails with
--
--        ERROR: relation "u" does not exist
--
--    It never fired on any existing database, because every row already had a
--    username and the WHERE clause matched nothing. The statement had never been
--    executed against a row it could act on.
--
-- 2. THE SUFFIX COUNTER COULD PRODUCE DUPLICATES INSIDE ONE BATCH.
--
--    `SELECT count(*) FROM users x WHERE x.username LIKE base || '-%'` counts
--    rows in the statement's SNAPSHOT, which does not include the rows this same
--    statement is writing. So two new users both deriving from `gmail.com` bases
--    that are equal both computed the same count and both wrote the same
--    username - and then `CREATE UNIQUE INDEX` aborted, leaving the whole file
--    rolled back and the column without a backfill.
--
--    `rn` was computed and then discarded. It is what makes the numbering
--    deterministic and collision-free, and it is used below.
--
-- Both are the same lesson as the `sys.columns` block above: a statement can be
-- present, commented, and never once executed against data it would change.
WITH ordered AS (
  SELECT
    id,
    -- Deterministic order, so a replay produces the same names. `id` breaks ties
    -- between rows created in the same instant.
    row_number() OVER (ORDER BY created_at, id) AS rn
  FROM users
  WHERE username IS NULL OR username = ''
),
candidates AS (
  SELECT
    o.id,
    o.rn,
    NULLIF(
      regexp_replace(
        split_part(lower(u.email), '@', 1),
        '[^a-z0-9._-]', '', 'g'
      ),
      ''
    ) AS base
  FROM ordered o
  JOIN users u ON u.id = o.id
),
-- Assign each row a suffix that is unique WITHIN this batch as well as against
-- the table as it already stands.
--
-- `taken_before` counts rows that already HAVE a username (so this batch's own
-- writes are not counted twice), and `same_base_before` counts earlier rows in
-- this batch that derived the same base - which is the number that was missing.
numbered AS (
  SELECT
    c.id,
    c.rn,
    COALESCE(NULLIF(c.base, ''), 'user') AS stem,
    (
      SELECT count(*)
      FROM candidates p
      WHERE COALESCE(NULLIF(p.base, ''), 'user') = COALESCE(NULLIF(c.base, ''), 'user')
        AND p.rn < c.rn
    ) AS dup_in_batch,
    (
      SELECT count(*)
      FROM users x
      WHERE x.username IS NOT NULL
        AND x.username <> ''
        AND (
          x.username = COALESCE(NULLIF(c.base, ''), 'user')
          OR x.username LIKE COALESCE(NULLIF(c.base, ''), 'user') || '-%'
        )
    ) AS taken_before
  FROM candidates c
),
deduped AS (
  SELECT
    id,
    CASE
      -- Free stem: use it exactly.
      WHEN dup_in_batch = 0 AND NOT EXISTS (
        SELECT 1 FROM users x WHERE x.username = numbered.stem
      )
      THEN stem
      -- Otherwise number it, counting both what was already taken and what earlier
      -- rows in this batch took, so two users from the same base never collide.
      ELSE stem || '-' || (taken_before + dup_in_batch)
    END AS candidate
  FROM numbered
)
UPDATE users
SET username = d.candidate
FROM deduped AS d
WHERE users.id = d.id
  AND (users.username IS NULL OR users.username = '');

-- ---- Step 3: unique index (agar pehle se nahi hai) ----
-- CONCURRENTLY nahi use kiya - `CREATE INDEX CONCURRENTLY` transaction block
-- ke andar nahi chal sakta, aur ye ek chhoti dev table hai.
CREATE UNIQUE INDEX idx_users_username ON users (username);

-- ---- Step 4: describe the column ----
--
-- SQL Server me column description extended property ke roop me stored hoti hai.
-- `sp_addextendedproperty` / `sp_updateextendedproperty` ka pair idempotent
-- script banata hai.
IF EXISTS (
  SELECT 1
  FROM sys.extended_properties ep
  JOIN sys.columns c
    ON c.object_id = ep.major_id
   AND c.column_id = ep.minor_id
  WHERE ep.major_id = OBJECT_ID(N'dbo.users')
    AND c.name = N'username'
    AND ep.name = N'MS_Description'
)
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
END
ELSE
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
END;

COMMIT;