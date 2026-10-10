-- Migration 026: hegemony-free creator appointments (channel.create fix)
--
-- KYU YE FILE HAI (Hinglish):
-- "You do not have the 'channel.create' capability." — ye error tab aata hai
-- jab `appointments` table me user ke paas KOI live role appointment nahi
-- hota. RequirePermission("channel.create") -> rbac.Can() appointments ->
-- role_permissions padhta hai; khaali appointments = koi permission nahi.
--
-- KAISE YE HAAL BANA:
-- Registration flow (handler.go) naye users ko `creator` appoint karta hai,
-- lekin jo accounts us fix se PEHLE bane the (aur migration/bootstrap se bane
-- accounts) wo appoint hi nahi hue. DB me appointments 0 rows thi — kisi bhi
-- user ke paas creator role nahi thi, isliye har non-superadmin channel
-- banate hi 403 khaata tha.
--
-- SUPERADMIN KYUN CHHODA:
-- `SuperadminDeniedPermissions` (handler/rbac.go) superadmin accounts ko
-- jaan-boojh kar channel.create se rokta hai (separation of duties — tested
-- by rbac-wiring_test.go). Superadmin accounts ko appoint karna bekaar hai;
-- wo policy se barred hain. Wo alag product decision hai — yahan Nahi cheat
-- ki gayi.
--
-- Idempotent: partial unique index (user_id, role_id) WHERE revoked_at IS NULL
-- ke saath ON CONFLICT DO NOTHING — har boot par safely re-run hota hai.

INSERT INTO appointments (user_id, role_id, appointed_by, reason)
SELECT
    u.id,
    r.id,
    -- Self-attribution is the SAME convention the registration flow uses
    -- (granterID = user.ID): the appointment is made BY the system on the
    -- user's own behalf, exactly like a signup does it.
    u.id,
    'creator appointment healed by migration 026 (registration predates auto-appoint)'
FROM users u
JOIN roles r ON r.name = 'creator'
WHERE
    -- Sirf active accounts. Disabled logins ko empower karna galat hai.
    u.is_active = true
    -- Superadmin accounts policy se barred hain (SuperadminDeniedPermissions),
    -- unhe creator appoint karne ka koi fayda nahi.
    AND NOT EXISTS (
        SELECT 1 FROM superadmin_accounts s WHERE s.user_id = u.id
    )
    -- Jo user ke paas pehle se KOI live appointment hai use chhodo — uski
    -- existing role (support/finance/ops/creator) override nahi karni.
    AND NOT EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.user_id = u.id AND a.revoked_at IS NULL
    )
ON CONFLICT DO NOTHING;
