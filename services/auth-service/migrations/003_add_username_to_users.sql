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
--
-- -----------------------------------------------------------------------------
-- THE COMMENT ABOVE DESCRIBED THIS FIX. THE CODE BELOW IT WAS STILL T-SQL.
-- -----------------------------------------------------------------------------
--
-- Lines 29-33 have explained the correct statement since before this session.
-- The statement they describe was never actually written — the T-SQL block was
-- still there underneath, so every replay of this file failed with:
--
--     ERROR: syntax error at or near "IF" (SQLSTATE 42601)
--
-- This is the repository's own recurring lesson, and this is occurrence six:
--
--   1. ticket.upload_url - a comment-level drift between two copies
--   2. ALTER COLUMN ... TYPE - a comment saying "TYPE added", statement had none
--   3. a # security_profile comment justifying an omitted COMMENT ON
--   4. prometheusUrl - a comment explaining why it must not be sent, on the
--      line above the statement sending it
--   5. TestFinishAuthenticationIssuesASession - a comment mentioning the call
--      that had been deleted
--   6. THIS MIGRATION - a comment describing the correct SQL, directly above the
--      wrong SQL
--
-- Why it went unnoticed for so long: every existing database already has the
-- `username` column, and the migrator records applied versions in
-- `schema_migrations`, so this file is skipped on every deployed instance. It
-- only runs on a SCRATCH database - which is to say, it only runs when somebody
-- builds a new environment from scratch.
--
-- That is the worst possible place for a migration to be broken: the failure is
-- invisible in production and total on a fresh deploy. `AUTH_MIGRATION_REPLAY=1`
-- in `internal/database` is what exercises it, and it is opt-in, so `go test
-- ./...` without the flag never sees it.
--
-- `ADD COLUMN IF NOT EXISTS` gives exactly the guarantee the T-SQL guard was
-- reaching for: add the column if absent, do nothing if present, no block needed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);

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
--
-- CONCURRENTLY nahi use kiya - `CREATE INDEX CONCURRENTLY` transaction block
-- ke andar nahi chal sakta, aur ye ek chhoti dev table hai.
--
-- -----------------------------------------------------------------------------
-- `IF NOT EXISTS`, BECAUSE THE HEADER PROMISES RE-RUNNING IS ROUTINE
-- -----------------------------------------------------------------------------
--
-- Lines 18-20 of this file say the whole thing: "ye script `psql -f` se dobara
-- chalana routine hai" - re-running this file with `psql -f` is routine. Bare
-- `CREATE UNIQUE INDEX` is not re-runnable: the second run fails with
--
--     ERROR: relation "idx_users_username" already exists (SQLSTATE 42P07)
--
-- and, because the file wraps itself in `BEGIN; ... COMMIT;`, that error aborts
-- the transaction - so the second run undoes the backfill too. A migration
-- documented as safe to re-run, which is not, fails in the way that looks like
-- data loss rather than like a syntax problem.
--
-- `CREATE UNIQUE INDEX IF NOT EXISTS` is supported from PostgreSQL 9.5 and gives
-- exactly the "create if absent" guarantee the header promises. It is NOT a
-- validity check, though: if an index of that name already exists with a
-- DIFFERENT definition, PostgreSQL skips it silently and you get no warning. That
-- is acceptable here because the name and definition are both fixed in this file
-- and nothing else creates it.
--
-- The alternative - a `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_indexes ...) $$
-- END $$;` block - would notice that case, at the cost of a block that cannot be
-- written in plain SQL and therefore does not survive being pasted into psql by
-- hand. The simple form is the better trade for a table this size.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- ---- Step 4: describe the column ----
--
-- -----------------------------------------------------------------------------
-- THIS WAS PURE SQL SERVER AND IT NEVER RAN
-- -----------------------------------------------------------------------------
--
-- The original Step 4 was:
--
--   IF EXISTS (SELECT 1 FROM sys.extended_properties ep JOIN sys.columns c ...)
--   BEGIN EXEC sys.sp_updateextendedproperty ... END
--   ELSE
--   BEGIN EXEC sys.sp_addextendedproperty  ... END
--
-- None of that exists in PostgreSQL. Not `sys.*`, not `OBJECT_ID`, not
-- `sp_addextendedproperty`, not the `ELSE` after a bare `IF`. So this file could
-- not possibly have run to completion, on any database, ever.
--
-- Same shape as Step 1 above, and the same lesson: the PostgreSQL version was
-- described in a neighbouring comment and never written.
--
-- The equivalent is `COMMENT ON COLUMN`, which is:
--
--   - idempotent by construction. Re-running it REPLACES the comment rather than
--     erroring, so the `IF EXISTS / ELSE` fork that SQL Server needed has no
--     analogue and none is required. A migration that is safe to re-run is what
--     the `IF EXISTS` pair was reaching for.
--   - `COMMENT ON ... IS NULL` removes a comment, so there is no third branch to
--     write either.
--   - transaction-safe, which matters here because the file wraps itself in
--     `BEGIN; ... COMMIT;`.
--
-- `psql -f` is documented as the routine way to re-run this file, and the old
-- form would have thrown on the second run even if it had parsed at all.
COMMENT ON COLUMN users.username IS 'Public creator handle. Nullable only for legacy rows created before migration 003; new registrations require it via API validation.';

COMMIT;