-- ============================================================================
-- 010_biometric_optout.sql   (SQL Server)
-- ============================================================================
-- PURPOSE: user ke EXPLICIT "biometric nahi chahiye" decision ko record karna.
--
-- ---- YE BUG KYUN BAAKI THA ----
-- Pehle setup-complete ka rule tha:
--     complete := hasPin && hasQuestions && (!capable || bioCount > 0)
--
-- Gate ka "skip biometric" button `biometric/complete` call karta tha, jo
-- sirf recompute karta hai - koi credential CREATE nahi karta. Frontend
-- optimistically `setup_complete: true` set kar deta tha. Par backend me
-- `bioCount = 0` aur `capable = true` tha, to `complete = false`.
--
-- Result: user /dashboard gaya -> middleware ne security-setup par wapas
-- bheja -> biometric step dobara -> INFINITE LOOP.
--
-- Matlab "skip" ka koi ASLI representation hi nahi tha - browser ka state
-- aur backend ka state disagree karte the. Ye column wo decision
-- PERMANENTLY record karta hai, jisse dono ek ho jaate hain.
--
-- ---- NAYA RULE ----
--     complete := hasPin && hasQuestions && (optedOut || !capable || bioCount > 0)
--
--   - user ne consciously decline kiya  -> account ready (loop nahi)
--   - capability hi nahi hai              -> account ready (pehle se theek)
--   - capable hai aur decline nahi kiya   -> enroll karna ZAROORI (security intact)
--
-- Default false: koi naya user bina soche "opted out" nahi hota.
-- Ye sirf explicit skip action se set hota hai.
--
-- ---- IDEMPOTENT ----
-- `psql -f` se manually chalti hai (koi runner nahi).
--
-- Hinglish: user ka "mujhe biometric nahi chahiye" decision save karo
-- ============================================================================

BEGIN;

-- Ye pehle ye tha:
--
--   IF COL_LENGTH('dbo.security_profiles', 'biometric_opted_out') IS NULL
--   BEGIN
--     ALTER TABLE dbo.security_profiles
--       ADD biometric_opted_out bit NOT NULL
--         CONSTRAINT DF_... DEFAULT (0);
--   END;
--   EXEC sys.sp_addextendedproperty ...
--
-- Teeno PostgreSQL par fail hote the, alag-alag reasons se:
--   - `IF ... BEGIN ... END` T-SQL hai; PostgreSQL me `IF` ek statement hai
--   - `dbo.security_profiles` SQL Server ka schema-qualified naam hai
--   - `bit` SQL Server ka boolean type hai (PostgreSQL: `boolean`)
--   - `sys.sp_addextendedproperty` SQL Server procedure hai
--
-- Jo bhi pehle apply hua tha, `bit` type hone ki wajah se ye column ya to
-- bilkul nahi bana, ya ek alag type ke saath bana - aur Go model ke `bool`
-- ke saath mismatch. `boolean NOT NULL DEFAULT false` wahi contract hai jo
-- `recomputeSetupComplete` code me padhta hai.
ALTER TABLE security_profiles
  ADD COLUMN IF NOT EXISTS biometric_opted_out BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN security_profiles.biometric_opted_out IS
  'User explicitly declined biometric setup. When true, biometric enrollment is no longer required for security setup completion. Only set via the explicit skip action.';

COMMIT;
