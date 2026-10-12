-- 031: the public browse view respects moderation_status
--
-- `channel_content_counts` powers the browse page's channel cards: the video and
-- reel counts, and the newest thumbnail. It filtered on `status = 'ready'` alone,
-- which after migration 030 is no longer sufficient for anything PUBLIC - and it
-- had two consequences that were both wrong:
--
--	1. the COUNTS included assets still awaiting review, so a card could say
--	   "12 videos" and the channel page behind it would show fewer
--
--	2. `latest_thumbnail` took the newest poster among `ready` assets, so the
--	   thumbnail on the browse card could be the poster of a REJECTED video - a
--	   picture the AI refused, displayed on the platform's front page as the
--	   face of that channel
--
-- The second is the serious one. It is a publish surface that nobody thought of
-- as one, which is exactly the kind of thing a moderation system has to find.
--
-- THE RULE, for the third time and now in SQL as well as Go:
--
--	status = 'ready' AND moderation_status = 'approved'
--
-- `CREATE OR REPLACE VIEW` is used rather than a DROP + CREATE because the view
-- may be depended on by other objects and the replacement is the same set of
-- columns - a plain replace preserves the contract.

CREATE OR REPLACE VIEW channel_content_counts AS
SELECT c.id AS channel_id,
       COALESCE(a.video_count, 0::bigint) AS video_count,
       COALESCE(a.reel_count, 0::bigint) AS reel_count,
       a.latest_upload_at,
       a.latest_thumbnail
FROM channels c
  LEFT JOIN (
    SELECT media_assets.channel_id,
           count(*) FILTER (WHERE media_assets.kind::text <> 'reel'::text) AS video_count,
           count(*) FILTER (WHERE media_assets.kind::text = 'reel'::text) AS reel_count,
           max(media_assets.created_at) AS latest_upload_at,
           -- The newest poster among PUBLIC assets only. The FILTER is what keeps
           -- a rejected video's frame off the browse card.
           (array_agg(media_assets.poster_public_url ORDER BY media_assets.created_at DESC)
              FILTER (WHERE media_assets.poster_public_url IS NOT NULL))[1] AS latest_thumbnail
    FROM media_assets
    WHERE media_assets.channel_id IS NOT NULL
      AND media_assets.status::text = 'ready'::text
      -- Migration 030's rule, applied here because this view is public.
      AND media_assets.moderation_status::text = 'approved'::text
    GROUP BY media_assets.channel_id
  ) a ON a.channel_id = c.id;
