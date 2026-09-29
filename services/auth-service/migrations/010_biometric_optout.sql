-- ============================================================================
-- 010_biometric_optout.sql
-- ============================================================================
-- PURPOSE: user ke EXPLICIT "biometric nahi chahiye" decision ko record karna.
--
-- ---- KYUN ZAROORI HAI ----
-- Pehle setup-complete ka rule tha:
--     complete := hasPin && hasQuestions && (!capable || bioCount > 0)
--
-- Jo bhi bug laaya:
--   - Gate ka "skip biometric" button `biometric/complete` call karta tha,
--     jo sirf recompute karta hai - koi credential CREATE nahi karta.
--   - Frontend optimistically `setup_complete: true` set kar deta tha.
--   - Par backend recompute me `bioCount = 0` aur `capable = true` tha, to
--     `complete = false`.
--   - Result: user /dashboard gaya -> middleware ne wapas security-setup par
--     bheja -> gate me biometric step dobara -> LOOP.
--
-- Matlab "skip" ka koi ASLI representation hi nahi tha. Browser ka state
-- aur backend ka state disagree karte the.
--
-- ---- SOLUTION ----
-- Ye column wo decision PERMANENTLY record karta hai. Phir rule:
--     complete := hasPin && hasQuestions && (optedOut || !capable || bioCount > 0)
--
-- Isse:
--   - user ne consciously decline kiya -> account ready (loop nahi)
--   - capability hi nahi hai -> account ready (pehle se theek tha)
--   - capable hai aur decline nahi kiya -> enroll karna ZAROORI (security intact)
--
-- Default false hai - yaani koi naya user bina soche "opted out" nahi hota.
-- Hinglish: user ka "mujhe biometric nahi chahiye" decision save karo
-- ============================================================================

ALTER TABLE security_profiles
  ADD COLUMN IF NOT EXISTS biometric_opted_out BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN security_profiles.biometric_opted_out IS
  'User explicitly declined biometric setup. When true, biometric enrollment is no longer required for security setup completion. Only set via the explicit skip action.';
