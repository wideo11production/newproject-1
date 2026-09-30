-- ============================================================================
-- 005_creator_dashboard.sql   (PostgreSQL)
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
-- ---- YAHAIN SE `channels` KA TABLE NAHI BANTE ----
-- Ye table GORM ke `AutoMigrate` se NAHI banti (jaan-boojh kar
-- `database.SQLOnlyTables` me chhodi gayi hai), kyunki us par CHECK
-- constraints, ek partial index aur ek trigger hain jo GORM express nahi kar
-- sakta. Ye file un sab ka malik hai. `Channel` model ko kabhi
-- `database.MigratedModels()` me mat daalo - warna GORM ye table bina
-- constraints ke bana dega aur ye file chup ho jayegi.
--
-- Hinglish comments: har step ka arth
-- ============================================================================

BEGIN;

-- ---- STEP 1: users.avatar_url ----
-- ("column avatar_url of relation users already exists", SQLSTATE 42701).
IF COL_LENGTH('users', 'avatar_url') IS NULL
BEGIN
  ALTER TABLE users
    ADD avatar_url TEXT;
END;

-- ============================================================================
-- channels table
-- ============================================================================
-- `IF NOT EXISTS` isliye ki service pehle chalu ho chuki ho to GORM ne table
-- bana di ho, ya ye migration dobara chale - dono me ye statement no-op honi
-- chahiye. Iske bina SQLSTATE 42P07 aata hai.
CREATE TABLE channels (
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

  -- NULLABLE yahan, jaan-boojh kar. Migration 011 ise `DEFAULT '' NOT NULL`
  -- bana degi. Abhi nullable rakhne se ye constraint add karna O(1) rehta hai
  -- (naya NOT NULL column add karna poori table scan karta hai).
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
  -- 42703) fail hota tha.
  deleted_at TIMESTAMPTZ,

  -- ---- Constraints ----
  -- Handle format: 3-30 chars, lowercase letters/digits/underscore/dot/dash.
  -- Ye SAME rule frontend ke validator se match karti hai.
  CONSTRAINT ch_handle_format CHECK (regexp_like(handle, '^[a-z0-9._-]{3,30}$')),

  -- Display name length guard (DB-level, in case a client bypasses validation)
  CONSTRAINT ch_display_name_len CHECK (char_length(display_name) BETWEEN 1 AND 80),

  -- Description length guard
  CONSTRAINT ch_description_len CHECK (description IS NULL OR char_length(description) <= 2000)
);

-- ---- Indexes ----
-- Unique handle PER USER (do alag users ka same handle allowed hai -
-- kyunki handle URL me user-scoped hota hai).
--
-- NOTE: ye `LOWER(handle)` par hai taaki case-insensitive uniqueness rahe -
-- "Aarav" aur "aarav" ek hi handle nahi ban sakte.
CREATE UNIQUE INDEX idx_channels_user_handle
  ON channels (user_id, handle);

-- Listing fast ho - user ke channels hamesha usi user_id se filter hote hain
CREATE INDEX idx_channels_user_id
  ON channels (user_id);

-- ============================================================================
-- Session/device visibility - KAHA GAYA WO VIEW
-- ============================================================================
-- Is migration ne pehle ek `active_user_sessions` VIEW banayi thi, taaki
-- dashboard "aap kis device par logged in hain" dikha sake. Wo view
-- ABANDONED hai, aur is file se hata diya gaya hai. Do wajah:
--
--   1. Wo view GORM ke `AutoMigrate` ko BLOCK karta tha. Postgres ALTER ko
--      view-dependent column pe mana karta hai ("cannot alter type of a
--      column used by a view or rule"), jisse auth-service crash-loop me
--      chala gaya tha. Migration 009 ko view drop karke phir se banana
--      pada sirf isliye ki ALTER chal sake.
--
--   2. View me koi custom logic nahi thi - bas SELECT + WHERE. Isiliye
--      `internal/service/creator.go` ab `sessions` table ko seedha query
--      karta hai (`ListSessions`), aur `last_seen` ke liye `updated_at`
--      use karta hai (GORM ka `UpdatedAt` se auto-maintain hota hai).
--
-- SECURITY NOTE: dono raaste me bhi sirf OWN user ki sessions dikhti hain
-- (`WHERE user_id = ?` query me lagta hai). Koi cross-user leak nahi.
-- ============================================================================

COMMIT;
