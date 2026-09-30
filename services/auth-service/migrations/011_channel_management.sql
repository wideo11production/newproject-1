-- ============================================================================
-- 011_channel_management.sql   (PostgreSQL)
-- ============================================================================
-- PURPOSE: channel management ko "create + list" se aage badhana.
--
-- Ye 5 cheezein add karta hai:
--   1. channels.cover_url         - wide banner (image_url se alag)
--   2. ch_cover_url_len           - length guard
--   3. idx_channels_public_handle - public handle lookup ka partial index
--   4. description NOT NULL       - NULL aur "" ka fark hatao
--   5. trg_channels_updated_at    - updated_at auto-maintain
--
-- ---- WHY cover_url ALAG column hai (image_url reuse nahi kiya) ----
--   image_url = channel ka square avatar (profile picture style)
--   cover_url = channel ka wide banner (header style)
-- Ek hi column me daalne par ek set karte waqt doosra delete ho jayega.
-- NULL = cover nahi lagaya; UI gradient placeholder dikhaye.
--
-- ---- APPLY KAISE ----
--     psql -v ON_ERROR_STOP=1 -U postgres -d auth_service -f 011_channel_management.sql
--
-- `ON_ERROR_STOP=1` zaroori hai: `psql` default me SQL error par aage badh
-- jaata hai aur exit code 0 deta hai. Bina iske ek failed step ke baad baaki
-- steps bhi chalti hain, aur aapko "sab apply ho gaya" lagta hai jabki nahi
-- hua. Ye migration apne aap me transaction-wrapped hai, par `psql -f`
-- transaction ke andar fail hone par usko apna hi COMMIT bhi maar deta hai -
-- isliye ON_ERROR_STOP hi asli safety net hai.
--
-- ---- RE-RUN SAFE KYUN ----
-- Ye repo me migrations `psql -f` se manually chalti hain (koi runner nahi),
-- isliye dobara chalaana routine hai. Har step apna kaam karne ke baad kisi
-- bhi state me "pehle se theek hai" par apna kaam KARTA HAI ya nahi - nahi
-- karta. Step 3 ismein sabse zaroori hai: bina us guard ke har re-run par
-- index poora girta aur dobara banta hai (live verify kiya gaya - index OID
-- 47180 se 47653 badal gaya). Us dauraan `/@handle` ke saare public channel
-- queries sequential scan par gir jaate, kyunki index maujood hi nahi hota.
-- Guard ke saath sahi index ho to uspar haath nahi lagta.
--
-- ---- LOCKING ----
-- Ye file transaction ke andar hai, isliye `CREATE INDEX CONCURRENTLY` (jo
-- production me bina write-lock diye index banata hai) yahan use nahi ho
-- sakta - PostgreSQL use transaction block me naam hi nahi deta.
--
-- Ye theek hai, kyunki:
--   - `cover_url` nullable TEXT hai, bina DEFAULT ke. Column add karna
--     catalog-only hota hai, table scan nahi.
--   - `SET NOT NULL` sirf ek baar mehnga hai (ek full scan + ek validation).
--     Uske baad koi row NULL nahi hoti, isliye UPDATE zero rows match karta
--     hai aur SET NOT NULL catalog update ban jata hai.
--   - Index Step 3 ke guard se zyada din nahi banega.
--
-- Channels table production me badi ho to index Step ko ye form chalana ho:
--     BEGIN;  <-- is file ka transaction BINA
--       DROP INDEX CONCURRENTLY IF EXISTS idx_channels_public_handle;
--       CREATE INDEX CONCURRENTLY idx_channels_public_handle ON channels (handle)
--         WHERE is_public AND is_active AND deleted_at IS NULL;
--     COMMIT;
-- jismein Step 3 ka DO block hatana padega. Trade-off: CONCURRENTLY failed
-- hone par INVALID index chhod deta hai, use `REINDEX` karna padta hai - jo
-- dobara full lock leta hai. Isi liye chhoti/medium table ke liye
-- transaction-wrapped form hi rakha gaya hai.
--
-- Hinglish comments: har step ka arth
-- ============================================================================

BEGIN;

-- ---- Step 1: cover_url ----
-- `IF NOT EXISTS` isliye: `channels` table GORM ke `AutoMigrate` se banti hai
-- aur `Channel.CoverURL` us model me hai, isliye column pehle se maujood ho
-- sakta hai. Bina guard ke ye statement SQLSTATE 42701 ("column already
-- exists") se fail hoti thi.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'channels'
      AND column_name = 'cover_url'
  ) THEN
    ALTER TABLE channels ADD cover_url TEXT;
  END IF;
