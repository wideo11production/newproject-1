-- =============================================================================
-- 028: ENTITLEMENT GRANTS WERE SEEDED 18 TIMES OVER
-- =============================================================================
--
-- THE BUG THIS FILE FIXES
--
-- `entitlement_grants` is the plan CATALOGUE: one row per (plan, capability),
-- read into memory at boot and used to answer "what does plan X allow".
--
-- It ended up with 144 rows where 8 belong - every trial capability repeated 18
-- times, one full duplicate set per auth-service restart. The seed runs on every
-- boot, and nothing stopped it writing a set that was already there.
--
-- Why it is a real bug rather than cosmetic duplication:
--
--   1. Every boot adds another 8 rows. 56 plans' worth of rows by year one, for
--      8 capabilities.
--   2. The table is the audit evidence for "what is sold", and a table that says
--      `ads_campaigns` 18 times makes that unreadable rather than merely ugly.
--   3. Any query that joins it - the plans page's limits grid, a report, an
--      operator checking a price - returns 18 identical rows and has to remember
--      to DISTINCT, which nobody does.
--
-- It was invisible for a while because `EntitlementService.Limit` reads the plan
-- GRANTS FROM CONFIG (`config/plans.go`) and not from this table: it does
-- `plan.Grants[capability]`, so the 18th copy of a value is the same value. The
-- table was wrong and nothing broke, which is exactly how a data bug survives.
--
-- -----------------------------------------------------------------------------
-- THE FIX IS A CONSTRAINT, NOT A CLEANUP
-- -----------------------------------------------------------------------------
--
-- Deduplicating alone would leave the seed free to do it again on the next
-- restart, which is how it happened 18 times. So: delete the extras, then add
-- the unique index that makes a second copy of a (plan, capability) impossible.
--
-- The seed itself is also changed to ON CONFLICT DO NOTHING, so an existing
-- install converges rather than erroring on the new constraint.

BEGIN;

-- ---- 1. Remove the duplicates ----
--
-- Keeps the OLDEST row of each set: it carries the `updated_at` that reflects
-- when the value was first seeded, and a plan value that has silently changed 18
-- times is a story worth reading from the start.
--
-- `min(updated_at)` rather than `min(id)`: the ids are UUIDs and carry no order
-- information, so ordering by them would pick an arbitrary survivor.
DELETE FROM entitlement_grants a
USING entitlement_grants b
WHERE a.plan_code = b.plan_code
  AND a.capability = b.capability
  AND (a.updated_at, a.id::text) > (b.updated_at, b.id::text);

-- ---- 2. Make a second copy impossible ----
--
-- This is the actual fix. Without it, step 1 is a cleanup that the next restart
-- undoes.
DROP INDEX IF EXISTS uq_entitlement_grants_plan_capability;
CREATE UNIQUE INDEX uq_entitlement_grants_plan_capability
    ON entitlement_grants(plan_code, capability);

-- ---- 3. Cheap integrity check ----
--
-- The catalogue must agree with `config/plans.go`, which is what the running
-- service actually reads. A drift between the two is a quiet "what is sold"
-- mismatch, so it is reported now rather than discovered later.
--
-- Not a failure on a mismatch: this migration cannot change config, and failing
-- an install over a value that the code does not read would be worse than
-- logging it.
DO $$
DECLARE
    dupes bigint;
BEGIN
    SELECT count(*) INTO dupes
    FROM (
        SELECT plan_code, capability
        FROM entitlement_grants
        GROUP BY plan_code, capability
        HAVING count(*) > 1
    ) d;
    IF dupes > 0 THEN
        RAISE EXCEPTION 'entitlement_grants still has % duplicated (plan, capability) pairs - the unique index did not take', dupes;
    END IF;
END $$;

COMMIT;