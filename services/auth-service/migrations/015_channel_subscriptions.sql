-- =============================================================================
-- 015: channel subscriptions, and a DERIVED subscriber count
-- =============================================================================
--
-- WHY THIS TABLE IS NEW
--
-- There is a `SubscriberCount` column somewhere in this codebase that gets
-- `++`'d. It is not this table's job to replace it directly, but it is why this
-- one exists:
--
--     profile.SubscriberCount++
--     return s.profileRepo.Update(ctx, profile)
--
-- Four problems with a counter that works that way, in order of severity:
--
--   1. LOST UPDATE. Read-modify-write with no transaction and no row lock. Two
--      concurrent subscribes both read N, both write N+1, and one increment
--      vanishes with no error anywhere.
--   2. IT ONLY GOES UP. No unsubscribe path exists, so it cannot be correct even
--      in principle.
--   3. NOTHING TO RECONCILE AGAINST. With no subscriptions table there is no way
--      to check whether the number is right - so drift is invisible and
--      permanent.
--   4. WRONG SCOPE. It hangs off a USER profile. A subscriber count is a
--      property of a CHANNEL.
--
-- The fix is not a better counter. It is no counter: the count is computed from
-- this table, so it cannot drift. See the view at the bottom.
--
-- -----------------------------------------------------------------------------
-- WHY ONE ROW PER (channel, user), NOT AN EVENT LOG
-- -----------------------------------------------------------------------------
--
-- This is a STATE, not a movement. A subscription is active or it is not, and
-- the current answer is the one that matters. Money movements - a paid
-- subscription's charges, refunds, reversals - are a different table with a
-- different lifetime, and conflating them here would make both harder to reason
-- about.
--
-- So re-subscribing after cancelling REACTIVATES the row rather than inserting a
-- second one. `first_subscribed_at` is never overwritten, so "when did they
-- first subscribe" survives a cancel/re-subscribe cycle - which is a real
-- creator-facing number ("you have had a subscriber for 2 years").

BEGIN;

-- ---------------------------------------------------------------------------
-- THE DROPS THIS FILE USED TO START WITH, AND WHY THEY ARE GONE
-- ---------------------------------------------------------------------------
--
--     DROP VIEW   IF EXISTS channel_subscriber_counts;
--     DROP TABLE  IF EXISTS channel_subscriptions;
--     DROP INDEX  IF EXISTS idx_channel_subs_user;
--     DROP INDEX  IF EXISTS idx_channel_subs_count;
--
-- `DROP TABLE IF EXISTS` is not idempotency, it is deletion.
--
-- On an empty database it looks fine. On any database with real subscribers -
-- which is every live deployment - applying this file deletes every subscription
-- row there is, and then recreates an empty table. The result is a migration that
-- always succeeds and always costs you the data.
--
-- `CREATE TABLE IF NOT EXISTS` is the actual answer to "this may already exist",
-- and it is safe in both directions: it creates on a fresh database and does
-- nothing on an existing one.
--
-- The view is dropped deliberately and only because it is derived: it reads
-- `channel_subscriptions`, and Postgres will refuse to alter a table any view
-- depends on. It is recreated at the end of this file.
DROP VIEW IF EXISTS channel_subscriber_counts;

CREATE TABLE IF NOT EXISTS channel_subscriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- CASCADE in both directions is deliberate and load-bearing:
    --   channel deleted -> subscriptions to it are meaningless, not "orphaned"
    --   user deleted    -> their subscription is meaningless, not "orphaned"
    -- Hand-managing either would mean a cleanup job whose only job is to notice
    -- deletions, i.e. a counter that is wrong until the job runs.
    channel_id          UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 'free' | 'paid'. Both are subscriptions; the difference matters for a
    -- creator's revenue view and for Phase 6's paid tier, and it is captured
    -- here because by the time anyone asks "how many paying subscribers does
    -- this channel have", the free ones have to be distinguishable.
    tier                TEXT NOT NULL DEFAULT 'free',

    -- 'active' | 'cancelled'. Deliberately NOT 'expired': expiry is derived from
    -- ends_at, so a row that lapses by time must not need a job to write to it.
    -- A status that a scheduler maintains is a status that will eventually be
    -- wrong.
    status              TEXT NOT NULL DEFAULT 'active',

    -- Never overwritten, including across cancel/re-subscribe.
    first_subscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- NULL means indefinite. A paid subscription sets it when it lapses.
    --
    -- The derived count treats NULL as "active forever", so this is what makes
    -- a free subscription free: no timer, no renewal, nothing to fail.
    ends_at             TIMESTAMPTZ,

    cancelled_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One subscription per user per channel. This is what makes "subscribe"
    -- idempotent rather than an INSERT that fails with a constraint error the
    -- caller has to translate.
    CONSTRAINT uq_channel_subscription UNIQUE (channel_id, user_id),

    CONSTRAINT chk_tier   CHECK (tier   IN ('free', 'paid')),
    CONSTRAINT chk_status CHECK (status IN ('active', 'cancelled'))
);

