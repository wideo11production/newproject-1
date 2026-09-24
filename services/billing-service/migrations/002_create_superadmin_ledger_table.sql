-- Migration: 002_create_superadmin_ledger_table.sql
-- Database: billing_service
-- Description: Superadmin role ledger table for monitoring multi-tenant account activations

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS superadmin_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Ledger entry details
    entry_type VARCHAR(50) NOT NULL,  -- 'account_activation', 'subscription_change', 'role_change', etc.
    user_id UUID REFERENCES user_service.users(id) ON DELETE SET NULL,
    actor_user_id UUID REFERENCES user_service.users(id) ON DELETE SET NULL,  -- Who performed the action (superadmin)
    
    -- For account activations
    account_status_before VARCHAR(20),
    account_status_after VARCHAR(20),
    
    -- For subscription changes
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    plan_change_from VARCHAR(100),
    plan_change_to VARCHAR(100),
    amount_change_inr DECIMAL(10,2),
    
    -- For role changes
    role_change_from VARCHAR(50),
    role_change_to VARCHAR(50),
    
    -- Financial impact
    revenue_impact_inr DECIMAL(12,2) DEFAULT 0,
    tax_impact_inr DECIMAL(12,2) DEFAULT 0,
    
    -- Notes and metadata
    notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES user_service.users(id) ON DELETE SET NULL  -- Who logged this entry
);

CREATE INDEX IF NOT EXISTS idx_superadmin_ledger_entry_type ON superadmin_ledger(entry_type);
CREATE INDEX IF NOT EXISTS idx_superadmin_ledger_user_id ON superadmin_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_superadmin_ledger_actor_user_id ON superadmin_ledger(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_superadmin_ledger_subscription_id ON superadmin_ledger(subscription_id);
CREATE INDEX IF NOT EXISTS idx_superadmin_ledger_created_at ON superadmin_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_superadmin_ledger_entry_type_user ON superadmin_ledger(entry_type, user_id);

COMMENT ON TABLE superadmin_ledger IS 'Ledger for superadmin actions to monitor multi-tenant account activations and changes';
COMMENT ON COLUMN superadmin_ledger.entry_type IS 'Type of ledger entry (account_activation, subscription_change, etc.)';
COMMENT ON COLUMN superadmin_ledger.user_id IS 'User affected by the action';
COMMENT ON COLUMN superadmin_ledger.actor_user_id IS 'Superadmin who performed the action';
COMMENT ON COLUMN superadmin_ledger.account_status_before IS 'Account status before change';
COMMENT ON COLUMN superadmin_ledger.account_status_after IS 'Account status after change';
COMMENT ON COLUMN superadmin_ledger.subscription_id IS 'Subscription affected by the change';
COMMENT ON COLUMN superadmin_ledger.plan_change_from IS 'Previous plan ID';
COMMENT ON COLUMN superadmin_ledger.plan_change_to IS 'New plan ID';
COMMENT ON COLUMN superadmin_ledger.amount_change_inr IS 'Change in subscription amount (INR)';
COMMENT ON COLUMN superadmin_ledger.role_change_from IS 'Previous role';
COMMENT ON COLUMN superadmin_ledger.role_change_to IS 'New role';
COMMENT ON COLUMN superadmin_ledger.revenue_impact_inr IS 'Financial impact on revenue (INR)';
COMMENT ON COLUMN superadmin_ledger.tax_impact_inr IS 'Financial impact on taxes (INR)';
COMMENT ON COLUMN superadmin_ledger.notes IS 'Human-readable notes about the ledger entry';
COMMENT ON COLUMN superadmin_ledger.metadata IS 'Flexible JSON metadata for additional context';
COMMENT ON COLUMN superadmin_ledger.created_by IS 'User who created this ledger entry (usually system or superadmin)';