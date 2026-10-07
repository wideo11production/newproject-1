-- Migration: 003_add_subscription_tier_and_fps_columns.sql
-- Description: Add MaxFPS, IsStandalone, MaxResolution to subscription_plans
--              and TierStateToken to subscriptions for AURA framerate tier tracking
--
-- Hinglish: Ye migration AURA Premium Framerate feature ke liye hai.
-- Standard tiers ko 60 FPS ceiling milta hai, AURA standalone plan se
-- 120 FPS / 240Hz unlock hoti hai. Zero discount configurations allowed.

-- subscription_plans me FPS ceiling column add karo
ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS max_fps INTEGER NOT NULL DEFAULT 60;

ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS is_standalone BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS max_resolution VARCHAR(32) NOT NULL DEFAULT '1920x1080';

-- subscriptions me tier state token add karo — dynamically updated on purchase
ALTER TABLE subscriptions 
ADD COLUMN IF NOT EXISTS tier_state_token VARCHAR(32) NOT NULL DEFAULT '60fps';

-- Index for fast tier lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_tier_state ON subscriptions(tier_state_token);

-- AURA standalone plan ke liye check constraint: zero discounts allowed
ALTER TABLE subscription_plans 
ADD CONSTRAINT chk_standalone_max_fps CHECK (
  (is_standalone = false) OR (price > 0 AND is_standalone = true)
);

COMMENT ON COLUMN subscription_plans.max_fps IS 'Maximum frame rate ceiling — standard tiers cap at 60, AURA unlocks 120/240';
COMMENT ON COLUMN subscription_plans.is_standalone IS 'Single-user lifetime license (no recurring cycle)';
COMMENT ON COLUMN subscription_plans.max_resolution IS 'Output resolution ceiling (e.g. 1920x1080, 3840x2160)';
COMMENT ON COLUMN subscriptions.tier_state_token IS 'Active FPS tier: 60fps, 120fps, 240hz — updated dynamically on purchase';
