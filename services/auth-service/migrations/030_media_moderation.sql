-- 030: automated content moderation + pre-publish approval
--
-- PURPOSE: Video ab SEEDHA public nahi hoga. Har upload ek AI moderation
-- pipeline se guzarega, aur tabhi public hoga jab status APPROVED ho.
--
-- =============================================================================
-- WHY A SEPARATE `moderation_status` AND NOT A FLAG ON `status`
-- =============================================================================
--
-- `status` (initiated/uploaded/scanning/transcoding/ready/failed) ek TECHNICAL
-- state machine hai - "kya file decode ho sakti hai". Wo pipeline kabhi fail
-- hoti hai aur wo failure aaj bhi `failed` me likhi jaati hai.
--
-- Moderation ek POLICY state machine hai - "kya ye content dikh sakta hai". Ek
-- technically perfect video (ready) adult ho sakti hai. Dono ko jodne se:
--
--   1. Ek hi column do sawaalon ka jawab deti, aur "ready + allowed" ko
--      encode karne ke liye teen values invent karni padti (ready_approved).

--   2. Har gating site do conditions check karti - aur ek bhoolne par
--      adult content public ho jaata.
--
-- Isliye DO alag columns hain, aur PUBLIC VISIBILITY ka rule ek jagah hai:
--
--   status = 'ready'  AND  moderation_status = 'approved'
--
-- =============================================================================
-- THE MODERATION STATES
-- =============================================================================
--
--   not_required  -> audio/poster jaise technical assets, moderation se bahar
--   pending_review-> naya upload, AI scan abhi chala nahi (YELLOW)
--   approved      -> saare checks safe hain, public allowed (GREEN)
--   rejected      -> koi check threshold cross kar gaya, public NAHI (RED)
--   flagged       -> borderline, human moderator ka wait (ORANGE/manual)
--
-- Rejected/flagged dono par video PUBLIC NAHI hoti. Farq sirf itna hai ki
-- rejected par appeal nahi (clear violation), flagged par human decide karega.
--
-- =============================================================================
-- THE AUDIT TRAIL
-- =============================================================================
--
-- Har moderation verdict apne saath leeta hai: kaun sa check, kitna score,
-- kis time, kaun se rule par flag hua. Do wajah se:
--
--   1. Legal: "kyon delete kiya" ka jawab dena padta hai cyber cell ko.
--   2. Debugging: AI sirf ek layer hai, aur uska false positive bhi trace hona
--      chahiye taaki threshold tune ho sake.
--
-- IP aur device fingerprint audit row me hain, `media_assets` me NAHI - kyunki
-- wo moderation event ka hissa hai, asset lifecycle ka nahi. Upload ke waqt ki
-- IP retention worker purge karti hai; moderation record ko zyada zinda rehna
-- chahiye kyunki legal window lamba hota hai.

-- ---- 1. The columns on media_assets ----
ALTER TABLE media_assets
    ADD COLUMN IF NOT EXISTS moderation_status
        VARCHAR(16) NOT NULL DEFAULT 'not_required',
    ADD COLUMN IF NOT EXISTS moderation_reason
        VARCHAR(500) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS moderation_score
        REAL NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS moderation_checks
        JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS moderated_by VARCHAR(120) NOT NULL DEFAULT '';

COMMENT ON COLUMN media_assets.moderation_status IS 'Policy state: not_required | pending_review | approved | rejected | flagged. Public visibility requires status=ready AND moderation_status=approved.';
COMMENT ON COLUMN media_assets.moderation_reason IS 'Human-readable violation reason. Empty when approved.';
COMMENT ON COLUMN media_assets.moderation_score IS 'Highest violation confidence across all checks (0.0-1.0).';
COMMENT ON COLUMN media_assets.moderation_checks IS 'Per-check verdicts and scores: {"nsfw_skin": {"score": 0.31, "flagged": false}}.';
COMMENT ON COLUMN media_assets.moderated_at IS 'When the final verdict was written. NULL while pending.';
COMMENT ON COLUMN media_assets.moderated_by IS 'Who/what decided: "ai:local-v1" for automated, "admin:<uuid>" for human review.';

-- Index for the moderation worklist: "kaun se videos human review ke wait me hain".
-- Partial index on `flagged` only - kyunki ye ek chhoti, hoti hui list hai, aur
-- approved/pending rows yahan kabhi nahi dhoondhi jaati. Full index puri table
-- pe hota jo hazaron rows ki ja sakti hai.
CREATE INDEX IF NOT EXISTS idx_media_moderation_flagged
    ON media_assets (moderation_status, created_at)
    WHERE moderation_status IN ('pending_review', 'flagged');