END
$$;

-- ---- Step 2: length guard ----
-- Bina iske koi 5MB ka string daal sakta hai aur har list response bhaari ho
-- jayega. Avatar par 500-char limit hai, cover ke liye bhi same.
--
-- DROP-then-ADD: `ADD CONSTRAINT` me `IF NOT EXISTS` nahi hota, aur
-- constraint ka definition badalna ho to use pehle drop karna hi padta hai.
-- CHECK constraint add karna table ko scan karta hai, par sirf ek baar -
-- ye nullable column hai aur backfill kiye hue rows pehle se pass hain.
ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS ch_cover_url_len;

ALTER TABLE channels
  ADD CONSTRAINT ch_cover_url_len
  CHECK (cover_url IS NULL OR char_length(cover_url) <= 500);

-- ---- Step 3: public handle lookup index ----
-- Public channel page handle se lookup karti hai (/@aarav).
--
-- SECURITY: ye PARTIAL index hai - sirf public + active + non-deleted rows.
-- Private channels index me kabhi nahi aate, isliye unka existence bhi query
-- plan se leak nahi hota.
--
-- NOTE: `is_public` / `is_active` BOOLEAN hain. PostgreSQL me boolean ko
-- integer se compare karna INVALID hai:
--     ERROR: operator does not exist: boolean = integer
-- Isiliye shorthand predicate likha gaya hai. Ye `= 1` wala version pehle
-- isi file me tha jabki comment me "fix ho chuka hai" likha tha - comment
-- sahi tha, statement nahi. `TestMigrationChainReplays` ne usi mismatch ko
-- fresh database par pakda.
--
-- Soft delete `deleted_at IS NULL` se hota hai - `channels` me `is_deleted`
-- column NAHI hai (migration 005/009 ka documented pattern).
--
-- ---- WHY THIS STEP HAS A DO BLOCK ----
-- Baaki steps `IF [NOT] EXISTS` se kaam ho jaate hain. Yahan nahi ho sakta,
-- kyunki `CREATE INDEX` me `IF NOT EXISTS` sirf NAAM dekhta hai, PREDICATE
-- nahi. Galat predicate wala index "maujood" lagta hai, `IF NOT EXISTS`
-- use chhod dega, aur galat index zinda rahega - chupke se, bina kisi error
-- ke. Isliye existing index ka predicate padh kar TEXT se compare karna
-- padta hai. Ye wahi class ka problem hai jisne fresh DB par `= 1` wala
-- predicate chhuna diya tha: file kehti rahi "sab theek", database kehta
-- raha "nahi".
--
-- `pg_get_expr` PostgreSQL ka apna deparser hai, isliye ye text machine-
-- generated aur deterministic hai - hand-written string se compare karna
-- fragile hota, ye nahi.
DO $$
DECLARE
  current_pred text;
BEGIN
  SELECT pg_get_expr(i.indpred, i.indrelid)
    INTO current_pred
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
   WHERE c.relname = 'idx_channels_public_handle'
     AND c.relnamespace = 'public'::regnamespace;

  -- Index sahi predicate ke saath maujood hai: HAATH NAHI LAGANA.
  -- Ye branch hi poora production fix hai. Bina iske har `psql -f` par
  -- index drop + rebuild hota hai.
  IF current_pred = '(is_public AND is_active AND (deleted_at IS NULL))' THEN
    RETURN;
  END IF;

  -- Galat predicate, ya index nahi - ab banao.
  DROP INDEX IF EXISTS idx_channels_public_handle;

  CREATE INDEX idx_channels_public_handle
    ON channels (handle)
    WHERE is_public
      AND is_active
      AND deleted_at IS NULL;
END;
$$;

-- ---- Step 4: description DEFAULT '' + NOT NULL ----
-- Application layer hamesha "" store karti thi par column NULL allow karta
-- tha. Dono representations ek jaisa karne se frontend ko null aur "" dono
-- handle karne ki zaroorat nahi - ek jagah crash hota hai
-- (TypeError: Cannot read properties of null).
--
-- Pehle NULL hatate hain, warna SET NOT NULL fail hoga (005 ke time ke
-- channels ke NULL description ho sakte hain).
--
-- RE-RUN par: `WHERE description IS NULL` zero rows match karta hai (NOT NULL
-- lag chuka hai), isliye UPDATE kuch nahi chhedta. `SET DEFAULT` aur
-- `SET NOT NULL` dono already-applied state par catalog-only updates hain -
-- dobara table scan nahi hota. Ye step khud guarded hai, DO block ki zaroorat
-- nahi.
UPDATE channels
SET description = ''
WHERE description IS NULL;