COMMENT ON TABLE channel_subscriptions IS
  'One row per (channel, user). CASCADE in both directions on purpose: a subscription to a deleted channel or a deleted user is meaningless rather than orphaned, and hand-managing either would mean a cleanup job whose only job is to notice deletions.';

COMMENT ON COLUMN channel_subscriptions.first_subscribed_at IS
  'Never overwritten, including across a cancel and re-subscribe, so "you have had this subscriber for 2 years" survives the cycle. That is a real creator-facing number and it is only answerable if this column is immutable.';

COMMENT ON COLUMN channel_subscriptions.ends_at IS
  'NULL means indefinite, which is what makes a free subscription free: no timer, no renewal, nothing to fail. Expiry is DERIVED from this column in channel_subscriber_counts rather than stored, so a lapsed subscription drops out of the count with no job to run.';

-- The lookup that actually runs: "is this user subscribed to this channel?"
CREATE INDEX IF NOT EXISTS idx_channel_subs_user
    ON channel_subscriptions (user_id, status);

-- And the aggregate: "how many does this channel have?" Ordering by
-- (channel_id, status) lets the count be served straight from the index.
CREATE INDEX IF NOT EXISTS idx_channel_subs_count
    ON channel_subscriptions (channel_id, status);

-- ---------------------------------------------------------------------------
-- The derived view
-- ---------------------------------------------------------------------------
--
-- `subscriber_count` is a VIEW, not a column. Nothing increments it, so it
-- cannot drift.
--
-- A view rather than a bare query because the definition of "subscribed" -
-- active, and not lapsed - is then written down ONCE. A query re-typed in a
-- handler, a dashboard and an export is three chances for them to disagree, and
-- a subscriber count that disagrees with itself depending on where you read it
-- is worse than one that is slightly slow.
--
-- `ends_at IS NULL OR ends_at > now()` is the whole reason expiry is derived:
-- a lapsed PAID subscription drops out of the count on its own, with no job and
-- no state to fall out of sync.

-- Bare `GO` do jagah tha. `GO` ek SQL Server / SSMS batch separator hai -
-- PostgreSQL aur psql dono ise syntax error maante hain (`syntax error at or
-- near "GO"`). SSMS me ye chhota editor ki galti chup-chaap chup jaati thi;
-- psql -f par ye poora file fail karta tha, aur file ke END tak ka koi bhi
-- statement apply nahi hota tha.
--
-- `CREATE OR REPLACE VIEW` pehle se idempotent hai, isliye koi guard chahiye
-- hi nahi.
CREATE OR REPLACE VIEW channel_subscriber_counts AS
SELECT
    channel_id,
    CAST(COUNT(*) AS BIGINT) AS subscriber_count,
    CAST(SUM(CASE WHEN tier = 'paid' THEN 1 ELSE 0 END) AS BIGINT) AS paid_subscriber_count,
    CAST(SUM(CASE WHEN tier = 'free' THEN 1 ELSE 0 END) AS BIGINT) AS free_subscriber_count,
    -- Useful for a creator dashboard, and free to carry here.
    MIN(first_subscribed_at) AS oldest_subscription_at
FROM channel_subscriptions
WHERE status = 'active'
    AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP)
GROUP BY channel_id;

-- View documentation: derived subscriber counts; expiry comes from ends_at.
COMMENT ON VIEW channel_subscriber_counts IS
  'Derived subscriber counts. Never incremented anywhere - this view is the only '
  'source, so the count cannot drift from the rows it summarises.';

-- Table documentation: one row per (channel, user), authoritative for subscriber counts.
COMMENT ON TABLE channel_subscriptions IS
  'One row per (channel, user). Authoritative for who is subscribed; the COUNT is '
  'derived in channel_subscriber_counts rather than stored.';

COMMIT;
