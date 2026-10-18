-- ============================================================================
-- 035_create_student_verifications_table.sql   (PostgreSQL)
-- ============================================================================
-- PURPOSE: AURA student verification engine ke liye student_verifications
--          table create karna. Ye user-service ke 003_create_student_verifications_table.sql
--          se mirror hai, lekin auth-service schema (UUID users.id) ke mutabik.
--
-- DUAL-GATE VERIFICATION STATE MACHINE:
--   Gate A (domain whitelist): academic domain seed list match → instant verified_by_domain
--   Gate B (document fallback): ID card upload → pending_document → verified/rejected
--   365-day cryptographic token: JWT proof of issuance
--
-- PROFESSIONAL ROLES: student, tutor, advocate (bar_association_id for advocate)
--
-- Hinglish: ye table ek user ke verification state ko track karti hai.
-- Ek user ka ek verification record hota hai (unique user_id).
-- Har row ka apna UUID hai (cross-service proof ke liye).
-- ============================================================================

BEGIN;

-- ---- STEP 1: student_verifications table create karna ----
CREATE TABLE IF NOT EXISTS student_verifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

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
    reviewed_by      UUID,
    reviewed_at      TIMESTAMPTZ,
    rejection_reason TEXT,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- STEP 2: Indexes for fast lookups ----
CREATE INDEX IF NOT EXISTS idx_student_verifications_user_id
    ON student_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_student_verifications_status
    ON student_verifications(status);
CREATE INDEX IF NOT EXISTS idx_student_verifications_email_domain
    ON student_verifications(email_domain) WHERE email_domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_student_verifications_token_expires_at
    ON student_verifications(token_expires_at) WHERE token_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_student_verifications_professional_role
    ON student_verifications(professional_role) WHERE professional_role != '';

-- ---- STEP 3: Updated-at trigger ----
DROP TRIGGER IF EXISTS update_student_verifications_updated_at ON student_verifications;
CREATE TRIGGER update_student_verifications_updated_at
    BEFORE UPDATE ON student_verifications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE student_verifications IS 'AURA student/professional verification records (Gate A domain + Gate B document, 365-day token)';
COMMENT ON COLUMN student_verifications.user_id IS 'FK to users.id (UUID) — one verification per user';
COMMENT ON COLUMN student_verifications.professional_role IS 'student | tutor | advocate — determines which Gate A seed list applies';
COMMENT ON COLUMN student_verifications.bar_association_id IS 'Advocate Bar Council membership number (Gate B mandatory for advocate)';
COMMENT ON COLUMN student_verifications.status IS 'pending | verified_by_domain | pending_document | verified | rejected | expired';
COMMENT ON COLUMN student_verifications.email_domain IS 'Gate A: email domain extracted from user email';
COMMENT ON COLUMN student_verifications.id_document_url IS 'Gate B: MinIO path to uploaded ID document';
COMMENT ON COLUMN student_verifications.verification_token IS '365-day JWT proof-of-issuance (cross-service verification proof)';
COMMENT ON COLUMN student_verifications.token_expires_at IS 'Absolute 365-day token expiry boundary';

-- ---- STEP 4: Idempotency note ----
-- Ye migration re-run safe hai: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER idempotent hain.
