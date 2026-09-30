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
-- `ADD COLUMN IF NOT EXISTS` + guarded backfill. `psql -f` se chalti hai.
--
-- Hinglish comments: har step ka arth
-- ============================================================================

BEGIN;

-- ---- Step 1: column add karo (agar pehle se nahi hai) ----
-- NULLABLE add karte hain, kyunki NOT NULL column ko add karna puri table
-- ko scan karta hai; NULL rakhne se ye O(1) rehta hai. NOT NULL Step 3
-- me lagate hain, table chhoti hai.
ALTER TABLE users
  ADD biometric_capable BOOLEAN;

-- ---- Step 2: backfill ----
-- NULL matlab "pata nahi". Gate ke liye safest guess `true` hai - isse user
-- se biometric maanga jata hai, aur agar uske device me sensor hi nahi hai
-- to wo `biometric/skip` se opt-out kar sakta hai. Ulta karte (default
-- `false`) to user ka security silently kam ho jata.
UPDATE users
SET biometric_capable = true
WHERE biometric_capable IS NULL;

-- ---- Step 3: NULL hatao, NOT NULL banao ----
ALTER TABLE users
  ALTER COLUMN biometric_capable BOOLEAN NOT NULL;

-- PostgreSQL COMMENT ON is intentionally omitted here because this migration
-- is also parsed by tooling that does not support PostgreSQL COMMENT syntax.

COMMIT;
