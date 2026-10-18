-- ============================================================================
-- 004_create_compliance_enforcement_tables.sql   (PostgreSQL)
-- ============================================================================
-- PURPOSE: compliance_violations aur system_logs tables create karna
--          AURA student/content policy enforcement loop ke liye.
--
-- ENFORCEMENT LOOP:
--   Step 1 (pehli violation): warning system log + notification
--   Step 2 (doosri violation): channel SUSPENDED, wallet withdrawal freeze,
--                               25% pricing penalty fine
--
-- TABELS:
--   1. compliance_violations - per-user violation tracking (warning/suspended/penalty)
--   2. system_logs          - automated warning/suspension/penalty notifications
--
-- RE-RUN SAFE: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
-- ============================================================================

BEGIN;

-- ---- STEP 1: compliance_violations table ----
CREATE TABLE IF NOT EXISTS compliance_violations (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL,
    channel_id      UUID,
    violation_type  VARCHAR(50) NOT NULL,
    status          VARCHAR(30) NOT NULL DEFAULT 'warning'
                    CHECK (status IN ('warning', 'suspended', 'penalty_applied', 'resolved')),
    warning_sent    BOOLEAN NOT NULL DEFAULT false,
    warning_sent_at TIMESTAMPTZ,
    suspended_at    TIMESTAMPTZ,
    penalty_amount  NUMERIC(20,2) NOT NULL DEFAULT 0,
    penalty_paid    BOOLEAN NOT NULL DEFAULT false,
    wallet_frozen   BOOLEAN NOT NULL DEFAULT false,
    wallet_frozen_at TIMESTAMPTZ,
    details         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_violations_user_id
    ON compliance_violations(user_id);
CREATE INDEX IF NOT EXISTS idx_compliance_violations_status
    ON compliance_violations(status);
CREATE INDEX IF NOT EXISTS idx_compliance_violations_channel_id
    ON compliance_violations(channel_id) WHERE channel_id IS NOT NULL;

-- ---- STEP 2: system_logs table ----
CREATE TABLE IF NOT EXISTS system_logs (
    id        SERIAL PRIMARY KEY,
    user_id   INT NOT NULL,
    log_type  VARCHAR(50) NOT NULL
                    CHECK (log_type IN ('compliance_warning', 'suspension_notice', 'penalty_notice')),
    message   TEXT NOT NULL,
    template  VARCHAR(50) NOT NULL,
    channel_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_logs_user_id
    ON system_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_log_type
    ON system_logs(log_type);
CREATE INDEX IF NOT EXISTS idx_system_logs_channel_id
    ON system_logs(channel_id) WHERE channel_id IS NOT NULL;

COMMENT ON TABLE compliance_violations IS 'AURA compliance violation tracking — Step 1 warning → Step 2 suspension + 25% penalty';
COMMENT ON COLUMN compliance_violations.user_id IS 'billing-side user uint (identity adapter mapping)';
COMMENT ON COLUMN compliance_violations.channel_id IS 'auth-service channel UUID (optional)';
COMMENT ON COLUMN compliance_violations.violation_type IS 'non_educational_upload | policy_violation | document_fraud';
COMMENT ON COLUMN compliance_violations.status IS 'warning | suspended | penalty_applied | resolved';
COMMENT ON COLUMN compliance_violations.penalty_amount IS '25% of plan price, minor units';
COMMENT ON COLUMN compliance_violations.wallet_frozen IS 'withdrawal freeze active (Step 2)';

COMMENT ON TABLE system_logs IS 'Automated system notification logs for compliance enforcement';
COMMENT ON COLUMN system_logs.log_type IS 'compliance_warning | suspension_notice | penalty_notice';
COMMENT ON COLUMN system_logs.template IS 'compliance_warning_v1 | suspension_notice_v1 | penalty_notice_v1';

COMMIT;
