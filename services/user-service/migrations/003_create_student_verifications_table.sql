-- Migration: 003_create_student_verifications_table.sql
-- Database: user_service
-- Description: Dual-gate (Gate A: domain whitelist, Gate B: ID card upload)
--              student verification table with 365-day cryptographic token.
-- PostgreSQL format (GORM AutoMigrate compatible).

CREATE TABLE student_verifications (
    id         SERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

    -- Professional role: student, tutor, advocate
    professional_role VARCHAR(50) NOT NULL DEFAULT '',

    -- Advocate ke liye Bar Council membership number (agar advocate role hai)
    bar_association_id VARCHAR(100),

    -- Verification state machine
    status      VARCHAR(30) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'verified_by_domain',
                                      'pending_document', 'verified',
                                      'rejected', 'expired')),

    -- Gate A: email domain for instant professional check
    email_domain VARCHAR(255),

    -- Gate B: document fallback
    id_document_url      TEXT,
    id_document_uploaded TIMESTAMPTZ,
    document_type        VARCHAR(50) DEFAULT '',

    -- 365-day cryptographic token (JWT)
    verification_token TEXT,
    token_expires_at   TIMESTAMPTZ,

    -- Manual review metadata (Gate B admin path)
    reviewed_by      BIGINT,
    reviewed_at      TIMESTAMPTZ,
    rejection_reason TEXT,

    -- Audit
    uuid       UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX idx_student_verifications_user_id
    ON student_verifications(user_id);
CREATE INDEX idx_student_verifications_status
    ON student_verifications(status);
CREATE INDEX idx_student_verifications_email_domain
    ON student_verifications(email_domain) WHERE email_domain IS NOT NULL;
CREATE INDEX idx_student_verifications_token_expires_at
    ON student_verifications(token_expires_at) WHERE token_expires_at IS NOT NULL;
CREATE INDEX idx_student_verifications_professional_role
    ON student_verifications(professional_role) WHERE professional_role != '';


