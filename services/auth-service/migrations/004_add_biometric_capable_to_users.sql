-- ============================================================================
-- 004_add_biometric_capable_to_users.sql
-- ============================================================================
-- PURPOSE: user ke record me `biometric_capable` boolean add karta hai - yaani
-- "is device me biometric sensor hai ya nahi".
--
-- ---- WHY YE ZAROORI HAI (real bug) ----
-- `SecurityService.recomputeSetupComplete` me setup ka rule tha:
--
--     complete := hasPin && hasQuestions && bioCount > 0
--
-- Yaani biometric MANDATORY tha - CHAHE device me sensor ho ya na ho.
--
-- Register form me biometric checkbox SIRF tab dikhta hai jab browser ko
-- `PublicKeyCredential` milta hai (i.e. device me asli sensor ho). Toh:
--   - sensor WALE user  -> checkbox dikhta hai, tick karke enroll kar sakta
--                          hai, requirement poori karta hai -> OK
--   - sensor NAHI WALE  -> checkbox KABHI nahi dikhta, enroll kar hi nahi
--                          sakta -> bioCount hamesha 0 rahega
--                          -> setup_complete hamesha false
--                          -> user PERMANENTLY dashboard se block
--
-- Matlab koi bhi laptop/desktop user (jo zyadatar me bina sensor hote hain)
-- apna account bana sakta tha, lekin dashboard tak KABHI nahi pahunch sakta
-- tha. Ye soft-lockout tha - user ko koi error bhi nahi milta tha, bas
-- login ke baad security gate phasa rehta tha.
--
-- ---- THE FIX ----
-- Requirement ab conditional hai:
--     complete := hasPin && hasQuestions && (!biometric_capable || bioCount > 0)
--
-- Matlab:
--   - device SUPPORT karta hai  -> enroll karna zaroori (security bar same)
--   - device support NAHI karta -> enroll karna zaroori nahi (fair)
--
-- ---- DEFAULT CHOICE (important) ----
-- `DEFAULT true` rakha hai - yaani jab tak client ye flag nahi bhejta,
-- hum assume karte hain ki device SUPPORT karta hai (stricter/safer side).
--
-- Ye isliye secure default hai:
--   - Purane users (is column ke aane se pehle bane) ko `true` milega, to
--     unhe enroll karna hoga - koi security down-grade nahi hua.
--   - Naye users ke liye client hamesha flag bhejega (register form WebAuthn
--     check chala kar bhejta hai), to real capability record hoti hai.
--
-- NOTE: agar humne `DEFAULT false` rakha hota, to EVERY user (bina sensor
-- wale sameth) biometric requirement se chhoot jata - wo galat direction me
-- security kam karta. Isliye `true` sahi default hai.
--
-- Hinglish comments: har step ka arth
-- ============================================================================

-- ---- Step 1: column add karo (idempotent) ----
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS biometric_capable BOOLEAN;

-- ---- Step 2: backfill - NULL ko TRUE (safe default) ----
-- Ye un rows ke liye hai jo column add hone se pehle bani thi.
-- `true` = "assume capable" = stricter/safer.
UPDATE users
   SET biometric_capable = true
 WHERE biometric_capable IS NULL;

-- ---- Step 3: ab NOT NULL + default ----
-- NULL values backfill ho chuke hain, to ab constraint safely lag sakta hai.
ALTER TABLE users
  ALTER COLUMN biometric_capable SET DEFAULT true;

ALTER TABLE users
  ALTER COLUMN biometric_capable SET NOT NULL;

-- ---- Step 4: comment ----
COMMENT ON COLUMN users.biometric_capable IS
  'Whether this user''s device supports biometric auth (WebAuthn). If false, biometric enrollment is not required for security setup completion. Defaults to true (assume capable) for safety.';

-- ============================================================================
-- NOTE (gate logic change is in Go, not here):
--   services/auth-service/internal/service/security.go
--   -> recomputeSetupComplete()
--   Ab: complete := hasPin && hasQuestions && (!capable || bioCount > 0)
--
--   Client is flag ko register request me bhejta hai:
--   web proxy : apps/web/src/app/api/auth/register/route.ts
--   form      : apps/web/src/app/auth/register/page.tsx
-- ============================================================================
