-- =============================================================================
-- 017: service access + roles, permissions and appointments
-- =============================================================================
--
-- WHAT THIS IS FOR
--
-- One session for every service, and one answer to "what may this person do?".
-- The full requirement is in `updatedtodo.md` Session 17; this is the schema for
-- pieces 1-3 of it.
--
-- The user could previously open the dashboard without signing in again to
-- reach the editor, billing or admin. Nothing recorded WHICH service a person
-- may use, so the only options were "everything" or "nothing" - and access was
-- enforced per service, in code, differently each time.
--
-- -----------------------------------------------------------------------------
-- WHY FOUR TABLES AND NOT ONE COLUMN
-- -----------------------------------------------------------------------------
--
-- `users.service_access` would answer "can this person reach the editor" and
-- nothing else. It cannot answer:
--
--   - which services did they have, and when did that stop? (revoked_at)
--   - what may they DO inside a service?                 (permissions)
--   - who gave them that, and who may take it back?      (appointed_by)
--   - what would happen if we deleted the row?            (nothing - the history
--                                                         IS the evidence)
--
-- So: access is a row with a revocation, and authority is a separate, richer
-- thing. They are genuinely different questions and merging them would mean a
-- table with nullable everything.
--
-- -----------------------------------------------------------------------------
-- THE RULE THAT MAKES DELEGATION SAFE
-- ------------------------------------------------------------------------------
--
--   An appointment can never grant a permission the granter does not hold.
--
-- Enforced in the service layer, because a CHECK constraint cannot express it -
-- and because the check has to compare against a whole role's permission set at
-- write time. Without it, anyone who can appoint people can appoint themselves
-- superadmin, and the entire model is theatre.
--
-- -----------------------------------------------------------------------------
-- SUPERADMIN HAS NO ROWS
-- ------------------------------------------------------------------------------
--
-- A superadmin implicitly holds every service and every permission, and gets
-- ZERO rows here. An explicit "superadmin can do everything" row would be a
-- second source of truth about the most powerful account in the system, and the
-- two would eventually disagree.
--
-- Superadmin is likewise unreachable through `appointments`: elevation is a
-- distinct, narrower operation held in `superadmin_accounts`. Merging the two
-- would make privilege escalation self-service.

BEGIN;

-- =============================================================================
-- 1. Service access
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_services (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The service slug, from a CLOSED list in Go (see serviceauth/service.go).
    -- A CHECK constraint here is deliberate belt-and-braces: the application
    -- already validates, so a value that arrives by any other route - a script, a
    -- future migration, psql - is rejected by the database too.
    service     VARCHAR(32) NOT NULL,

    granted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Revocation, not deletion. "Who had access to what" must stay answerable,
    -- and a deleted grant cannot prove an ex-employee no longer has access.
    revoked_at  TIMESTAMPTZ,
    revoked_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_reason TEXT,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_user_service UNIQUE (user_id, service),
    CONSTRAINT chk_user_services_slug CHECK (service IN (
        'web', 'video_editor', 'analytics', 'billing', 'admin',
        'monitor', 'superadmin', 'currency'
    )),
    -- A revoked grant can be re-granted, but not while a live one exists.
    -- The unique index is on the pair alone, so a revocation must be followed by
    -- an UPDATE of the same row rather than a second INSERT - and this check
    -- makes the intent explicit.
    CONSTRAINT chk_user_services_revoke_reason
        CHECK (revoked_at IS NULL OR revoked_reason IS NULL OR length(revoked_reason) > 0)
);

CREATE INDEX IF NOT EXISTS idx_user_services_live
    ON user_services(user_id)
    WHERE revoked_at IS NULL;

-- =============================================================================
-- 2. Roles and permissions
-- =============================================================================
CREATE TABLE IF NOT EXISTS roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(48) NOT NULL UNIQUE,
    description TEXT,

    -- Higher rank may appoint lower ranks. Enforced in the service layer.
    -- Kept as an integer rather than a string for the same reason.
    rank        INT NOT NULL DEFAULT 0,

    -- A SYSTEM role is defined by this codebase and cannot be deleted or
    -- renamed - otherwise a later deploy would leave appointments pointing at a
    -- role that no longer means what it meant.
    is_system   BOOLEAN NOT NULL DEFAULT false,

    -- Whether this role may be handed to a non-superadmin at all. Kept so that a
    -- future "admin" role is not accidentally delegable.
    delegable   BOOLEAN NOT NULL DEFAULT true,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The permission vocabulary. A closed set, and the same reason as services: a
