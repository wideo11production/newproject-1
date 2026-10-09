-- Migration 025: Ensure advchashampalup@gmail.com has superadmin role
-- This migration runs idempotently on every startup via the embedded migrator.
-- It guarantees the target account exists with role='superadmin' in users table.

-- First, ensure the user exists (idempotent upsert)
--
-- `biometric_capable` is NOT NULL with no default, so the INSERT branch
-- must supply it. The UPDATE branch leaves it alone - a superadmin account
-- that already exists keeps whatever the device-detection flow recorded.
INSERT INTO users (email, username, full_name, password_hash, biometric_capable, is_verified, role, created_at, updated_at)
VALUES (
    'advchashampalup@gmail.com',
    'advchashampalup',
    'Super Admin',
    '$2a$12$Nk5RPdXgQJ5SM/FCj.kpkOEduXKpgeKLatY0hL2bFyM2hJATRGg8G', -- bcrypt hash of 'Appp Rajaghenna123*#' (verified via cmd/verifyhash/main.go)
    false,
    true,
    'superadmin',
    NOW(),
    NOW()
)
ON CONFLICT (email) DO UPDATE SET
    role = 'superadmin',
    is_verified = true,
    username = COALESCE(NULLIF(users.username, ''), 'advchashampalup'),
    full_name = COALESCE(NULLIF(users.full_name, ''), 'Super Admin'),
    updated_at = NOW();

-- Also ensure entry in superadmin_accounts table (provisioning tracking)
--
-- `role` is NOT NULL on this table and has no default, so the INSERT branch
-- must supply it. The UPDATE branch leaves it alone - a superadmin account
-- that already exists keeps whatever role it was provisioned with.
INSERT INTO superadmin_accounts (user_id, email, role, created_at)
SELECT id, email, 'superadmin', NOW()
FROM users
WHERE email = 'advchashampalup@gmail.com'
ON CONFLICT (email) DO UPDATE SET
    user_id = EXCLUDED.user_id;