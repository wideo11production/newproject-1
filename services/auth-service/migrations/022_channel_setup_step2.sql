-- =============================================================================
-- 022: step 2 - a channel that is SET UP, not just created
-- =============================================================================
--
-- WHY
--
-- Creating a channel and having a channel are different things. Today
-- `POST /channels` produces a row with a name, a handle and a category, and the
-- creator lands back on the dashboard with an empty banner slot, no logo, no
-- colour and no upload defaults. That is the state every platform shows when an
-- account is abandoned ten minutes after signup, and it is the single strongest
-- signal that a channel will never be used.
--
-- This migration adds the fields step 2 needs, plus the one field that makes it
-- enforceable: `setup_step2_at`.
--
-- -----------------------------------------------------------------------------
-- WHY VISIBILITY IS A NEW COLUMN AND NOT A BOOLEAN
-- -----------------------------------------------------------------------------
--
-- `channels.is_public` already exists and is a boolean, so the obvious move is to
-- reuse it. Three states are needed, not two:
--
--   public   - anyone can find it, and it appears in browse and search
--   unlisted - anyone with the link can watch, and it appears NOWHERE in browse
--   private  - only the owner
--
-- "Unlisted" is not an edge case. It is what every creator wants for a first
-- upload: shareable with five people, not indexed, not in recommendations. A
-- boolean forces that choice to be "public", which is the wrong default for the
-- most common first-time behaviour.
--
-- `is_public` is KEPT and kept in step with `visibility`. A second source of
-- truth about whether a channel is public is exactly the kind of thing that
-- eventually disagrees with itself, so there is a CHECK constraint forcing the
-- two to agree rather than a code path that hopes they do.
--
-- -----------------------------------------------------------------------------
-- WHY `brand_color` IS CONSTRAINED TO A HUE, NOT A HEX STRING
-- -----------------------------------------------------------------------------
--
-- This is the interesting one, and it is a security decision disguised as a
-- colour decision.
--
-- A free hex field means every one of these is storable and, eventually,
-- renderable as an inline style:
--
--     #fff      white text on a light page - invisible
--     #000      black on black - invisible
--     url(...)  not valid hex, rejected
--     #fff; background:url(//evil/x)   NOT a valid hex, rejected
--
-- The dangerous case is the last one, and it is the reason the constraint is on
-- the HUE rather than on the format. `background: red` accepts arbitrary CSS in
-- some frameworks, and any component that interpolates a channel colour into a
-- style attribute becomes an injection point the day somebody loosens the
-- validation.
--
-- So the column stores a HUE IN DEGREES - an integer 0-359 - and the RGB is
-- derived from a palette this codebase owns. A channel cannot express a colour
-- that this application did not choose, which means:
--
--   - every channel colour passes contrast against both themes, because we
--     picked the lightness, not the creator
--   - no CSS is ever built from user input
--   - a new channel colour is a code change we review, not a value anyone types
--
-- The trade, stated plainly: a creator cannot pick an exact brand colour. In
-- exchange they cannot make their own page unreadable, and they cannot inject
-- anything. For a value that gets rendered on every visitor's screen, that is
-- the right way round.
--
-- -----------------------------------------------------------------------------
-- WHY `setup_step2_at` IS A TIMESTAMP AND NOT A BOOLEAN
-- -----------------------------------------------------------------------------
--
-- "Has this channel been set up" is derivable from the columns: a logo, a
-- tagline, a colour and an upload-defaults row. So it could be computed.
--
-- It is stored anyway, for two reasons that a computed answer cannot serve:
--
--   1. `WHERE setup_step2_at IS NULL` is the query the dashboard uses on EVERY
--      load to decide what to show. Deriving it means four nullable columns and
--      a COALESCE chain on the hot path, and the definition of "done" would then
--      live in two places - the check and the gate - which is how they disagree.
--   2. WHEN it happened is answerable. "Which channels were set up the same day
--      they were created" is the question that tells you whether step 2 is being
--      used or merely tolerated.
--
-- A gate that can be satisfied forever by one fixed row is not a gate. It is
-- read once, on a screen, and then nothing about it matters.

BEGIN;

-- ---- Branding ----

-- The channel's square logo, separate from the wide banner.
--
-- These are two different assets at two different aspect ratios. Forcing one
-- column to hold both means either a stretched logo in a banner slot or a
-- letterboxed banner in an avatar slot.
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- One line that appears under the channel name on the public page. Capped short
-- on purpose: this is a tagline, not a description, and `description` already
-- exists for that.
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS tagline VARCHAR(120);

-- HUE in degrees, 0-359. See the header for why this is not a hex string.
--
-- NULL means "use the platform default". A default is not a claim the creator
-- made, so NULL is the honest value for a channel that has not chosen one.
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS brand_hue INT;

ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS chk_channel_brand_hue;
ALTER TABLE channels
  ADD CONSTRAINT chk_channel_brand_hue
    CHECK (brand_hue IS NULL OR (brand_hue >= 0 AND brand_hue <= 359));

