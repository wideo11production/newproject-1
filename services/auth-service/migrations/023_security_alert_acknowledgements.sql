-- =============================================================================
-- 023: SECURITY ALERT ACKNOWLEDGEMENTS
-- =============================================================================
--
-- WHAT THIS IS FOR
--
-- The superadmin dashboard shows a red banner whenever there are CRITICAL security
-- events. It had no dismissal and no record: the same three lockouts shouted at
-- every operator on every page load, forever, with no way to say "we have seen
-- this" and no way for a colleague to know that somebody else already had.
--
-- Two things were wrong with that, and they are opposites:
--
--   1. FATIGUE. A permanent alarm trains people to ignore alarms. That is the
--      failure mode every un-acknowledgeable alert eventually reaches.
--   2. NO ATTRIBUTION. "Somebody noticed" and "nobody noticed" look identical on
--      screen. For an incident review the second question is the one that matters.
--
-- WHAT THIS TABLE IS, AND WHAT IT IS NOT
--
-- It records that a HUMAN SAW AN EVENT. It does not resolve it, close it, or
-- change `security_events` in any way. The event row is untouched and the event
-- stays in the security timeline forever.
--
-- That distinction is the whole design:
--
--   ACKNOWLEDGED  "a person has looked at this"
--   RESOLVED      "the underlying condition has been dealt with"
--
-- Conflating them is how a real incident gets closed by clicking a button. So
-- acknowledging suppresses the BANNER and nothing else - the event still appears
-- in the Security Events panel, still counts in the totals, and is still
-- queryable.
--
-- WHY THIS IS A TABLE AND NOT localStorage
--
-- localStorage would be per-browser. Three operators, three banners, and no
-- shared picture. The question "has anyone looked at this?" has to have one
-- answer, and the answer has to survive the browser being closed, cleared, or
-- being somebody else's browser.
--
-- WHY `event_id` IS A UNIQUE CONSTRAINT
--
-- Acknowledging twice is a no-op with a clear error rather than a second row.
-- Two rows for one event would make the count of "how many alerts were
-- acknowledged" disagree with the number of events that were.
--
-- `acknowledged_by` is an email, not a user id. Deliberate: `superadmin_accounts`
-- holds master-root and recovery identities, and a token's `user_id` is a UUID in
-- a different id space (billing-service models users as `uint` — see
-- `services/billing-service/src/handler/identity.go`). An email is what an
-- incident reviewer actually reads, and it cannot silently fail to resolve.

CREATE TABLE IF NOT EXISTS security_alert_acknowledgements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The event that was acknowledged. No FK: `security_events` is an append-only
    -- audit log, and an acknowledgement outliving the event it refers to is
    -- correct — the fact that it was seen matters even if the event is later
    -- purged by the retention sweeper.
    event_id        UUID NOT NULL,

    -- Who saw it. Email rather than a user id; see the note above.
    acknowledged_by VARCHAR(255) NOT NULL,

    -- An operator-supplied note. Optional, but this is where "looked at it, false
    -- positive, IP is the office router" goes — otherwise that knowledge lives in
    -- someone's head and is lost when they rotate off.
    -- Capped at 1000 to match `security_events.detail`, which is the field an
    -- operator will be reading alongside it.
    note            VARCHAR(1000) NOT NULL DEFAULT '',

    -- When they saw it. `timestamptz`, because an incident review spanning a
    -- timezone boundary is normal and a naive local timestamp makes it ambiguous.
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- WHERE they saw it from. Same reasoning as `security_events.ip_address`, and
    -- it is the difference between "noticed" and "noticed from the office".
    ip_address      VARCHAR(64) NOT NULL DEFAULT '',

    -- One acknowledgement per event.
    CONSTRAINT uq_security_alert_ack UNIQUE (event_id)
);

-- The lookup is always "has THIS event been acknowledged", so event_id is the
-- index that matters. It is already the unique constraint's backing index, so a
-- second one would be duplicate work.
--
-- `acknowledged_by` gets an index because the other question that gets asked is
-- "what has Rajan looked at this week", which is an accountability query and the
-- whole reason this table exists.
CREATE INDEX IF NOT EXISTS idx_security_alert_ack_by
    ON security_alert_acknowledgements (acknowledged_by, acknowledged_at DESC);

COMMENT ON TABLE security_alert_acknowledgements IS
    'Records that a human operator saw a critical security event. NOT a resolution: the event row is untouched and remains in the timeline. Suppresses the dashboard banner only.';
COMMENT ON COLUMN security_alert_acknowledgements.event_id IS
    'The security_events.id that was seen. Intentionally not a foreign key - an acknowledgement outliving a retention purge is correct.';
COMMENT ON COLUMN security_alert_acknowledgements.note IS
    'Operator note. Where "false positive, that IP is the office router" belongs, or that knowledge is lost when they rotate off.';
