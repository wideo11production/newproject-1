-- Migration: 003_create_student_verifications_table.sql
-- Database: user_service
-- Description: Dual-gate (Gate A: domain whitelist, Gate B: ID card upload)
--              student verification table with 365-day cryptographic token.
-- PostgreSQL format (GORM AutoMigrate compatible).

CREATE TABLE IF NOT EXISTS student_verifications (
    id         SERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

    -- Verification state machine
    status      VARCHAR(30) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'verified_by_domain',
                                      'pending_document', 'verified',
                                      'rejected', 'expired')),

    -- Gate A: email domain for instant academic check
    email_domain VARCHAR(255),

    -- Gate B: document fallback
    id_document_url      TEXT,
    id_document_uploaded TIMESTAMP WITH TIME ZONE,

    -- 365-day cryptographic token (JWT)
    verification_token TEXT,
    token_expires_at   TIMESTAMP WITH TIME ZONE,

    -- Manual review metadata (Gate B admin path)
    reviewed_by      BIGINT,
    reviewed_at      TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,

    -- Audit
    uuid       UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_student_verifications_user_id
    ON student_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_student_verifications_status
    ON student_verifications(status);
CREATE INDEX IF NOT EXISTS idx_student_verifications_email_domain
    ON student_verifications(email_domain) WHERE email_domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_student_verifications_token_expires_at
    ON student_verifications(token_expires_at) WHERE token_expires_at IS NOT NULL;

COMMENT ON TABLE student_verifications IS
    'AURA student gate: Gate A (domain whitelist) + Gate B (ID card + 365-day token)';
COMMENT ON COLUMN student_verifications.status IS
    'pending | verified_by_domain | pending_document | verified | rejected | expired';
COMMENT ON COLUMN student_verifications.email_domain IS
    'User email domain (Gate A: instant verification if in academic seed list)';
COMMENT ON COLUMN student_verifications.verification_token IS
    '365-day JWT proof-of-issuance, minted for both Gate A and Gate B';
COMMENT ON COLUMN student_verifications.token_expires_at IS
    'Absolute 365-day expiry boundary - auto-invalidates on expiry';
