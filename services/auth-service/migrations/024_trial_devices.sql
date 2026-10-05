-- =============================================================================
-- 024: TRIAL DEVICE REGISTRY
-- =============================================================================
--
-- WHAT THIS IS FOR
--
-- A trial is granted once per ACCOUNT, enforced by `Register` failing on a
-- duplicate email. That is one-per-EMAIL. It is not one-per-PERSON: three
-- addresses, three trials, and nothing in the code prevented it.
--
-- This table makes it one-per-BROWSER, which is the cheapest honest proxy for
-- one-per-person available without a payment provider, a verified email, or
-- device attestation.
--
-- -----------------------------------------------------------------------------
-- WHY THE KEY IS A BROWSER FINGERPRINT AND NOT AN IP
-- -----------------------------------------------------------------------------
--
-- This is the whole design, and it is worth stating because the obvious
-- alternative is actively harmful.
--
-- AN IP CAP WOULD PUNISH SHARED NETWORKS. Every person on one household
-- connection, one office, one college campus, one mobile carrier CGNAT pool
-- shares an IP. An IP cap would block the second person to register from a
-- perfectly ordinary home, which is a false positive on people doing nothing
-- wrong, and it is unfixable by them — they cannot change their IP.
--
-- A BROWSER FINGERPRINT IS PER INSTALL, NOT PER NETWORK. It is a random id the
-- client generates and keeps in `localStorage`. So:
--
--     same browser,  second email   ->  BLOCKED. One person re-registering.
--     same wifi,    different browser ->  ALLOWED. Two people, one router.
--     same family,  two computers      ->  ALLOWED.
--     bot,          many browsers      ->  NOT blocked. See the note below.
--
-- That last row is the honest limitation: clearing site data mints a new
-- fingerprint, so this stops casual re-registration, not a determined actor.
-- Nothing at this layer can stop a determined actor — only a verified payment
-- method or a real identity check can, and the product deliberately has neither.
-- The alternative to a weak control is no control.
--
-- -----------------------------------------------------------------------------
-- WHY `claimed_by` IS NOT A FOREIGN KEY
-- -----------------------------------------------------------------------------
--
-- Because the row must SURVIVE the account it describes. `users` is purged and
-- retentions apply; a device that claimed a trial and then had the account
-- deleted must still be blocked on the next attempt, or deleting an account
-- becomes a way to reset the cap.
--
-- Same reasoning as `security_alert_acknowledgements.event_id`: an audit record
-- outliving the thing it audits is correct, not a leak.

CREATE TABLE IF NOT EXISTS trial_devices (
    -- The client-generated device id. See the header for why this and not an IP.
    --
    -- 64 chars: a UUID is 36, and this leaves room for a future hashed
    -- fingerprint without a migration. Uniqueness is the entire mechanism, so it
    -- is a PRIMARY KEY rather than a unique index on something else — a cap that
    -- can be violated by a NULL is not a cap.
    device_fingerprint VARCHAR(64) PRIMARY KEY,

    -- The email that claimed the trial. NOT a foreign key — see the header.
    claimed_by VARCHAR(255) NOT NULL,

    -- When the trial was claimed. Kept for the audit answer "how long ago did
    -- this device take a trial", which is the question an operator actually has
    -- when reviewing a blocked attempt.
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- How many FURTHER attempts were refused from this device.
    --
    -- Not decoration. A device refused once is somebody's family member; a device
    -- refused nine times is an operation, and the difference is what separates an
    -- alert worth reading from noise. It is also why the blocked event is CRITICAL:
    -- the dashboard's acknowledgement flow is exactly the right place for it.
    blocked_attempts INTEGER NOT NULL DEFAULT 0,

    -- When the most recent refusal happened, so "is this still happening" is one
    -- comparison rather than a scan.
    last_blocked_at TIMESTAMPTZ
);

-- `blocked_attempts > 0` is the only query an operator runs, and it is a range
-- scan on one column. Every dashboard filter that counts or lists repeat offenders
-- needs it, and the table is small enough that the index is about the ORDER BY
-- rather than the lookup.
CREATE INDEX IF NOT EXISTS idx_trial_devices_blocked
    ON trial_devices (blocked_attempts DESC, last_blocked_at DESC NULLS LAST);

COMMENT ON TABLE trial_devices IS
    'One trial per BROWSER, not per email and not per IP. Keyed on a client-generated fingerprint in localStorage, so a shared household or office network is unaffected while one browser re-registering with a second address is blocked. Survives account deletion so purging an account is not a way to reset the cap.';
COMMENT ON COLUMN trial_devices.device_fingerprint IS
    'A random id the client keeps in localStorage. Deliberately NOT an IP: an IP cap refuses the second person on a shared connection, and they cannot fix it.';
COMMENT ON COLUMN trial_devices.blocked_attempts IS
    'Refusals from this device. One is a family member; nine is an operation. This is why a blocked attempt is recorded as a CRITICAL security event.';