ALTER TABLE channels
  ALTER COLUMN description SET DEFAULT '';

ALTER TABLE channels
  ALTER COLUMN description SET NOT NULL;

-- ---- Step 5: updated_at auto-maintain ----
-- Trigger ke bina UPDATE par ye stale rehta hai aur "last modified" galat
-- dikhta hai.
--
-- `CREATE OR REPLACE` (na ki `CREATE`) zaroori hai: ye function
-- `users` table ke trigger ke saath SHARED hai. `CREATE` karta to error
-- aata ("function already exists"), aur `DROP` + `CREATE` karte to users
-- wala trigger us window me TOOT jaata - kyunki drop ke saath function ke
-- saath uske dependents bhi invalid ho jaate hain. `CREATE OR REPLACE`
-- function ka OID preserve karta hai, isliye dono triggers zinda rehte hain.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger phir se bana rahe hain, taaki definition badalne par naya trigger
-- pakda jaaye. Ye ek DDL statement hai - readers par effect nahi, writers ko
-- ek chhoti si lock lagti hai. Trigger body hamesha latest function se
-- chalti hai, isiliye valid definition ko zinda rakhne ke liye ye zaroori
-- nahi - par definition kabhi badalti hi nahi, aur consistency ke liye
-- `DROP` + `CREATE` rakhna saaf padhne wala hai.
DROP TRIGGER IF EXISTS trg_channels_updated_at ON channels;

-- `EXECUTE FUNCTION` (001 ka same convention). `EXECUTE PROCEDURE` sirf
-- purana synonym hai aur naye Postgres versions me deprecated hai.
CREATE TRIGGER trg_channels_updated_at
  BEFORE UPDATE ON channels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMIT;

-- ============================================================================
-- Verification (run AFTER applying)
-- ============================================================================
-- 1. Columns:
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'channels' ORDER BY ordinal_position;
--
--    Expect: cover_url    | text | YES   (NULL = cover nahi lagaya)
--    Expect: description  | text | NO    (NOT NULL ho gaya)
--    Expect: deleted_at   | timestamp with time zone | YES
--
--    NOTE: `character_maximum_length` YAHAN NULL aayega - column ka type
--    `text` hai, `varchar(n)` nahi. 500 aur 2000 CHARACTER ki limit
--    CHECK CONSTRAINTS (`ch_cover_url_len`, `ch_description_len`) enforce
--    karte hain, wo `information_schema.columns` me dikhte hi nahi.
--
-- 2. Constraints:
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint WHERE conrelid = 'channels'::regclass AND contype = 'c';
--
--    Expect rows for ch_cover_url_len and ch_description_len
--
-- 3. Partial index - PREDICATE check karo, naam nahi.
--
-- SELECT pg_get_expr(i.indpred, i.indrelid) AS predicate
--   FROM pg_class c
--   JOIN pg_index i ON i.indexrelid = c.oid
--  WHERE c.relname = 'idx_channels_public_handle';
--
--    Expect: (is_public AND is_active AND (deleted_at IS NULL))
--
--    Ye EXACTLY wahi text hai jo Step 3 ke guard se compare karta hai. Agar
--    yahan kuch bhi alag dikhta hai - `is_deleted`, ya `= 1`, ya `= true` -
--    to Step 3 ka guard match nahi karega aur har re-run par index rebuild
--    hoga. Isi liye test bhi EXACT string match karta hai.
--
-- 4. Trigger:
-- SELECT tgname FROM pg_trigger
--  WHERE tgrelid = 'channels'::regclass AND NOT tgisinternal;
--
--    Expect: trg_channels_updated_at
--
-- 5. Re-run proof (index rebuild nahi hona chahiye):
-- SELECT 'oid=' || oid FROM pg_class WHERE relname = 'idx_channels_public_handle';
-- -- psql -f 011_channel_management.sql  (dobara)
-- SELECT 'oid=' || oid FROM pg_class WHERE relname = 'idx_channels_public_handle';
--
--    Dono OID SAME hone chahiye. Badal gaye to Step 3 ka guard kaam nahi
--    kar raha.
-- ============================================================================
