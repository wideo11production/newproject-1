-- ============================================================================
-- 036_add_student_tier_and_content_category_to_channels.sql   (PostgreSQL)
-- ============================================================================
-- PURPOSE: channels table mein `content_category` aur `student_tier` columns
--          add karna, taaki student verification tier ke channels ko
--          educational-only content upload enforce kiya ja sake.
--
-- DUAL PURPOSE:
--   1. content_category: 'educational' (student tier, educational-only) ya
--      'general' (kisi bhi category ka content). Default 'general'.
--   2. student_tier: boolean flag - true jab user ka student verification
--      active ho (user-service Gate A ya Gate B complete).
--
-- RE-RUN SAFE: ADD COLUMN IF NOT EXISTS har column ke liye, isliye dobara
-- chalaane par koi error nahi aata.
-- ============================================================================

BEGIN;

-- ---- STEP 1: content_category column ----
ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS content_category VARCHAR(24) NOT NULL DEFAULT 'general';

COMMENT ON COLUMN channels.content_category IS
    'Channel content scope: educational (student tier, educational-only uploads) or general (any content)';

-- ---- STEP 2: student_tier column ----
ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS student_tier BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN channels.student_tier IS
    'True when channel owner has active student verification (Gate A or Gate B complete). Student tier channels restricted to educational content uploads only.';

-- ---- STEP 3: Index for student tier lookups (compliance check reads this) ----
CREATE INDEX IF NOT EXISTS idx_channels_student_tier
    ON channels(student_tier) WHERE student_tier = true;

CREATE INDEX IF NOT EXISTS idx_channels_content_category
    ON channels(content_category) WHERE content_category = 'educational';

-- ---- STEP 4: CHECK constraint - content_category valid values ----
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_channels_content_category'
          AND conrelid = 'channels'::regclass
    ) THEN
        ALTER TABLE channels
            ADD CONSTRAINT chk_channels_content_category
            CHECK (content_category IN ('educational', 'general'));
    END IF;
END $$;

COMMIT;
