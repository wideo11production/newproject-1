-- Migration: 001_create_subscriptions_table.sql
-- Database: billing_service
-- Description: Subscriptions table to support multiple active subscriptions per user

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_service.users(id) ON DELETE CASCADE,
    
    -- Subscription details
    plan_id VARCHAR(100) NOT NULL,  -- References plan in plan-service or constants
    plan_name VARCHAR(200) NOT NULL,
    amount_inr DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'INR',
    billing_cycle VARCHAR(20) NOT NULL,  -- 'monthly', 'quarterly', 'yearly'
    start_date DATE NOT NULL,
    end_date DATE,  -- NULL for ongoing until canceled
    is_active BOOLEAN DEFAULT true,
    
    -- Payment status
    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active', 'past_due', 'canceled', 'unpaid'
    payment_method_id VARCHAR(100),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    canceled_at TIMESTAMPTZ,
    
    -- For proration and upgrades/downgrades
    prorated BOOLEAN DEFAULT false,
    prorated_amount_inr DECIMAL(10,2) DEFAULT 0,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active ON subscriptions(user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_created_at ON subscriptions(created_at);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE subscriptions IS 'User subscriptions - allows multiple active subscriptions per user';
COMMENT ON COLUMN subscriptions.user_id IS 'Reference to user in user_service';
COMMENT ON COLUMN subscriptions.plan_id IS 'Identifier of the subscription plan';
COMMENT ON COLUMN subscriptions.amount_inr IS 'Subscription amount in INR';
COMMENT ON COLUMN subscriptions.billing_cycle IS 'Billing frequency';
COMMENT ON COLUMN subscriptions.is_active IS 'Whether subscription is currently active';
COMMENT ON COLUMN subscriptions.status IS 'Payment status of subscription';
COMMENT ON COLUMN subscriptions.metadata IS 'Flexible JSON metadata for plan-specific attributes';