-- ---- 2. The audit trail ----
--
-- Har check ka apna row nahi - ek row me poore verdict ka JSON. Reason: audit
-- ka granularity "is upload ka kya result tha" ka hai, "is frame ka kya tha"
-- ka nahi. Frame-level detail moderation_checks JSON me rehta hai.
CREATE TABLE IF NOT EXISTS media_moderation_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Asset se CASCADE: media row delete hui to uska moderation record bhi
    -- jaana chahiye. Retention worker expired assets hataati hai, aur unke
    -- moderation rows reh jaana orphan data hai jise koi padhega hi nahi.
    --
    -- NOTE: retention worker purane `ready`/`failed` rows hataati hai. Agar kisi
    -- asset ka legal case chal raha ho aur wo delete ho gaya, to audit bhi gaya -
    -- isliye legal hold waale assets ko retention se alag karna PADTA hai.
    -- Wo alag kaam hai (legal hold table) aur yahan scope se bahar hai.
    media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,

    -- Kaun se layer ne check kiya. "ai:local-v1" = heuristic engine,
    -- "asr:none" = audio check skip hua (koi ASR provider configured nahi).
    provider VARCHAR(120) NOT NULL,

    -- Verdict: approved | rejected | flagged
    verdict VARCHAR(16) NOT NULL,

    -- 0.0-1.0 highest confidence. Borderline zone ke cases me human dekhta hai.
    confidence REAL NOT NULL DEFAULT 0,

    -- Per-check breakdown - same JSON jo asset column me aata hai. Duplicate
    -- jaan-boojh kar hai: asset column CURRENT state hai (update hoti hai),
    -- audit row itihaas hai. Ek re-review ke baad asset pe sirf naya verdict
    -- rehta hai, aur "pehle kya tha" ka jawab sirf yahan milta hai.
    checks JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- IP aur device fingerprint - cyber cell ko dene ke liye.
    ip_address VARCHAR(64) NOT NULL DEFAULT '',
    device_fingerprint VARCHAR(128) NOT NULL DEFAULT '',
    user_agent VARCHAR(500) NOT NULL DEFAULT '',

    -- Human moderator ne override kiya to ye fields bhar jaate hain.
    -- NULL = AI ka hi verdict, koi human intervention nahi tha.
    reviewed_at TIMESTAMPTZ,
    reviewer_id UUID,
    reviewer_note VARCHAR(1000) NOT NULL DEFAULT '',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_audits_asset
    ON media_moderation_audits (media_asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_audits_user
    ON media_moderation_audits (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_audits_verdict
    ON media_moderation_audits (verdict, created_at DESC)
    WHERE verdict IN ('rejected', 'flagged');

COMMENT ON TABLE media_moderation_audits IS 'Immutable-by-convention audit trail of every content moderation verdict. IP/device recorded for law-enforcement cooperation.';

-- ---- 3. Backfill existing rows ----
--
-- Pehle se jo videos `ready` hain unko moderation_status='approved' de rahe hain,
-- aur `failed` ko 'not_required'.
--
-- YE BACCHEFLAG BHI EK POLICY DECISION HAI, aur uska reason ye hai: existing
-- videos pe AI scan nahi chitka ja sakta (source bytes delete ho chuke hain ya
-- retention ne uda diye). Unko 'pending_review' rakhne ka matlab hoga poora
-- library hidden ho jaayega, jo ek silent content removal hogi - user ko koi
-- notice ke bina uska content gayab.
--
-- Isliye: existing = approved (state preserve), naya upload = pending_review
-- (naya rule sirf naya content pe). Ye ek baar ka backfill hai - 030 ke baad
-- naya row kabhi 'approved' ke saath nahi banta, wo `moderation_status` column
-- ke DEFAULT se guzarta hai jo 'not_required' hai, aur upload path usse
-- 'pending_review' set karta hai.
--
-- `not_required` se `approved` nahi, kyunki us path ka matlab "moderation ko
-- zaroorat nahi thi" hona chahiye - audio/poster ke liye. Ye rows aik video hain.
UPDATE media_assets
SET moderation_status = 'approved',
    moderated_at = now(),
    moderated_by = 'system:migration-030-backfill'
WHERE moderation_status = 'not_required'
  AND status = 'ready';
