-- =============================================================================
-- 018: channel creation asks what a channel actually needs
-- =============================================================================
--
-- WHY
--
-- `CreateChannelRequest` took four things: a name, a handle, a description and
-- a public flag. That is a NAME, not a channel. YouTube asks roughly ten times
-- that, and every extra question changes how the channel behaves or is found.
--
-- Two of the additions are not preferences and are worth being blunt about:
--
--   CHANNEL_TYPE  is not a label. It selects upload defaults and which features
--                 surface, so getting it wrong leaves the channel in a state
--                 nobody can categorise.
--
--   MADE_FOR_KIDS is a legal classification, separate from "mature content".
--                 YouTube's own wizard gates it hardest for exactly that reason.
--                 Collapsing the two is how a family channel gets treated as
--                 adult, or an adult channel gets treated as a family one.
--
-- The full reasoning, and what is deliberately NOT copied, is in
-- `CHANNEL-AND-MEDIA-PARITY.md` §1.
--
-- -----------------------------------------------------------------------------
-- WHY EVERY NEW COLUMN IS NULLABLE
-- -----------------------------------------------------------------------------
--
-- Channels that already exist have none of these answers, and a NOT NULL column
-- with no default would make this migration fail on a database with rows - or
-- force a backfill that INVENTS an answer nobody gave.
--
-- So they are nullable, and the service treats a null `channel_type` as
-- "unclassified" rather than guessing. Inventing a category is worse than
-- admitting we do not know: it decides upload defaults, and a wrong default
-- produces videos the creator did not ask for.
--
-- New channels WILL require these at the API level. The database stays
-- permissive; the application does not.

BEGIN;

-- ---- What kind of channel ----
-- NOT an ENUM, deliberately: adding a category should be a migration of this
-- file, not an ALTER TYPE on a live table. A CHECK is the same constraint
-- without the lock.
-- Every ALTER here is `ADD COLUMN IF NOT EXISTS` so a re-run is a no-op.
-- Before that they were bare `ADD`, which fails with
-- "column ... already exists" (SQLSTATE 42701) - and because these sit ABOVE a
-- `BEGIN`, one failure rolls the whole file back and none of the columns land.
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS channel_type VARCHAR(24);

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS mature_content VARCHAR(16);

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS made_for_kids BOOLEAN;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS country VARCHAR(2);

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS primary_language VARCHAR(16);

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS keywords TEXT;

-- Only enforced when a value IS present, so existing rows pass. The service
-- layer requires these on creation, which is where the rule belongs.
ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS chk_channel_type;
ALTER TABLE channels
  ADD CONSTRAINT chk_channel_type CHECK (
    channel_type IS NULL OR channel_type IN (
      'gaming', 'music', 'podcast', 'education', 'howto', 'sports',
      'news', 'film', 'people', 'comedy', 'autos', 'other'
    )
  );

ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS chk_mature_content;
ALTER TABLE channels
  ADD CONSTRAINT chk_mature_content CHECK (
    mature_content IS NULL OR mature_content IN ('no', 'yes', 'audience')
  );

-- ISO-3166-1 alpha-2. Two characters, upper-cased by the service.
--
-- `DATALENGTH` and `COLLATE Latin1_General_100_BIN2` dono SQL Server hain.
-- PostgreSQL ka equivalent pair hai `length()` aur `~ '^[A-Z]{2}$'`.
-- A regex is used rather than `length() = 2` alone because "12" is two
-- characters and would otherwise pass an alpha-2 check.
ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS chk_channel_country;
ALTER TABLE channels
  ADD CONSTRAINT chk_channel_country CHECK (
    country IS NULL OR country ~ '^[A-Z]{2}$'
  );

-- ---- Discovery: keywords are not the description ----
-- PostgreSQL has no `CREATE FULLTEXT CATALOG`. The portable, dependency-free
-- equivalent for a single text column is a plain trigram GIN index, which
-- gives substring search ("bak" -> "baking") - which is what a keyword search
-- is for. `pg_trgm` ships with PostgreSQL itself, so there is nothing to
-- install and nothing to pay for.
--
-- If the extension is unavailable (a hardened build without contrib) the
-- search degrades to the LIKE path the handler already uses, so keyword
-- search must be written to survive its absence. That is a DO block rather
-- than a bare statement for exactly that reason.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm unavailable - keyword search falls back to LIKE';
END $$;

-- Deliberately NOT over the description: a keyword search that also matched
-- prose would return a cooking channel for "baking tips", which is a worse
-- failure than not finding it.
CREATE INDEX IF NOT EXISTS idx_channels_keywords_trgm
  ON channels USING gin (keywords gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Public listing filters on type, so it is a plain btree.
CREATE INDEX IF NOT EXISTS idx_channels_type
  ON channels (channel_type)
  WHERE deleted_at IS NULL;

-- PostgreSQL stores column descriptions with COMMENT ON COLUMN. A bare
-- COMMENT is idempotent - a second run updates the text, which is the intent.
COMMENT ON COLUMN channels.channel_type IS
  'Category selected at creation. Drives upload defaults and which features surface. NULL means unclassified - an existing channel that predates this - and is NOT guessed, because a wrong category picks the wrong upload defaults.';

COMMENT ON COLUMN channels.made_for_kids IS
  'A LEGAL classification, separate from mature_content. Setting or clearing it is audited, because it changes what the platform is required to do with a channel''s content.';

COMMENT ON COLUMN channels.contact_email IS
  'Private contact for the creator. Never exposed on the public channel payload.';

COMMENT ON COLUMN channels.country IS
  'ISO-3166-1 alpha-2. Decides which regional programmes and rules apply, so it is public and must be honest.';

COMMIT;