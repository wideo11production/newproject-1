-- Migration: 002_create_webauthn_credentials_table.sql
-- Database: auth_biometric
-- Description: WebAuthn credentials storage for multiple authenticators per user

IF OBJECT_ID(N'dbo.webauthn_credentials', N'U') IS NULL
BEGIN
CREATE TABLE dbo.webauthn_credentials (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_webauthn_credentials PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Credential identification
    credential_id VARBINARY(MAX) NOT NULL UNIQUE,      -- Raw credential ID (for lookups)
    credential_id_b64url VARCHAR(512) NOT NULL UNIQUE,  -- Base64URL encoded for API
    
    -- Credential data
    public_key VARBINARY(MAX) NOT NULL,       -- COSE encoded public key
    sign_count BIGINT NOT NULL DEFAULT 0,     -- Signature counter
    aaguid UNIQUEIDENTIFIER,                  -- Authenticator AAGUID
    attestation_type VARCHAR(50),             -- 'none' | 'basic' | 'self' | 'attca' | 'ecdaa'
    transports NVARCHAR(MAX) DEFAULT N'',     -- ['usb', 'nfc', 'ble', 'internal', 'hybrid']
    
    -- Metadata
    name VARCHAR(100),                        -- User-friendly name (e.g., "YubiKey 5", "Face ID")
    is_primary BOOLEAN DEFAULT false,         -- Primary credential for login
    is_backup_eligible BOOLEAN DEFAULT false,
    is_backup_state BOOLEAN DEFAULT false,
    
    -- Usage tracking
    sign_count_last_synced BIGINT DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    last_used_ip VARCHAR(45),
    use_count BIGINT DEFAULT 0,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(255),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at DATETIMEOFFSET
);
END;

-- Indexes
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_webauthn_credentials_user_id' AND object_id = OBJECT_ID(N'dbo.webauthn_credentials'))
    CREATE INDEX idx_webauthn_credentials_user_id ON dbo.webauthn_credentials(user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_webauthn_credentials_credential_id' AND object_id = OBJECT_ID(N'dbo.webauthn_credentials'))
    CREATE INDEX idx_webauthn_credentials_credential_id ON dbo.webauthn_credentials(credential_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_webauthn_credentials_user_active' AND object_id = OBJECT_ID(N'dbo.webauthn_credentials'))
    CREATE INDEX idx_webauthn_credentials_user_active ON dbo.webauthn_credentials(user_id, is_active);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_webauthn_credentials_primary' AND object_id = OBJECT_ID(N'dbo.webauthn_credentials'))
    CREATE INDEX idx_webauthn_credentials_primary ON dbo.webauthn_credentials(user_id, is_primary) WHERE is_primary = 1;

-- Trigger for updated_at
IF OBJECT_ID(N'dbo.update_webauthn_credentials_updated_at', N'TR') IS NOT NULL
    DROP TRIGGER dbo.update_webauthn_credentials_updated_at;
GO

CREATE TRIGGER update_webauthn_credentials_updated_at
    ON dbo.webauthn_credentials
    AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE c
    SET updated_at = SYSDATETIMEOFFSET()
    FROM dbo.webauthn_credentials AS c
    INNER JOIN inserted AS i ON i.id = c.id;
END;
GO