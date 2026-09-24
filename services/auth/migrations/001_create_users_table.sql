-- Migration: 001_create_users_table.sql
-- Database: auth_biometric
-- Description: Core user table with biometric authentication support

-- Create extensions
-- UUID generation is provided by the database; no PostgreSQL extension is required here.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_extension
        WHERE extname = 'pgcrypto'
    ) THEN
        CREATE EXTENSION "pgcrypto";
    END IF;
END;
$$;

-- Users table with biometric authentication support
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255), -- nullable for biometric-only users
    full_name VARCHAR(255),
    avatar_url VARCHAR(500),
    
    -- Biometric authentication fields
    biometric_credential_id BYTEA,           -- WebAuthn credential ID
    biometric_public_key BYTEA,              -- Public key for verification
    biometric_sign_count BIGINT DEFAULT 0,   -- Signature counter for replay protection
    biometric_aaguid UUID,                   -- Authenticator AAGUID
    biometric_attestation_type VARCHAR(50),  -- 'none' | 'basic' | 'self' | 'attca' | 'ecdaa'
    biometric_transports TEXT[],             -- ['usb', 'nfc', 'ble', 'internal', 'hybrid']
    biometric_backup_eligible BOOLEAN DEFAULT false,
    biometric_backup_state BOOLEAN DEFAULT false,
    biometric_created_at TIMESTAMPTZ DEFAULT NOW(),
    biometric_last_used_at TIMESTAMPTZ,
    
    -- Account status
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    email_verified_at TIMESTAMPTZ,
    
    -- Account security
    failed_login_attempts INT DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_biometric_credential_id ON users(biometric_credential_id);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- Trigger to update updated_at timestamp
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

-- Comments
COMMENT ON TABLE users IS 'Core user accounts with WebAuthn biometric authentication support';
COMMENT ON COLUMN users.biometric_credential_id IS 'WebAuthn credential ID (Base64URL encoded)';
COMMENT ON COLUMN users.biometric_public_key IS 'COSE encoded public key for signature verification';
COMMENT ON COLUMN users.biometric_sign_count IS 'Signature counter for replay attack prevention';
COMMENT ON COLUMN users.biometric_transports IS 'Supported transports: usb, nfc, ble, internal, hybrid';