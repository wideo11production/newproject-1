-- Migration: 001_create_users_table.sql
-- Database: user_service
-- Description: Extended user profile and account management

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_service_id UUID,  -- Reference to auth_service.users.id (external reference)
    auth_type VARCHAR(20) NOT NULL DEFAULT 'password',  -- 'password' | 'biometric' | 'oauth'
    
    -- Profile information
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    bio TEXT,
    avatar_url VARCHAR(500),
    cover_image_url VARCHAR(500),
    
    -- Contact
    phone_number VARCHAR(20),
    phone_verified_at TIMESTAMPTZ,
    email_verified_at TIMESTAMPTZ,
    
    -- Profile settings
    timezone VARCHAR(50) DEFAULT 'UTC',
    locale VARCHAR(10) DEFAULT 'en',
    theme VARCHAR(20) DEFAULT 'dark',
    language VARCHAR(10) DEFAULT 'en',
    
    -- Privacy settings
    profile_visibility VARCHAR(20) DEFAULT 'public',  -- 'public' | 'followers' | 'private'
    show_email BOOLEAN DEFAULT false,
    show_phone BOOLEAN DEFAULT false,
    show_online_status BOOLEAN DEFAULT true,
    
    -- Notification preferences
    email_notifications BOOLEAN DEFAULT true,
    push_notifications BOOLEAN DEFAULT true,
    sms_notifications BOOLEAN DEFAULT false,
    marketing_emails BOOLEAN DEFAULT false,
    
    -- Account status
    is_active BOOLEAN DEFAULT true,
    is_suspended BOOLEAN DEFAULT false,
    suspension_reason TEXT,
    suspended_at TIMESTAMPTZ,
    suspended_until TIMESTAMPTZ,
    
    -- VPN/Account registration fields (for VPN account creation tests)
    vpn_account_id VARCHAR(100) UNIQUE,
    vpn_server_region VARCHAR(50),
    vpn_protocol VARCHAR(20),  -- 'wireguard' | 'openvpn' | 'ikev2'
    vpn_config_json JSONB,
    vpn_created_at TIMESTAMPTZ,
    vpn_expires_at TIMESTAMPTZ,
    vpn_bytes_used BIGINT DEFAULT 0,
    vpn_bytes_limit BIGINT,
    vpn_is_active BOOLEAN DEFAULT false,
    
    -- Subscription/Billing
    plan_type VARCHAR(50) DEFAULT 'free',  -- 'free' | 'basic' | 'pro' | 'enterprise'
    billing_cycle VARCHAR(20) DEFAULT 'monthly',
    subscription_status VARCHAR(20) DEFAULT 'active',
    subscription_expires_at TIMESTAMPTZ,
    sister_allocation_enabled BOOLEAN DEFAULT true,  -- 5% sister allocation ledger
    maintenance_buffer_inr INT DEFAULT 2000,  -- 2000 INR minimum maintenance buffer
    
    -- Referral
    referral_code VARCHAR(20) UNIQUE,
    referred_by UUID REFERENCES users(id),
    referral_count INT DEFAULT 0,
    referral_earnings_inr DECIMAL(12,2) DEFAULT 0,
    
    -- Social
    followers_count INT DEFAULT 0,
    following_count INT DEFAULT 0,
    posts_count INT DEFAULT 0,
    
    -- Timestamps
    last_seen_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_auth_service_id ON users(auth_service_id);
CREATE INDEX IF NOT EXISTS idx_users_vpn_account_id ON users(vpn_account_id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_vpn_active ON users(vpn_is_active) WHERE vpn_is_active = true;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE users IS 'Extended user profiles with VPN account management and billing';
COMMENT ON COLUMN users.vpn_account_id IS 'Unique VPN account identifier for registration tests';
COMMENT ON COLUMN users.vpn_config_json IS 'WireGuard/OpenVPN configuration as JSON';
COMMENT ON COLUMN users.sister_allocation_enabled IS '5% sister allocation ledger rule';
COMMENT ON COLUMN users.maintenance_buffer_inr IS '2000 INR minimum maintenance buffer parameter';