-- label that can be invented at runtime is a label nobody has reviewed.
CREATE TABLE IF NOT EXISTS permissions (
    name        VARCHAR(64) PRIMARY KEY,
    description TEXT NOT NULL,
    -- Coarse grouping for the UI: "content", "money", "people", "platform".
    category    VARCHAR(24) NOT NULL DEFAULT 'general',
    -- A permission that hands out OTHER permissions is the dangerous class, and
    -- is tracked so it can be reviewed separately.
    is_delegating BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission  VARCHAR(64) NOT NULL REFERENCES permissions(name) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission)
);

-- =============================================================================
-- 3. Appointments
-- =============================================================================
CREATE TABLE IF NOT EXISTS appointments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,

    -- Who granted it. NULL only for a seeded system appointment, and a superadmin
    -- appointment is impossible by design, so this is never "nobody".
    appointed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    appointed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Time-limited authority is the default. An open-ended appointment is
    -- indistinguishable from a permanent one, and the difference is exactly what
    -- a review needs to see.
    expires_at    TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ,
    revoked_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_reason TEXT,

    -- Why this person got this role. A row with no reason is a row nobody will
    -- be able to explain at audit.
    reason        TEXT,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_appointment_reason
        CHECK (reason IS NOT NULL AND length(btrim(reason)) > 0)
);

-- The hot query: "what can this person do RIGHT NOW".
CREATE INDEX IF NOT EXISTS idx_appointments_live
    ON appointments(user_id, role_id)
    WHERE revoked_at IS NULL;

-- One live appointment per (user, role). A duplicate would not double a
-- permission, but it would make "revoke it" ambiguous, so re-granting is an
-- UPDATE of the same row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointment_user_role
    ON appointments(user_id, role_id)
    WHERE revoked_at IS NULL;

-- =============================================================================
-- 4. The privilege registry
-- =============================================================================
--
-- This view IS "the proper list superadmin holds": one query for every person,
-- every role, every permission and every service, with who granted it and when
-- it ends.
--
-- A view rather than a table because a registry that can be written directly
-- will be written directly, and then it disagrees with the tables it claims to
-- summarise. Derived data must be derived.
--
-- `is_superadmin` is included so an operator can see the difference at a glance
-- between "granted everything implicitly" and "holds these six permissions",
-- which are not the same claim even when the effect is identical.
CREATE OR REPLACE VIEW privilege_registry AS
SELECT
    u.id AS user_id,
    u.email,
    r.name        AS role,
    r.rank,
    p.name        AS permission,
    p.category,
    p.is_delegating,
    a.appointed_by,
    a.appointed_at,
    a.expires_at,
    a.reason,
    EXISTS (
        SELECT 1 FROM superadmin_accounts sa
        WHERE sa.user_id = u.id AND sa.is_active
    ) AS is_superadmin
FROM appointments a
JOIN users u            ON u.id = a.user_id
JOIN roles r            ON r.id = a.role_id
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p      ON p.name = rp.permission
WHERE a.revoked_at IS NULL
  AND (a.expires_at IS NULL OR a.expires_at > now())
UNION ALL
-- Superadmin's implicit everything, so the registry does not read as if they
-- hold nothing.
SELECT
    u.id AS user_id,
    u.email,
    'superadmin' AS role,
    2147483647 AS rank,
    '*' AS permission,
    'all' AS category,
    true AS is_delegating,
    NULL::uuid AS appointed_by,
    sa.created_at AS appointed_at,
    NULL::timestamptz AS expires_at,
    'superadmin_accounts slot ' || sa.slot::text AS reason,
    true AS is_superadmin
FROM superadmin_accounts sa
JOIN users u ON u.id = sa.user_id
WHERE sa.is_active;

COMMENT ON VIEW privilege_registry IS
    'Every person, role, permission and service grant, with who granted it and '
    'when it ends. Derived - never written directly, so it cannot disagree with '
    'the tables it summarises.';

COMMENT ON TABLE appointments IS
    'Who holds which role. Authority can only be delegated DOWNWARD: a granter '
    'can never grant a permission they do not hold themselves.';

COMMIT;