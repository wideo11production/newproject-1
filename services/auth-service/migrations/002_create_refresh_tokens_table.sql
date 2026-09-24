-- Migration: 002_create_refresh_tokens_table.sql
-- Database: auth_service
-- Description: Refresh token storage for JWT refresh flow

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Token data
    token_hash VARCHAR(255) NOT NULL UNIQUE,  -- SHA-256 hash of the refresh token
    token_family UUID NOT NULL,                -- Family ID for token rotation detection
    token_index INT NOT NULL DEFAULT 0,        -- Index within family for rotation

    -- Token metadata
    expires_at TIMESTAMPTZ NOT NULL,
    issued_at TIMESTAMPTZ DEFAULT NOW(),

    -- Client info
    user_agent TEXT,
    ip_address INET,
    device_fingerprint VARCHAR(255),

    -- Status
    is_revoked BOOLEAN DEFAULT false,
    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(255),

    -- Replacement token (for rotation)
    replaced_by_token_id UUID REFERENCES refresh_tokens(id),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at_actual TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (token_family);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens (expires_at);
CREATE INDEX idx_refresh_tokens_revoked ON refresh_tokens(is_revoked);
CREATE INDEX idx_refresh_tokens_user_family ON refresh_tokens (user_id, token_family);

-- Table: refresh_tokens - Refresh tokens for JWT refresh flow with token rotation
-- Column: token_hash - SHA-256 hash of the refresh token (never store plain token)
-- Column: token_family - Family ID for detecting token reuse attacks
-- Column: token_index - Index within family for detecting token reuse
-- Column: token_family - Used for detecting token reuse - if same family used twice, revoke all