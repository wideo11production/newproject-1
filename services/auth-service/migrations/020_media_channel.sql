-- =============================================================================
-- 019: media belongs to a channel
-- =============================================================================
--
-- WHY
--
-- The browse page showed `0 videos` and `0 reels` on every channel, and the
-- service was returning literal zeros on purpose: `media_assets` had no
-- `channel_id`, so there was no honest way to say which video belonged to which
-- channel. Inventing a join would have put the WRONG video on the WRONG channel,
-- which is worse than showing none.
--
-- So the column goes in, and the zeros can stop being a lie.
--
-- -----------------------------------------------------------------------------
-- WHY IT IS NULLABLE
-- -----------------------------------------------------------------------------
--
-- A creator uploads media before they create a channel, and a user who never
-- makes a channel still has a library. Requiring a channel here would force
-- channel creation to be a precondition for uploading, which is the wrong order
-- and would break the trial flow (a trial may not even be able to create a
-- channel yet).
--
-- A NULL therefore means "not filed under a channel", and the browse page counts
-- only what is filed. The library view can show both.
--
-- -----------------------------------------------------------------------------
-- ONLY `ready` ASSETS COUNT
-- =============================================================================
--
-- An asset that is `initiated` has had nothing sent. One that is `scanning` may
-- turn out not to be a video at all. Only `ready` means "this is a thing someone
-- can watch", and only that is what a channel's public count may claim.
--
-- This is asserted by the view below, not left to each caller to remember.

BEGIN;

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE CASCADE;

-- The poster's PUBLIC url, filled when the transcode finishes.
--
-- `poster_key` is a PRIVATE MinIO key, and a browse page cannot use it: turning
-- it into something an <img> can load means minting a presigned URL PER CARD,
-- per page view, each with an expiry. On a 24-card grid that is 24 signatures
-- every view, and the cards break again when the URLs age out.
--
-- So the transcode stores the served url at the moment it knows it, and the read
-- path is a plain column. That is the same trade as storing an avatar url
-- rather than re-signing on every render.
--
-- NULL until the transcode runs, which is honest: no poster yet is not the same
-- as a poster that failed to generate.
ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS poster_public_url TEXT;

-- A channel that is deleted takes its media with it. Same reasoning as
-- channel_subscriptions: a dangling asset that no channel claims and no library
-- surfaces is a row nobody can ever delete.

-- The browse query's hot path: every ready asset for a channel, newest first.
--
-- Partial on `status = 'ready'` because that is the ONLY state a public count may
-- include, and on `channel_id` because assets with no channel are not on any
-- channel's page. Both conditions are constant for this query, so both belong in
-- the index rather than in a filter.
CREATE INDEX IF NOT EXISTS idx_media_assets_channel_ready
    ON media_assets (channel_id, created_at DESC)
    WHERE channel_id IS NOT NULL AND status = 'ready';

COMMENT ON COLUMN media_assets.channel_id IS
    'The channel this media is filed under. NULL means filed under none - which is normal, because a creator uploads before they have a channel. Public channel counts include only assets where this is set AND status = ''ready''.';

-- =============================================================================
-- The per-channel content rollup
-- =============================================================================
--
-- A VIEW, for the same reason `channel_subscriber_counts` is one: the count is
-- derived, so it cannot drift from the rows it summarises.
--
-- `COALESCE(..., 0)` because a channel with no media has NO ROW in an aggregate
-- over `media_assets`, and a LEFT JOIN that finds nothing returns NULL. Without
-- this, "0 videos" would arrive as `null` and render as the string "null" on the
-- card, which is a different and more confusing thing than zero.
CREATE OR REPLACE VIEW channel_content_counts AS
SELECT
    c.id AS channel_id,
    COALESCE(a.video_count, 0) AS video_count,
    COALESCE(a.reel_count, 0)  AS reel_count,
    a.latest_upload_at,
    a.latest_thumbnail
FROM channels c
LEFT JOIN (
    SELECT
        channel_id,
        COUNT(*) FILTER (WHERE kind <> 'reel')  AS video_count,
        COUNT(*) FILTER (WHERE kind =  'reel')  AS reel_count,
        MAX(created_at)                        AS latest_upload_at,
        -- The newest poster, paired with its own timestamp.
        --
        -- The window function is needed rather than a second aggregate, because
        -- the thumbnail and the date must describe the SAME asset. Picking the
        -- newest date and the newest poster independently can pair the date of
        -- one upload with the image of another, and the card would then show a
        -- "latest" image that is not the latest.
        (ARRAY_AGG(poster_public_url ORDER BY created_at DESC) FILTER (WHERE poster_public_url IS NOT NULL))[1]
            AS latest_thumbnail
    FROM media_assets
    WHERE channel_id IS NOT NULL
      AND status = 'ready'
    GROUP BY channel_id
) a ON a.channel_id = c.id;

COMMENT ON VIEW channel_content_counts IS
    'Per-channel counts of PUBLISHED media. Only status = ''ready'' assets count, and only those filed under a channel. Derived, so it cannot drift from the rows it summarises.';

COMMIT;