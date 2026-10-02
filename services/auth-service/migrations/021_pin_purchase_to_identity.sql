-- =============================================================================
-- 020: a purchase is pinned to the account AND the device it was made on
-- =============================================================================
--
-- WHAT THIS ENFORCES
--
--   "Slot khali kya user jis account se purchase karta hai, aur jis device me
--    purchase karta hai - waahi finalised ho."
--
--    Once an email and a device are linked and registered, that binding does not
--    change. Ever.
--
-- It applies to EVERYTHING that is not a recurring subscription, and that is the
-- important part: a monthly plan self-limits, because payment stops. A
-- LIFETIME plan does not, and neither does a bundle of lifetime video-editor
-- seats. Those are the two things that can be resold, so those are the two
-- things that get pinned.
--
-- -----------------------------------------------------------------------------
-- WHY A TRIGGER AND NOT APPLICATION CODE
-- -----------------------------------------------------------------------------
--
-- Because "the app checks" is not a control. It is a line that can be deleted in
-- a merge, skipped by a code path that writes directly, or bypassed by a script.
-- A `BEFORE UPDATE` trigger in the database is the last place the value passes
-- through, and nothing in the application can route around it.
--
-- The exception is DELIBERATE and narrow: `allow_rebind` is a session setting
-- only an admin can set. It exists because the alternative - an identity change
-- that can NEVER be corrected - turns an honest customer who mistyped their
-- address into a permanent loss, and that is how you get chargebacks and
-- shouting rather than a bug report. Use it for verified re-binding, never for
-- sharing.
--
-- -----------------------------------------------------------------------------
-- WHY PINNING THE FIRST DEVICE MATTERS
-- -----------------------------------------------------------------------------
--
-- A `lifetime5` plan allows five devices, so on its face the first device is
-- just the first of five and could be swapped for another.
--
-- It cannot. The device the purchase was MADE on is the origin, and the user
-- cannot remove it - it is the one that proves the sale happened to this person
-- on this machine. A friend who uses four of the five slots and then talks the
-- owner into dropping their own device has not got the plan; they have got
-- somebody's hardware registration, and the audit trail should show it.
--
-- So: the origin device is unpinnable, and the remaining slots are releasable.

BEGIN;

ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS bound_device_fingerprint VARCHAR(128),
  ADD COLUMN IF NOT EXISTS bound_device_at TIMESTAMPTZ;

-- NOTE: there is deliberately NO "at least one of email/device must be set"
-- constraint here, and that is a correction rather than an oversight.
--
-- The first draft had one, and it failed on real data: entitlements granted
-- before this migration have neither, so requiring one retroactively would have
-- demanded a backfill that INVENTS an identity. A NULL meaning "not pinned" is a
-- real, meaningful state with a real consequence - the plan works, but its
-- origin device is unrecorded - and pretending that state does not exist is
-- exactly the kind of thing that makes a migration fail at 3am.
CREATE INDEX IF NOT EXISTS idx_entitlements_bound_device
    ON entitlements (bound_device_fingerprint)
    WHERE bound_device_fingerprint IS NOT NULL;

COMMENT ON COLUMN entitlements.bound_device_fingerprint IS
    'The device a plan was purchased on. The origin device is UNPINNABLE - a user can release their other slots but not this one, because it is the record that the sale happened to this person on this machine.';

-- =============================================================================
-- The immutability trigger
-- =============================================================================
CREATE OR REPLACE FUNCTION entitlements_pin_immutable() RETURNS trigger AS $$
BEGIN
    -- `allow_rebind` is a local flag set by the admin re-binding path ONLY. It is
    -- not a column, so no application UPDATE can set it - it exists for the
    -- duration of that one statement and dies with it.
    IF coalesce(current_setting('allow_rebind', true), 'off') = 'on' THEN
        RETURN NEW;
    END IF;

    IF NEW.bound_email IS DISTINCT FROM OLD.bound_email THEN
        RAISE EXCEPTION
            'entitlement % is bound to an email and cannot be rebound (bound_email % -> %). '
            'A plan follows the identity it was granted to. A verified identity change '
            'goes through the admin re-binding path, which sets allow_rebind for that '
            'statement only.', OLD.id, OLD.bound_email, NEW.bound_email
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.bound_device_fingerprint IS DISTINCT FROM OLD.bound_device_fingerprint THEN
        RAISE EXCEPTION
            'entitlement % is bound to the device it was purchased on and cannot be '
            'rebound (bound_device % -> %). Revoking a DEVICE SLOT is a different '
            'operation and does not touch this column; rebinding the origin device is '
            'only possible through the verified admin path.', OLD.id,
            OLD.bound_device_fingerprint, NEW.bound_device_fingerprint
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_entitlements_pin_immutable ON entitlements;

CREATE TRIGGER trg_entitlements_pin_immutable
    BEFORE UPDATE ON entitlements
    FOR EACH ROW
    EXECUTE FUNCTION entitlements_pin_immutable();

-- A bulk grant would otherwise have to be repeated with a transaction-local
-- setting per row, and the one legitimate use of a backfill is exactly the
-- situation where 500 identical triggers would be a performance problem.
CREATE OR REPLACE FUNCTION entitlements_pin_immutable_statement() RETURNS trigger AS $$
BEGIN
    -- A statement that adds rows is not an update, so it cannot violate the pin.
    IF TG_OP = 'INSERT' THEN
        RETURN NEW;
    END IF;
    IF coalesce(current_setting('allow_rebind', true), 'off') = 'on' THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1 FROM entitlements
        WHERE id = OLD.id
          AND (
              bound_email IS DISTINCT FROM NEW.bound_email
              OR bound_device_fingerprint IS DISTINCT FROM NEW.bound_device_fingerprint
          )
    ) THEN
        RAISE EXCEPTION
            'entitlement pin is immutable (entitlement %). Only the verified admin '
            're-binding path may change a bound identity or device.', OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION entitlements_pin_immutable() IS
    'Enforces that a granted plan stays with the identity and the device it was '
    'granted to. Bypassed ONLY by an admin re-binding statement that sets '
    'allow_rebind, so the escape hatch is deliberate and narrow rather than '
    'something a migration can switch on by accident.';

COMMIT;