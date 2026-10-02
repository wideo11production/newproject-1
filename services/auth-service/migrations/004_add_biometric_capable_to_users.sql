-- ============================================================================
-- 004_add_biometric_capable_to_users.sql   (PostgreSQL)
-- ============================================================================
-- PURPOSE: ye column batata hai ki user ke device me biometric sensor
-- (WebAuthn) hai ya nahi.
--
-- Business rule: `complete := hasPin && hasQuestions && (!capable || bioCount > 0)`
-- - `capable = false` wale user ko biometric enroll nahi karna padta
-- - `capable = true` wale user ko enroll karna ZAROORI hai
--
-- ---- DEFAULT KYON NAHI ----
-- Column NOT NULL hai par DEFAULT nahi. GORM ka zero-value semantics
-- isko pehle chupa chhupa kar dete hain: `bool` ka zero value `false` hai,
-- isliye struct me field na bharne par Go `false` bhejta hai aur database
-- default kabhi apply nahi hota. Isiliye default `true` rakhne se koi fayda
-- nahi - service har insert par value explicitly set karta hai.
-- Gate logic Go me hai, SQL me nahi.
--
-- ---- IDEMPOTENT ----
-- `ADD COLUMN IF NOT EXISTS` + a backfill guarded by `WHERE ... IS NULL`, so
-- both steps are no-ops on a second run.
--
-- Hinglish comments: har step ka arth
-- ============================================================================

BEGIN;

-- ---- Step 1: column add karo (agar pehle se nahi hai) ----
-- NULLABLE add karte hain, kyunki NOT NULL column ko add karna puri table
-- ko scan karta hai; NULL rakhne se ye O(1) rehta hai. NOT NULL Step 3
-- me lagate hain, table chhoti hai.
--
-- `IF NOT EXISTS` — the file's header claimed idempotence and the statement did
-- not have it. Second application fails with
--
--     ERROR: column "biometric_capable" of relation "users" already exists
--
-- and because this sits ABOVE the transaction, one failure rolls back the
-- backfill in Step 2 as well.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS biometric_capable BOOLEAN;

-- ---- Step 2: backfill ----
-- NULL matlab "pata nahi". Gate ke liye safest guess `true` hai - isse user
-- se biometric maanga jata hai, aur agar uske device me sensor hi nahi hai
-- to wo `biometric/skip` se opt-out kar sakta hai. Ulta karte (default
-- `false`) to user ka security silently kam ho jata.
UPDATE users
SET biometric_capable = true
WHERE biometric_capable IS NULL;

-- ---- Step 3: NULL hatao, NOT NULL banao ----
--
-- Ye pehle `ALTER COLUMN biometric_capable BOOLEAN NOT NULL` tha, jo
-- PostgreSQL me syntactically INVALID hai:
--
--     ERROR: syntax error at or near "BOOLEAN"
--
-- Grammar me type badalne ka roop `ALTER COLUMN col TYPE <newtype>` hai -
-- `ALTER COLUMN col <type>` koi roop nahi hai. NOT NULL lagane ka sahi roop
-- hai `SET NOT NULL`:
ALTER TABLE users
  ALTER COLUMN biometric_capable SET NOT NULL;

-- Ye line pehle ye likhti thi:
--
--   "PostgreSQL COMMENT ON is intentionally omitted here because this migration
--    is also parsed by tooling that does not support PostgreSQL COMMENT syntax."
--
-- There is no such tooling. Nothing in this repository parses these files as
-- anything but PostgreSQL - the service itself embeds and executes them - and
-- the omission was a SQL Server habit carried over, which is why migrations
-- 003 and 019 were full of `sp_addextendedproperty` that could never run here.
--
-- `COMMENT ON COLUMN` is idempotent: running it again updates the text, which is
-- the intent. So the cost of omitting it was a column nobody could explain.
COMMENT ON COLUMN users.biometric_capable IS
  'Whether this account''s device was reported as having a WebAuthn biometric sensor. NULL meant "unknown" and is backfilled to true, which is the STRICTER guess: it asks the user to enrol rather than silently lowering their security. false means the client confirmed there is no sensor, which is the only reason enrolment may be skipped.';

COMMIT;
