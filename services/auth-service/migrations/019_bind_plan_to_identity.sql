-- =============================================================================
-- 019: bind a plan to the identity it was granted to
-- =============================================================================
--
-- THE ABUSE THIS EXISTS TO STOP
--
-- A `lifetime` plan is not transferable. Not by a gift, not by a "team"
-- arrangement, and not by taking over someone else's account.
--
-- The realistic version of that, which is not hypothetical:
--
--   Six friends share one laptop. Day one, Friend A buys a lifetime plan and
--   logs in. Day two, Friend B needs the editor, so A hands over the address
--   and password - or B changes the account's email to their own and uses it.
--   Repeat until the device allowance is gone, and nobody can say which of them
--   it was that did it.
--
-- Two holes fed that, and both are closed here:
--
--   1. NOTHING TIED THE PLAN TO AN IDENTITY. `entitlements` had no email column
--      at all, so a lifetime plan was not granted to a person - it was granted
--      to a row, and any email that reached that row inherited it.
--
--   2. CHANGING THE ACCOUNT EMAIL CHANGED NOTHING. Since the plan did not
--      reference the email, replacing it did not break anything. That is the
--      exact move the abuse needs, and it cost nothing.
--
-- Now the plan records the email it was granted for, and `bound_email` is part
-- of whether it is LIVE. Change the address and a lifetime plan stops applying
-- to the new address until it is re-verified.
--
-- -----------------------------------------------------------------------------
-- WHY ONLY LIFETIME, AND WHY THIS IS THE MINIMUM
-- -----------------------------------------------------------------------------
--
-- A month-to-month subscription self-limits: payment stops and the plan stops.
-- A lifetime plan does not, so it is the only one that needs an identity
-- attached, and it is the only one that can be resold.
--
-- The column is nullable, and NULL means "bound to the USER, not an address" -
-- which is correct for a seeded or migrated plan, and is deliberately a
-- DIFFERENT state from "bound to a@b.com" so the two are never confused.
--
-- This is not a complete answer, and pretending otherwise would be the same
-- mistake as calling the device limit "handled". Sharing is also observable in
-- ways a bound email does not catch. What this buys is that the plan stops
-- following the person, and that a change of address is a HARD STOP rather than
-- a free swap. The rest is §4 in `SERVICE-AND-MEDIA-PARITY.md` territory.

BEGIN;

ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS bound_email VARCHAR(255);

-- The bound address is only meaningful for a plan that can be resold, so it is
-- indexed here rather than on every row: the lookup that matters is "find this
-- user's lifetime plans", and every other read is by user_id which is already
-- indexed.
CREATE INDEX IF NOT EXISTS idx_entitlements_bound_email
    ON entitlements (bound_email)
    WHERE bound_email IS NOT NULL AND ends_at IS NULL;

-- `is_transferable` is a permanent FALSE marker rather than a deleted column.
--
-- It answers a question that WILL be asked by a future maintainer - "can this
-- plan be gifted or pooled?" - and the answer has to be in the schema, where it
-- is read, rather than in a paragraph nobody opens. It is also CHECK-constrained
-- to FALSE, so it cannot be set true by a bug: flipping it requires editing this
-- migration, which is deliberate friction on a decision that should be
-- reconsidered on purpose.
ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS is_transferable BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE entitlements
  DROP CONSTRAINT IF EXISTS chk_entitlement_not_transferable;
ALTER TABLE entitlements
  ADD CONSTRAINT chk_entitlement_not_transferable
    CHECK (is_transferable = false);

-- Suspended is a SEPARATE state from revoked, and the difference is the point.
--
-- Revoked  = the plan is gone, deliberately ended by an admin or a cancellation.
-- Suspended = the plan still exists and is still paid for, but it is not
--   applying RIGHT NOW because its identity no longer matches. It resumes by
--   verifying the new address.
--
-- Collapsing them would make "suspended" unrecoverable, and the honest
-- situation - a customer who changed their email by accident and still paid -
-- would be treated as theft.
ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS suspend_reason TEXT;

ALTER TABLE entitlements
  DROP CONSTRAINT IF EXISTS chk_suspend_reason;
ALTER TABLE entitlements
  ADD CONSTRAINT chk_suspend_reason
    CHECK (suspended_at IS NULL OR suspend_reason IS NOT NULL);

-- A suspended plan should be findable without scanning every row.
CREATE INDEX IF NOT EXISTS idx_entitlements_suspended
    ON entitlements (user_id)
    WHERE suspended_at IS NOT NULL;

-- `sp_addextendedproperty` was SQL Server's way of writing a column comment.
-- PostgreSQL uses `COMMENT ON COLUMN`, which is idempotent: running it twice
-- updates the text rather than failing. That is what these four blocks were
-- expressing, in a dialect that could not execute here at all.
COMMENT ON COLUMN entitlements.bound_email IS
  'The address this plan was granted for. NULL means bound to the user, not to an address. Part of whether the plan is LIVE, so changing an email does not silently carry a lifetime plan to the new address.';

COMMENT ON COLUMN entitlements.is_transferable IS
  'Always FALSE, and CHECK-constrained to stay that way. A lifetime plan is not giftable and not poolable; a friend handing over a login is account sharing, not a transfer.';

COMMENT ON COLUMN entitlements.suspended_at IS
  'Set when the identity stops matching - the bound email is no longer the account''s address. Distinct from revoked: the plan is still paid for and resumes when the address is verified.';

COMMENT ON COLUMN entitlements.suspend_reason IS
  'Required whenever suspended_at is set, by CHECK constraint. A suspension nobody can explain is indistinguishable from a bug.';

COMMENT ON TABLE entitlements IS
  'Plan capabilities granted to an identity. A `lifetime` plan is bound to the address it was bought for (bound_email) and is never transferable - see migration 019.';

COMMIT;