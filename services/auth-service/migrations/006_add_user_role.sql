-- ============================================================================
-- 006_add_user_role.sql
-- ============================================================================
-- PURPOSE: `users` table me ROLE add karta hai - taaki role-based route
-- separation possible ho (`/superadmin` sirf superadmin ke liye).
--
-- ---- WHY YE ZAROORI HAI ----
-- Reality check (audit kiya gaya): `users` table me koi role column hi nahi
-- tha. Na `role`, na `is_superadmin`, na kuch bhi. Iska matlab:
--   - `/superadmin` kisi bhi logged-in user ke liye open tha
--   - role-based routing IMPOSSIBLE thi, sirf UI me chhupane se kuch nahi
--     hota
-- Ye column poore role model ka base hai.
--
-- ---- ROLE VALUES ----
-- Sirf do roles, isliye CHECK constraint lagaya hai (data integrity):
--   'user'       - default, normal creator
--   'superadmin' - full platform access
-- Future me 'moderator'/'creator' jaisa kuch add karna ho to ye constraint
-- extend karni padegi - jaan-boojh kar chhoda gaya hai taaki galat role
-- insert na ho sake.
--
-- Hinglish comments: har step ka arth
-- ============================================================================

-- ---- Step 1: column add (idempotent) ----
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- ---- Step 2: CHECK constraint ----
-- Postgres me `ADD CONSTRAINT` pehle `IF NOT EXISTS` support nahi karta
-- (version dependent), isliye DO block se safe add karte hain.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'superadmin'));
  END IF;
END $$;

-- ---- Step 3: backfill ----
-- Purane rows DEFAULT 'user' se already aa gaye honge (NOT NULL DEFAULT),
-- lekin safety ke liye NULL/garbage values theek kar dete hain.
UPDATE users SET role = 'user' WHERE role IS NULL OR role = '';

-- ---- Step 4: FIRST superadmin kaise decide karein? ----
-- SECURITY-CRITICAL: ise JAAN-BOOH kar nahi kar sakte. Agar hum khud
-- pick kar lein to wo guess hoga, aur galat pick = koi random user ko
-- admin ban jayega.
--
-- SAFE rule: jis account ne SUPERADMIN RECOVERY flow use kiya tha, use
-- promote karo. Is project me `full_name` se pata chalta hai ki kaun
-- recovery admin hai (auth-service `superadmin.go` recovery flow use karta
-- hai aur full_name set karta hai).
--
-- NOTE: agar koi recovery admin nahi hai, to koi superadmin nahi banega -
-- jyada safe hai (fail closed). Promote karne ke liye neeche diya gaya
-- commented-out statement chalao, apne email daal kar:
--
--   UPDATE users SET role = 'superadmin' WHERE email = 'you@example.com';
--
-- ---- REAL DATA NOTE ----
-- Ye "dummy admin" nahi hai - ye sirf wo account hai jo platform owner ne
-- recovery ke liye banaya tha. Hardcoding koi fake admin nahi kiya gaya.
DO $$
BEGIN
  UPDATE users
     SET role = 'superadmin'
   WHERE lower(full_name) = 'superadmin recovery 1';
END $$;

COMMENT ON COLUMN users.role IS
  'Access role: ''user'' (default) or ''superadmin''. Controls route-level access (e.g. /superadmin).';

-- ============================================================================
-- Promote karne ke liye (MANUAL, owner chalayega):
--
--   UPDATE users SET role = 'superadmin' WHERE email = 'aapka@email.com';
--
-- Ya role-based promotion endpoint use karo (agar future me banaye).
-- ============================================================================
