-- =============================================================================
-- 016: entitlements
-- =============================================================================
--
-- WHAT THIS IS FOR
--
-- Every quota in this product - saved projects, stored media, concurrent
-- transcodes, export height, lifetime device slots - is checked on a request
-- path. Those checks need one question answered fast and consistently: "what is
-- this user ALLOWED to do right now?"
--
-- Until now, nothing answered it. The limits lived as `if` statements next to
-- whatever happened to need them, which is how two code paths end up disagreeing
-- about the same limit.
--
-- WHY A TABLE AND NOT A CONFIG READ
--
-- The plan catalog is seeded from `.env` at boot, but EVERY READ comes from this
-- table. That separation is the point:
--
--   config  - what we intend to sell (deploy-time, changes rarely)
--   table   - what we actually sold to this user (request-time, changes per user)
--
-- Reading limits straight from env would mean every quota check depends on a
-- process restart to change, and a user mid-cycle would need the whole fleet
-- restarted to pick up their own upgrade.
--
-- -----------------------------------------------------------------------------
-- WHY THIS IS A LEDGER, NOT A COLUMN ON users
-- -----------------------------------------------------------------------------
--
-- `users.plan_code` cannot express "was Pro until Tuesday, downgraded to Starter
-- after that". Entitlements are a history: several rows can be live at once, and
-- the answer is the MAXIMUM of what they grant. That is what makes "Pro, then
-- downgraded" work without deleting the Pro row and losing the record that it
-- ever existed.
--
-- So: append rows, fold on read. A single mutable plan column drifts the first
-- time a cancellation, a reversal or a concurrent write happens, and a drift is
-- invisible and permanent.
--
-- -----------------------------------------------------------------------------
-- THE SPLIT WITH billing-service
-- -----------------------------------------------------------------------------
--
-- `billing-service` owns `subscription_plans` - price, currency, cycle, tax. It
-- is the CATALOG OF WHAT PEOPLE PAY FOR, and it changes when marketing does.
--
-- This table is the CATALOG OF WHAT THEY MAY DO, and it changes when the product
-- changes.
--
-- They are separate on purpose. Pricing moves constantly; capabilities do not.
-- Keeping them in one table would mean every price change is a migration on the
-- entitlements table, and every capability change is a pricing migration.
--
-- Phase 6's webhooks write here. That is the only place money becomes
-- permission, and it happens once per event rather than on every request.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The capability catalog
-- -----------------------------------------------------------------------------
--
-- Seeded from `.env` at boot, and RE-SEEDED on every boot, so a plan change is
-- an env change and a restart - not a migration someone has to remember.
--
-- `plan_code` + `capability` is the primary key, so re-seeding is an upsert and
-- a capability removed from a plan in `.env` DISAPPEARS on the next boot rather
-- than lingering forever.
CREATE TABLE IF NOT EXISTS entitlement_grants (
    id           BIGSERIAL PRIMARY KEY,
    plan_code    VARCHAR(32)  NOT NULL,
    capability   VARCHAR(64)  NOT NULL,

    -- NULL means UNLIMITED. Deliberately not 0: 0 and "unlimited" are different
    -- answers, and using 0 for both means a revoked capability and a generous one
    -- are indistinguishable.
    limit_value  BIGINT,

    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_grant UNIQUE (plan_code, capability)
);

CREATE INDEX IF NOT EXISTS idx_grants_plan
    ON entitlement_grants(plan_code);

COMMENT ON TABLE entitlement_grants IS
  'Capability catalog: what each plan grants. NULL limit_value means unlimited. Re-seeded from .env on every boot, so a plan change is an env change and a restart rather than a migration someone has to remember.';

COMMENT ON COLUMN entitlement_grants.limit_value IS
  'NULL means UNLIMITED, not zero. Zero and unlimited are different answers, and collapsing them makes a revoked capability indistinguishable from a generous one.';

-- -----------------------------------------------------------------------------
-- 2. What a user actually holds
-- -----------------------------------------------------------------------------
--
-- Append-only. `plan_code` is not a foreign key to `entitlement_grants` on
-- purpose: a user must be able to keep an entitlement for a plan that has since
-- been retired from the catalogue. Removing a plan from sale must not invalidate
-- the people who bought it - which a FK plus an "upsert or delete" habit would.
CREATE TABLE IF NOT EXISTS entitlements (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    plan_code    VARCHAR(32) NOT NULL,

    -- 'subscription' | 'lifetime' | 'trial' | 'grant' (admin gift) | 'migration'
    --
    -- Recorded because the reason an entitlement exists decides whether it can be
    -- cancelled. A trial auto-expires; a lifetime one never does.
    source       VARCHAR(16) NOT NULL DEFAULT 'subscription',

    starts_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- NULL ends_at means FOREVER. That is how a lifetime plan is expressed -
    -- as the absence of an end rather than as a date far in the future that
    -- eventually has to be extended, and eventually gets missed.
    ends_at      TIMESTAMPTZ,

    -- Set when the user cancels. NOT the same as ends_at: a cancelled
    -- subscription keeps working until the period it was paid for runs out.
    -- Collapsing the two would revoke access the user already paid for, which is
    -- both wrong and the fastest way to a chargeback.
    cancelled_at TIMESTAMPTZ,

    -- Payment period bounds, kept for revenue reporting. NULL on a lifetime.
    current_period_start TIMESTAMPTZ,
    current_period_end   TIMESTAMPTZ,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The hot query is "all live entitlements for this user", so the index leads
-- with user_id.
CREATE INDEX IF NOT EXISTS idx_entitlements_user_live
    ON entitlements(user_id, ends_at)
    WHERE cancelled_at IS NULL;

-- A user may hold several entitlements; the same plan twice is only ever a bug
-- (a double webhook), and two rows would double-count nothing but would make
-- "cancel one" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_entitlement_user_plan
    ON entitlements(user_id, plan_code);

-- Expiry sweeper.
CREATE INDEX IF NOT EXISTS idx_entitlements_ends
    ON entitlements(ends_at)
    WHERE ends_at IS NOT NULL;

COMMENT ON TABLE entitlements IS
  'Append-only ledger of what a user holds. Effective entitlement is the MAXIMUM over live rows, which is what lets a downgrade work without deleting history. ends_at NULL means forever (lifetime). cancelled_at is NOT ends_at: access continues until the paid period ends.';

COMMENT ON COLUMN entitlements.plan_code IS
  'Deliberately NOT a foreign key to entitlement_grants. A user must keep an entitlement for a plan that has since been retired from sale - removing a plan must not invalidate the people who bought it.';

COMMENT ON COLUMN entitlements.cancelled_at IS
  'NOT the same as ends_at. A cancelled subscription keeps working until the period it was paid for runs out; collapsing the two would revoke access that was paid for, which is both wrong and the fastest route to a chargeback.';

COMMENT ON COLUMN entitlements.ends_at IS
  'NULL means forever - that is how a lifetime plan is expressed. A far-future date would instead be a date that eventually has to be extended and eventually gets missed.';

COMMIT;