-- ---- Visibility ----
--
-- 'public' | 'unlisted' | 'private'. NULL means unclassified, exactly like
-- `channel_type`: existing rows predate this, and inventing an answer for them
-- would be a claim nobody made. Every READ path treats NULL as 'public' only for
-- a channel that has completed step 2; before that, an unclassified channel is
-- visible to its owner and nobody else.
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(16);

ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS chk_channel_visibility;
ALTER TABLE channels
  ADD CONSTRAINT chk_channel_visibility
    CHECK (visibility IS NULL OR visibility IN ('public', 'unlisted', 'private'));

-- `is_public` and `visibility` must not be able to disagree.
--
-- Enforced here rather than in Go, because Go is where the bug would be
-- introduced: a service-layer UPDATE that sets one without the other would leave
-- a row where the browse query and the visibility query answer differently about
-- the same channel, and nothing would fail.
ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS chk_channel_visibility_agrees_with_is_public;
ALTER TABLE channels
  ADD CONSTRAINT chk_channel_visibility_agrees_with_is_public CHECK (
    visibility IS NULL
    OR visibility = 'public' AND is_public = true
    OR visibility = 'unlisted' AND is_public = true
    OR visibility = 'private' AND is_public = false
  );

-- An unlisted channel is still reachable by handle - it is only hidden from
-- listing - so the public-handle index must still cover it. A private channel
-- is excluded by `is_public = false` alone, which the existing predicate
-- already does.
CREATE INDEX IF NOT EXISTS idx_channels_unlisted_handle
    ON channels (handle)
    WHERE visibility = 'unlisted' AND deleted_at IS NULL AND is_active;

-- ---- Default upload settings ----
--
-- Per-channel DEFAULTS for future uploads, not a global toggle. A creator with
-- two channels legitimately wants comments off on one and required on the other,
-- and a single global setting cannot express that.
--
-- Every one of these has a safe value at NULL, and the defaults are written
-- here rather than in Go so that the answer to "what happens if this column is
-- absent" does not depend on which function reads it.
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS comments_enabled BOOLEAN NOT NULL DEFAULT true;

-- 'anyone' | 'subscribers' | 'approved'
--
-- Tri-state, not a boolean: "comments are on but only for subscribers" is the
-- setting most creators actually want, and a boolean collapses it into "off".
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS comment_policy VARCHAR(16) NOT NULL DEFAULT 'anyone';

ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS chk_channel_comment_policy;
ALTER TABLE channels
  ADD CONSTRAINT chk_channel_comment_policy
    CHECK (comment_policy IN ('anyone', 'subscribers', 'approved'));

-- Whether a made-for-kids channel's uploads are ALSO auto-classified. Legal
-- answer for most families, and a per-channel choice because it is a per-channel
-- commitment.
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS kids_auto_classify BOOLEAN NOT NULL DEFAULT true;

-- Whether the exported file carries this channel's brand colour watermark.
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS watermark_enabled BOOLEAN NOT NULL DEFAULT false;

-- ---- The step-2 gate ----
--
-- NULL means step 2 has NOT been completed. There is no `false`: absent and
-- "explicitly not done" are the same state, and a boolean would let a default of
-- `false` mean "the creator declined", which nobody asked.
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS setup_step2_at TIMESTAMPTZ;

COMMENT ON COLUMN channels.setup_step2_at IS
  'When this channel finished step 2. NULL means not finished. The dashboard gate reads this on every load, so it is stored rather than derived - and so that "set up the same day it was created" stays answerable.';

COMMENT ON COLUMN channels.brand_hue IS
  'Hue in degrees (0-359), NOT a colour string. The RGB is derived from a palette this codebase owns, so a channel colour can never be unreadable on either theme and no CSS is ever built from user input. NULL uses the platform default.';

COMMENT ON COLUMN channels.visibility IS
  'public | unlisted | private. `unlisted` is shareable by link but absent from browse and search. Constrained to agree with the legacy `is_public` boolean so the two cannot drift apart.';

COMMENT ON COLUMN channels.logo_url IS
  'The channel square logo. Separate from cover_url because a logo and a banner are different assets at different aspect ratios, and one column holding both would stretch one of them.';

COMMENT ON COLUMN channels.comment_policy IS
  'anyone | subscribers | approved. Tri-state because "on, but subscribers only" is the most common real setting and a boolean would collapse it into off.';

-- The hot query: "which of my channels still need step 2".
--
-- Partial on NULL, so the index holds only the incomplete rows - which is a set
-- that shrinks to nothing as channels are finished, rather than an index over
-- every channel forever.
CREATE INDEX IF NOT EXISTS idx_channels_needing_setup
    ON channels (user_id, created_at DESC)
    WHERE setup_step2_at IS NULL AND deleted_at IS NULL;

COMMENT ON INDEX idx_channels_needing_setup IS
  'Partial index over unfinished channels only. It shrinks to nothing as channels are set up, instead of indexing every channel forever.';

COMMIT;
