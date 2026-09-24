-- Migration: 003_create_auth_challenges_table.sql
-- Database: auth_biometric
-- Description: WebAuthn challenge storage for registration and authentication flows

CREATE TABLE auth_challenges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    challenge BYTEA NOT NULL,
    challenge_b64url VARCHAR(512) NOT NULL UNIQUE,
    challenge_type VARCHAR(20) NOT NULL,
    
    rp_id VARCHAR(255) NOT NULL,
    rp_name VARCHAR(255) NOT NULL,
    user_verification VARCHAR(20) DEFAULT 'preferred',
    authenticator_attachment VARCHAR(20),
    require_resident_key BOOLEAN DEFAULT false,
    user_verification_requirement VARCHAR(20) DEFAULT 'preferred',
    
    allowed_credential_ids BYTEA,
    
    client_ip INET,
    user_agent TEXT,
    origin TEXT,
    
    status VARCHAR(20) DEFAULT 'pending',
    used_at TIMESTAMPTZ,
    failure_reason TEXT,
    
    expires_at TIMESTAMPTZ NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    used_at_actual TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'idx_auth_challenges_challenge_b64url'
      AND object_id = OBJECT_ID('auth_challenges')
)
BEGIN
    CREATE INDEX idx_auth_challenges_challenge_b64url
        ON auth_challenges(challenge_b64url);
END;
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'idx_auth_challenges_user_id'
      AND object_id = OBJECT_ID('auth_challenges')
)
BEGIN
    CREATE INDEX idx_auth_challenges_user_id
        ON auth_challenges(user_id);
END;
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'idx_auth_challenges_status'
      AND object_id = OBJECT_ID('auth_challenges')
)
BEGIN
    CREATE INDEX idx_auth_challenges_status
        ON auth_challenges(status);
END;
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'idx_auth_challenges_expires_at'
      AND object_id = OBJECT_ID('auth_challenges')
)
BEGIN
    CREATE INDEX idx_auth_challenges_expires_at
        ON auth_challenges(expires_at);
END;
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'idx_auth_challenges_type'
      AND object_id = OBJECT_ID('auth_challenges')
)
BEGIN
    CREATE INDEX idx_auth_challenges_type
        ON auth_challenges(challenge_type);
END;

EXEC sys.sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'WebAuthn challenges for registration and authentication flows',
    @level0type = N'Schema', @level0name = N'dbo',
    @level1type = N'Table', @level1name = N'auth_challenges';
EXEC sys.sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'Raw challenge bytes (32 cryptographically random bytes)',
    @level0type = N'Schema', @level0name = N'dbo',
    @level1type = N'Table', @level1name = N'auth_challenges',
    @level2type = N'Column', @level2name = N'challenge';
EXEC sys.sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'registration: new credential registration, authentication: login with existing credential',
    @level0type = N'Schema', @level0name = N'dbo',
    @level1type = N'Table', @level1name = N'auth_challenges',
    @level2type = N'Column', @level2name = N'challenge_type';
EXEC sys.sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'Array of credential IDs allowed for this authentication',
    @level0type = N'Schema', @level0name = N'dbo',
    @level1type = N'Table', @level1name = N'auth_challenges',
    @level2type = N'Column', @level2name = N'allowed_credential_ids';
EXEC sys.sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'Challenge expiration timestamp (5-10 minutes from creation)',
    @level0type = N'Schema', @level0name = N'dbo',
    @level1type = N'Table', @level1name = N'auth_challenges',
    @level2type = N'Column', @level2name = N'expires_at';

GO

CREATE OR ALTER PROCEDURE cleanup_expired_challenges
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM auth_challenges 
    WHERE expires_at < NOW() 
    AND status IN ('pending', 'failed');

    DECLARE @deleted_count INTEGER = @@ROWCOUNT;
    PRINT CONCAT('Cleaned up ', @deleted_count, ' expired challenges');
END;