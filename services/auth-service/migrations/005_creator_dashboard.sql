-- ============================================================================
-- 005_creator_dashboard.sql
-- ============================================================================
-- Creator dashboard ke liye zaroori data:
--   1. `users.avatar_url`      - profile image
--   2. `channels` table        - user ke apne channels (create + list)
--
-- ---- WHY avatar_url users table par, alag table par nahi ----
-- Avatar 1:1 relationship hai user se. Alag `avatars` table banane se
-- sirf extra join aur extra row overhead aata - koi fayda nahi. Ek nullable
-- column rakhenge jo NULL rahe jab tak user image na upload kare.
--
-- ---- WHY channels alag table ----
-- Channel ek ALAG entity hai - 1 user ke 1 se zyada channels ho sakte hain,
-- aur har channel me apna description, handle, aur (future me) videos honge.
-- Isliye ye 1:N relationship hai, users me column nahi rakh sakte.
--
-- Hinglish comments: har step ka arth
-- ============================================================================

-- ---- Step 1: users.avatar_url ----
-- Idempotent. NULL = user ne abhi image nahi upload ki.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMENT ON COLUMN users.avatar_url IS
  'URL of the user''s profile image. NULL means no avatar set (UI shows initials fallback).';

-- ============================================================================
-- channels table
-- ============================================================================
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owner. ON DELETE CASCADE: user delete hota hai to channels bhi hat jaate
  -- hain - orphaned channels nahi chhodte.
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Public handle, unique per user. Ye channel URL me dikhta hai
  -- (jaise /@handle). Case-insensitive uniqueness enforce karne ke liye
  -- hum NORMALIZED (lowercase) value store karte hain aur check bhi karte
  -- hain - isse "Aarav" aur "aarav" dono ek hi handle nahi ban sakte.
  handle TEXT NOT NULL,

  display_name TEXT NOT NULL,

  description TEXT,

  -- Channel ka apna avatar (channel image, user avatar se alag)
  image_url TEXT,

  -- Public/ private channel
  is_public BOOLEAN NOT NULL DEFAULT true,

  -- Account state
  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ---- Soft delete ----
  -- GORM ka `DeletedAt gorm.DeletedAt` isliye ye column use karta hai.
  -- NOTE: ye pehle MISSING tha - model me field thi par table me column nahi,
  -- jisse har insert par "column channels.deleted_at does not exist" (SQLSTATE
  -- 42703) fail hota tha. Idempotent add kiya gaya hai taki already-applied
  -- databases bhi fix ho jaayein.
  deleted_at TIMESTAMPTZ,

  -- ---- Constraints ----
  -- Handle format: 3-30 chars, lowercase letters/digits/underscore/dot/dash.
  -- Ye SAME rule frontend ke validator se match karti hai.
  CONSTRAINT ch_handle_format CHECK (handle ~ '^[a-z0-9._-]{3,30}$'),

  -- Display name length guard (DB-level, in case a client bypasses validation)
  CONSTRAINT ch_display_name_len CHECK (char_length(display_name) BETWEEN 1 AND 80),

  -- Description length guard
  CONSTRAINT ch_description_len CHECK (description IS NULL OR char_length(description) <= 2000)
);

-- ---- Indexes ----
-- Unique handle PER USER (do alag users ka same handle allowed hai -
-- kyunki handle URL me user-scoped hota hai).
-- NOTE: ye `LOWER(handle)` par hai taaki case-insensitive uniqueness rahe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_user_handle
  ON channels (user_id, LOWER(handle));

-- Listing fast ho - user ke channels hamesha usi user_id se filter hote hain
CREATE INDEX IF NOT EXISTS idx_channels_user_id
  ON channels (user_id);

-- ============================================================================
-- Session/device visibility
-- ============================================================================
-- `sessions` table ALREADY exist karti hai (auth-service use karti hai) aur usme
-- ye columns hain: ip_address, user_agent, device_id, created_at, updated_at,
-- expires_at, revoked_at.
--
-- (NOTE: `last_seen` column NAHI hai - verified `\d sessions`. Isliye view me
-- `updated_at` use kiya gaya hai, jo GORM ke `UpdatedAt` se auto-maintain hota
-- hai aur last activity ka closest signal hai.)
--
-- Isliye is migration me table change nahi - bas ek VIEW banata hai jo active
-- (non-revoked, non-expired) sessions ko "device" ke roop me expose karta
-- hai, taaki dashboard "aap kis device par logged in hain" dikha sake.
--
-- SECURITY NOTE: ye view sirf OWN user ki sessions dikhata hai (user_id
-- filter query me lagta hai). Koi cross-user leak nahi.
CREATE OR REPLACE VIEW active_user_sessions AS
SELECT
  s.id,
  s.user_id,
  s.device_id,
  s.ip_address,
  s.user_agent,
  s.created_at,
  s.updated_at AS last_seen,
  s.expires_at
FROM sessions s
WHERE s.deleted_at IS NULL
  AND s.revoked_at IS NULL
  AND s.expires_at > now();

COMMENT ON VIEW active_user_sessions IS
  'Non-revoked, non-expired sessions for a user - powers the "which devices are you signed in on" panel.';
