# Wideo11 — System Plan

> **Status:** decision-complete, awaiting approval before code.
> **Written:** 2026-10-01
> **Scope:** everything not yet built. What already exists is listed in §2 and is
> **not** rebuilt.
>
> This document exists so the build is a sequence of small verified steps
> instead of a redesign every few weeks. Where a number appears, it is a
> decision, not a placeholder — change it here first, then in code.

---

## 1. Non-negotiables

These are rules the whole build obeys. They are listed first because every
later decision is checked against them.

| # | Rule | Why it is a rule and not a preference |
|---|---|---|
| R1 | **Server is the only authority.** The browser never decides entitlement, price, quota or permission. | Every quota in this product (projects, exports, devices, reels) is enforced server-side. A client-side check is a suggestion. |
| R2 | **Money is integer minor units.** Every amount is stored as `amount_minor int64` + `currency char(3)`. No floats, ever. | `0.1 + 0.2` in a payout is a support ticket you cannot argue with. |
| R3 | **One service owns one data domain.** | `click_events` currently lives in `auth_service`. That is why nobody could find it and why analytics queries join across concerns. Moving it is Phase 1. |
| R4 | **A ledger, not a counter.** Entitlements, wallet and plan changes are append-only rows. The current state is a projection. | A counter that drifts is unrecoverable. A ledger can always be re-folded. |
| R5 | **Publish is a state machine, never a boolean.** `draft → uploading → processing → ready → published → failed`. | "Upload done" has six meanings. A boolean collapses them and loses the ability to show the user what is happening. |
| R6 | **Signed URLs for media, always.** No bucket is ever public. | One `PresignedGet` call replaces a whole class of leak. |
| R7 | **Secrets only from env/secret store.** Nothing in the repo, nothing in an image layer. | `.env` is gitignored and already holds the JWT secret; this extends to every new key. |
| R8 | **Idempotency keys on every money and publish operation.** | Retries are the normal case, not the exception. Without a key, a retry double-charges. |
| R9 | **No new service without a reason to keep it separate.** | A service costs deploys, alerts, backups and on-call. Six well-built services beat twelve small ones. |
| R10 | **Every destructive action is soft-delete + purge job.** Hard delete only from the purge job itself. | It is the only way "delete my account" and "30-day retention" can both be true. |
| R11 | **No new service without first writing one line saying which of the 29 undeployed ones could not do the job.** Default answer: "reuse one of those". | `services/` holds 29 complete, compiling services that have never run — 29,728 lines. The default when starting something new is to look there first. Evidence in `SERVICE-TRIAGE.md`. |
| R12 | **No service ships without authentication.** Not one of those 29 has any. | `wallet-service` and `withdrawal-service` deployed as they stand are unauthenticated money APIs. Auth is part of "done", not a follow-up ticket. |

---

## 2. What already exists — do not rebuild

Verified present and working as of 2026-10-01.

| System | State | Where |
|---|---|---|
| Auth: register → **email verify → login → PIN → questions → biometric** | Working, order enforced in middleware | `services/auth-service`, `apps/web/src/middleware.ts` |
| Device-scoped logout, session ownership + cascade | Working, `10/10` | `services/auth-service/migrations/013_*` |
| JWT `jti` denylist, Redis rate limiter | Working (the gap table at `updatedtodo.md:126` is **stale** — both are done) | `internal/middleware/revocation.go` |
| Security headers (CSP/HSTS/X-Frame-Options) | Working (gap #2 is **stale**) | web middleware |
| MinIO bucket-scoped service account | Working (gap #1 is **stale**) | compose |
| Video editor: timeline, compositor, transitions, audio graph, filmstrips, watermark, help | `77/77` browser checks | `apps/video-editor` |
| Editor shared preview/export compositor | Working — one compositor, two consumers | `lib/engine/compositor.ts` |
| In-app access gate with ordered states | Working, `10/10` | `components/chrome/access-gate.tsx` |
| NATS JetStream | Working | compose |
| Prometheus → Alertmanager | Working, `restart: unless-stopped` | compose |
| `click_events` capture on 8 apps | **Working** after Session 16 | `api/audit` → `@wideo11/ui/audit-handler` |
| **`analytics-service`** | **Compiles, 2238 lines, NOT deployed** | `services/analytics-service` |
| **`ads-service`, `campaign-service`, `upload-service`, `wallet-service`, `ledger-service`, `accounting-service`, `royalty-service`, `withdrawal-service`** | **Compile, ~9500 lines total, NOT deployed** | `services/*` |
| Transcoding service, MinIO, Redis, Postgres | Running, `27/27` healthy | compose |

### 2.1 ~30 undeployed services already exist — read this before building anything

`services/` holds **34 directories**. Only **4 services** are actually in compose
(`auth-service`, `billing-service`, `dashboard-service`, `transcoding-service`,
`webhook-receiver`, `currency-service`). The other **~30 never run**, and between
them they are **~20,000 lines of Go that compiles**.

Most were flagged by their shape: identical scaffolding (`main.go`, `config.go`,
`database.go`, `handler.go`, `repository.go`, `service.go`), generated rather
than written. But they are not stubs — `ads-service` has 369 lines of service
logic and 12 real CRUD routes (ads, placements, slots, campaigns, stats).

**This inverts several phases below.** Phases 3, 7 and 8 are not "build X"; they
are "assess, adopt or discard what is already there".

| Service | Lines | Overlaps phase | Verdict needed |
|---|---|---|---|
| `upload-service` | 585 | 3 — upload engine | likely a starting point |
| `ads-service` | 1284 | 7 — ads manager | **has** ads/placements/slots/stats |
| `campaign-service` | 1064 | 7 | has campaigns |
| `wallet-service` | 1292 | 8 — payouts | **has** a wallet |
| `ledger-service` | 910 | 6/8 | has a ledger |
| `accounting-service` | 1029 | 8 | has ledger logic too |
| `royalty-service` | 955 | 8 | creator payouts |
| `withdrawal-service` | 1552 | 8 | payouts |
| `analytics-service` | 2238 | 1 — telemetry | **has** views/clicks/conversions/reach/revenue |

**Two things about them that are not obvious:**

1. **`analytics-service` has no authentication at all.** Its routes are
   `gin.Logger()` + `gin.Recovery()` and nothing else. Deployed as it stands it
   is an open API that writes to the database. Every one of these services needs
   auth *before* it is exposed, not after.

2. **`analytics-service`'s `ClickLog` is a different domain from `click_events`.**
   `ClickLog` has `AdID`, `CampaignID`, `ContentID` — it is **ad and content
   engagement**. `click_events` has `page`, `target`, `label`, `surface` — it is
   **UI interaction telemetry**. Same word, two different things, and both are
   worth keeping. They belong in one service as two tables, not merged.

**Rule adopted because of this:** no new service is created in this build without
first writing one line saying which of the 30 existing ones could not do the job.
Default answer is "reuse one of those".

**Correction to `updatedtodo.md`:** the "Open security gaps" table lists 8 items.
Five are already closed. That table should be marked stale so it stops
steering work — see §12.

---

## 3. Fix what exists before adding anything

### 3.1 Click ledger — the three real defects

`click_events` exists and holds 533 rows. It is **not** "every click".

| Defect | Evidence | Fix |
|---|---|---|
| The **editor records nothing** | zero rows from `:3002` | add the same capture to the editor toolbar/timeline |
| **Page names recorded two ways** | 480 rows `/auth/login`, 53 rows `auth/login` | normalise at write time; one canonical form |
| Wrong **service** | rows in `auth_service` | move to the new telemetry service (§3.2) |

### 3.2 A note on Prometheus, because this is a trap

The request is "record every click, show it in the system, alert on it".

**Prometheus must not store per-click data.** It is a time-series store that
keeps a fixed number of samples per metric and **forgets the rest**. Individual
clicks are not a metric — at a few thousand a second you exhaust the series
cardinality budget and take down every real dashboard on the box, and the
individual events are gone within hours regardless.

So the design is three tools doing three different jobs:

| Tool | Job | Data |
|---|---|---|
| **Postgres `click_events`** (new `telemetry` db) | the durable per-click ledger — the actual record | one row per click, retained 90 days |
| **NATS JetStream** | the firehose for anything that reacts *while it happens* | publish on write, so alerting is real-time |
| **Prometheus** | aggregates only | `clicks_total{page,target,outcome}` as counters, and rates |
| **Alertmanager** | alerts on those aggregates | never on raw events |

The dashboard reads the ledger. The alert fires on a rate. Both are correct, and
neither is asked to do the other's job.

### 3.3 Retention

| Table | Retention | Why |
|---|---|---|
| `click_events` | 90 days | long enough to debug a funnel, short enough to be defensible under GDPR-style deletion requests |
| `security_events` | 1 year | auth is an audit surface; a year is the common floor |
| `api_request_log` | 30 days | debugging only |
| Anything containing raw IP + email | 30 days, then IP truncated to /24 | this is PII and it is the row most likely to be subpoenaed |

---

## 4. Channels

YouTube-shaped, and deliberately small.

A **channel** is the container a creator publishes into. One user may own many.

| Field | Note |
|---|---|
| `id`, `owner_user_id` | owner is a user, not a group — groups come with Studio (§5.6) |
| `handle` | globally unique, `[a-z0-9_]{3,30}`, **reserved permanently** (see below) |
| `name`, `description` | name 1–100 chars |
| `avatar_key`, `banner_key` | MinIO keys, R2 (§4.2) |
| `visibility` | `public` / `unlisted` / `private` |
| `subscriber_count` | **derived**, not stored — see §4.1 |
| `status` | `active` / `suspended` / `terminated` |

**Handles are never released.** A handle that once pointed at a channel stays
`404` forever, even after deletion. Reuse lets an attacker register a channel
that inherits a dead link's trust — the same reason email addresses are not
reissued. The DB gets a `retired_handles` table; the name is held, the row is
gone.

### 4.1 Subscriber count is a projection

`subscriber_count` is **not** a column that gets `+1`'d. It is
`count(subscriptions WHERE status='active' AND ended_at IS NULL)`, cached in
Redis with a 60s TTL and recomputed exactly by a nightly job.

Reason: a stored counter drifts the first time a subscription is cancelled by a
payment reversal, a moderation action, or a concurrent write. A drift is
invisible and permanent. A projection is always recomputable, so it can only ever
be *temporarily* wrong.

### 4.2 Media

- Avatars `512×512`, banners `2560×1440`, both WebP + JPEG fallback.
- Every object is a private MinIO bucket; delivery is a presigned URL valid
  **15 minutes**, re-issued on demand.
- Originals are never deleted on account deletion until the 30-day purge (§11).

---

## 5. Upload engine

The pipeline is a state machine (R5) with one job per stage, and **no stage
shares a process with another**.

```
initiated → uploading → uploaded → scanning → transcoding → packaging → ready
                                ↘ failed (reason) ↘
```

| Stage | Does | Fails when |
|---|---|---|
| `initiated` | creates the asset row, returns presigned PUT URLs | quota exceeded (§5.2) |
| `uploading` | browser → MinIO direct, **never through our servers** | — |
| `uploaded` | waits for the object to exist and match the declared size/hash | size mismatch |
| `scanning` | ffprobe: real duration, dimensions, codec, audio | not decodable → `failed` |
| `transcoding` | ladder (§5.1) via the transcoding service | ffmpeg non-zero |
| `packaging` | poster frame, filmstrip, HLS manifest, waveform peaks | — |
| `ready` | publishable | — |

**Why direct-to-MinIO:** a 4 GB upload through a Next.js route holds a request
open for minutes, blows the container's memory, and the retry story is
hopeless. The browser asks for a presigned URL, PUTs the bytes straight to
MinIO, and reports completion. Our servers never touch the payload.

### 5.1 Transcode ladder

| Rendition | Video | Audio | Used for |
|---|---|---|---|
| `1080p` | H.264 high, 1080p, 6 Mbps | AAC 128k | the default everywhere |
| `720p` | H.264, 720p, 3 Mbps | AAC 128k | slow connections |
| `480p` | H.264, 480p, 1.5 Mbps | AAC 96k | mobile data saver |
| `audio` | — | AAC 128k | the player bar's waveform source |
| `reel` | H.264, 1080×1920, 8 Mbps | AAC 128k | reels only (§6) |

All renditions are produced **in one ffmpeg pass** (split filter). Two passes
means decoding everything twice, and the editor already proved that a
second decode pass is where frame-accuracy bugs are born.

### 5.2 Quotas — enforced server-side (R1)

| | Limit |
|---|---|
| max file size | 8 GB |
| max duration | 4 hours (long-form), 90 s (reels) |
| concurrent transcodes per plan | Trial 0, Starter 1, Pro 2, Studio 4 |
| stored assets | Trial 0, Starter 25, Pro 250, Studio 1000 |

A quota rejection happens at `initiated`, before a single byte is uploaded, so a
user never discovers the limit after waiting.

### 5.3 Re-upload safety

Re-uploading the same file to the same channel reuses the existing transcoded
renditions when the content hash matches. This is the single biggest cost saver
in the system: a creator fixing a title does not re-encode anything.

---

## 6. Reels

Short-form, with a hard time limit as you asked.

| Rule | Value | Reason |
|---|---|---|
| max duration | **90 seconds** | 90 s is the ceiling Instagram/TikTok/Shorts all accept without a split |
| aspect | **9:16 only** (1080×1920) | a letterboxed reel reads as broken on every one of them |
| orientation | vertical only | enforced at `scanning`, not at publish — fail early |
| safe area | no text in the top 250 px / bottom 320 px | platform UI covers it |
| watermark | platform watermark **stripped**; ours applied | our own, so we are not redistributing someone else's brand |
| max size | 512 MB | far below the 8 GB long-form cap |
| max per channel | 500 reels | keeps the delete job bounded |

**"Reels" are not a separate asset type.** A reel is an asset with
`kind='reel'`. One upload path, one transcode pass, one player. A second
parallel pipeline would be a second set of bugs.

### 6.1 Cross-platform readiness check

A reel is checked against each destination **before** it is offered, and the
result is a per-platform pass/fail with a reason. No guessing, and no "it
uploaded but looks wrong".

| Platform | Check | Fail message shown to the creator |
|---|---|---|
| Instagram Reels | 9:16, ≤90 s, ≤512 MB, audio present, moov atom at head | "Reel is 16:9 — crop it to 9:16" |
| TikTok | 9:16, ≤90 s (≤180 s allowed unlisted), H.264 + AAC | "Audio track is missing" |
| YouTube Shorts | 9:16, ≤60 s for the Shorts shelf, ≤90 s still uploadable | "Over 60 s — it will upload but not appear in Shorts" |
| Facebook Reels | 9:16, ≤90 s | "Over 90 s" |

The creator sees a **grid of four pass/fail tiles** before publishing, not an
error after.

**The reality to plan for:** no platform offers a public upload API that a
third party can use without the creator's own OAuth grant and often an app
review. So the honest design is:

- **Phase 1 (build now):** the readiness check + a **ZIP + caption pack** the
  creator uploads themselves, plus a per-platform status board.
- **Phase 2 (later, and gated on each platform's approval):** automated publish
  per platform, each behind its own feature flag, each storing the creator's
  refresh token encrypted at rest.

I am not going to build automated publishing against an API that does not
exist, and call it done.

---

## 7. Plans, trial, and entitlements

### 7.1 The seven plans

Numbers are decisions. They live in `.env` (§10), so they can be changed without
a deploy, but the **code** has no hardcoded plan logic.

| Plan | Price (USD) | Projects | Export | Ads engine | Seats | Devices |
|---|---|---|---|---|---|---|
| **Trial** | free, **3 days**, one time per user | **0 saved**, 2 in-session | 720p, watermark forced | no | 1 | 1 |
| **Starter** | 12 / mo | 2 active | 1080p, no watermark | no | 1 | 2 |
| **Pro** | 29 / mo | 25 active | 4K, no watermark | **yes** | 1 | 3 |
| **Studio** | 79 / mo | 250 active | 4K + priority render | yes, 3 campaigns | 5 | 5 per seat |
| **Lifetime 1** | 199 once | unlimited | 4K | yes | 1 | **1** |
| **Lifetime 5** | 599 once | unlimited | 4K + priority | yes, 10 campaigns | **5** | **5** |
| **Lifetime 10** | 999 once | unlimited | 4K + priority | yes, unlimited | **10** | **10** |

### 7.2 Why the trial saves nothing, on purpose

You asked for: 3 days, see everything, **cannot create or save a project**.

This is implemented as a **capability**, not a disabled UI:

| Capability | Trial |
|---|---|
| open the editor, all tools, all transitions, all effects | ✅ |
| create projects **in the session** | ✅ up to 2 |
| **save** a project | ❌ `project.create_persisted` denied |
| export | ❌ or 720p + forced watermark |
| upload media | ❌ |
| create a channel | ❌ |
| your work when the trial ends | **gone, and said so on day 1** |

The save is refused **server-side** (R1). A disabled button is a button someone
screenshots and works around.

Two things that make this fair rather than bait:
- The banner says on **day 1**, not on day 3: *"Anything you make in this trial
  is not saved. Export is disabled. Subscribe to keep your work."*
- Exporting is allowed at 720p with our watermark rather than blocked outright,
  so a trial user can judge the actual quality before paying.

### 7.3 Entitlement model

Never a boolean. Every capability is a row, so a plan change is a new row and
history is intact (R4).

```sql
entitlements (
  id, user_id, plan_code, source,        -- 'subscription' | 'lifetime' | 'grant' | 'trial'
  starts_at, ends_at NULL,                -- NULL ends_at = lifetime
  cancelled_at NULL,                      -- set at cancel; access continues to ends_at
  created_at
)

entitlement_grants (                      -- what a plan actually allows
  id, plan_code, capability, limit_value NULL   -- NULL = unlimited
)
```

`plan_code` in `entitlement_grants` is **seeded from `.env` at boot**, so a plan
change is an env change plus a restart, not a migration. Effective entitlement =
`max()` over all non-expired, non-cancelled grants. "Max" is what makes
"Pro, then downgraded to Starter" work without deleting the Pro row.

### 7.4 Lifetime device limits, precisely

A lifetime plan is bound to **N devices**. This is the part that gets built
wrong, so the rule is explicit:

- The count is over **`device_accounts` rows for that user** (the same table the
  3-per-device rule uses — reused, not duplicated).
- A device is identified by the **same fingerprint** as everything else.
- Changing a password **does not** free a device slot. Revoking a device is an
  explicit user action that frees exactly one slot.
- Server-side, on every request (R1). A limit that lives in the UI is a
  suggestion.

---

## 8. Subscriptions and payments

### 8.1 Provider

**Razorpay** for the launch, not Stripe. Reason: INR is the primary market,
and Razorpay handles GST invoicing, UPI, and Indian settlement without a second
legal entity. Stripe is a config change later — the interface is one adapter.

### 8.2 Subscriptions

| Event | What we do |
|---|---|
| `subscription.created` | write `entitlements` row |
| `subscription.charged` | extend `ends_at`; write to wallet ledger if overpaid |
| `payment.failed` | mark `past_due`; **keep access for 3 days**; then expire |
| `subscription.cancelled` | set `cancelled_at`; access continues to `ends_at` |
| `charge.refunded` | revoke entitlement, ledger entry, and **recompute quota** |

**Webhook, never the browser.** The browser gets a "redirecting" screen and
nothing else. A browser can close the tab; a webhook cannot. Webhooks are
verified by signature, are idempotent on `event.id`, and are stored raw before
processing (R8).

### 8.3 The grace period is not optional

Card expires → instant revocation is how you get a refund request and a chargeback
instead of a retry. Three days, with two emails, converts most of those into a
successful retry.

---

## 9. Ads, creator payouts, and the viewer loop

### 9.1 The money flow, and why it is a ledger

```
viewer pays  ──▶  platform wallet (ledger)  ──▶  creator payout (ledger)
                     │                              │
                     └─ platform fee (ledger)       └─ refunds (ledger, negative)
```

Every movement is a `wallet_ledger` row. The balance is
`sum(amount_minor)`. A stored balance drifts; a sum cannot (R4).

### 9.2 Ads manager

Ads are made **in the editor** — you asked for that, and it is the right call: an
ad is a video, so the tools that make a video good are the tools that make a good
ad.

An ad **references** an existing project rather than duplicating it:

| Table | Purpose |
|---|---|
| `ad_campaigns` | name, advertiser, budget, flight dates, status |
| `ad_creatives` | `project_id` FK + placement + duration override |
| `ad_bookings` | campaign × channel × slot × price, with a status machine |
| `ad_impressions` / `ad_clicks` | delivery, for billing and for the creator's own stats |

Referencing means editing the ad edits the video, which is what a creator
expects. Duplicating the project would fork it, and then there are two videos and
no single source of truth.

Campaigns are gated: only Pro and above (table §7.1).

### 9.3 Payouts

- **Threshold 1000 (minor units of the payout currency).** Below it, money stays
  in the wallet and rolls over.
- **Monthly**, on the 5th, for the previous month.
- **Minimum age of funds: 14 days** from payment capture. This is the refund
  window; paying out earlier means paying out a chargeback.
- Every payout references the exact ledger rows it settles, so a disputed payout
  can be re-derived rather than argued about.

### 9.4 What viewers can actually do

| Action | Needs | Notes |
|---|---|---|
| watch a free video | nothing | |
| like / comment | a session | rate-limited |
| subscribe (free) | a session | |
| subscribe (paid) | Razorpay | grants `entitlement` |
| pay a creator directly | wallet balance | 12% platform fee, the rest to their balance |

---

## 10. All rates in `.env`

Every number a user can pay or a limit they can hit is an env var. No prices in
code, no limits in code.

```ini
# ---- Plans (minor units: paise/cents) ----
PLAN_TRIAL_DAYS=3
PLAN_STARTER_MONTHLY_MIN=1200
PLAN_PRO_MONTHLY_MIN=2900
PLAN_STUDIO_MONTHLY_MIN=7900
PLAN_LIFETIME_1_MIN=19900
PLAN_LIFETIME_5_MIN=59900
PLAN_LIFETIME_10_MIN=99900

# ---- Limits ----
UPLOAD_MAX_BYTES=8589934592
UPLOAD_MAX_DURATION_SEC=14400
REEL_MAX_DURATION_SEC=90
REEL_MAX_BYTES=536870912
PROJECTS_MAX_ACTIVE=25
EXPORT_MAX_HEIGHT=2160
TRIAL_MAX_TRANSCODES=0
STARTER_MAX_TRANSCODES=1
PRO_MAX_TRANSCODES=2
STUDIO_MAX_TRANSCODES=4

# ---- Payouts ----
PAYOUT_THRESHOLD_MIN=100000
PAYOUT_MIN_AGE_DAYS=14
PLATFORM_FEE_BPS=1200        # 12.00%

# ---- Grace ----
PAYMENT_GRACE_DAYS=3

# ---- Retention (days) ----
RETENTION_CLICK_EVENTS=90
RETENTION_API_LOG=30
RETENTION_SECURITY_EVENTS=365
RETENTION_BACKUP=30          # the 30-day auto-purge, §11
```

Boot seeds `entitlement_grants` from these, so changing a limit is an env change
plus a restart. **Every read is live from the DB**, not from env, so there is no
window where a restart and a request disagree.

### 10.1 Multi-currency

One table. Base prices are USD minor units; a multiplier converts.

```ini
# FX multipliers, applied to the USD base. 1.0 = parity.
FX_MULT_DEFAULT=1.0
FX_MULT_WEAK=0.5        # e.g. INR, NGN, IDR, BDT, PKR, UGX
FX_MULT_STRONG=1.5      # e.g. NOK, SEK, CHF, JPY
```

**This is the same idea you described** — a weak currency pays roughly half, a
strong one about one and a half times — and it is one number per group instead
of 180 hand-priced entries, so a price change is one edit.

**How the conversion is final, so nobody can be surprised at checkout:**

1. Multiply the USD base by the multiplier → `raw`.
2. Round **up to the next value ending in 9** (`…, 9, 19, 29, 39`) → `displayed`.
3. Store `(usd_base_minor, fx_mult, rate_locked_at, displayed_minor)` on the
   checkout session.
4. The `displayed` figure is what is charged. It never moves afterwards.

Rounding **up to a charm price** is deliberate: `₹299` reads as a rounded number,
`₹294` reads as a computed one. The difference is a few percent and it is worth
more than the percent.

**The multiplier is not an exchange rate** and is not presented as one. It is a
price-level band, and it is documented in `.env` as such so nobody later "fixes"
it against a live rate feed and breaks every price at once.

### 10.2 Multi-language

| Decision | Choice | Why |
|---|---|---|
| Mechanism | `next-intl`, ICU message files | used already in the workspace |
| Languages | `en`, `hi`, `es`, `pt-BR`, `ar`, `id` | one RTL (`ar`) from the start, not later |
| RTL | CSS logical properties only — `ms-`/`me-`, never `ml-`/`mr-` | a single `dir="rtl"` then works with no per-component work |
| Fallback | `en` | a missing key must never render a key |
| Money | formatted with the user's **currency**, not the language | `hi-IN` and `en-IN` both show `₹`; the language is not the currency |

**Built as a required discipline now**, not a retrofit: a new string goes into
`en` and is translated in the same change. Retrofitting i18n after 200 screens
means finding 600 strings by hand.

---

## 11. Backup, restore, and the 30-day purge

Your note is recorded and goes in as the **last** section of
`updatedtodo.md` once everything above is stable. It is last on purpose: a
backup of a system whose schema is still moving is a backup of nothing.

| Decision | Value |
|---|---|
| what | `pg_dump` custom format for every database, + MinIO bucket listing + a `MANIFEST` with per-object SHA-256 |
| where | MinIO, a `backups/` bucket, separate credentials from the app's |
| when | nightly 03:00, plus a pre-migrate snapshot |
| retention | **30 days, then hard-deleted.** No exceptions, no "keep the important ones". |
| restore | one documented command, into a **fresh** database — never over a live one |
| verification | every backup's manifest is checked on write; a backup that cannot restore is not a backup, it is a file |

The purge is a cron inside the backup service, not a shell script, so it is in
the same transaction/log as the backup that it ages out.

---

## 12. The build order

Each phase is independently verifiable. Nothing in phase *n* assumes phase
*n+1* exists.

| # | Phase | Done when | Why here |
|---|---|---|---|
| **0** | Fix the stale gap table in `updatedtodo.md`; close the two real click defects (§3.1) | editor clicks land in the ledger; page names are canonical | 5 of the 8 listed gaps are already closed. A stale list has been steering work toward finished things — that is the single most expensive thing in this document. |
| **1** | **Telemetry, inside the existing `analytics-service`** — deploy it *with auth first*, add a `ui_click_events` table beside its `ClickLog`, NATS on write, Prometheus aggregates, Alertmanager on rates. Then move the apps off `auth_service` and drop `click_events` there | a rate spike pages you; a single click is retrievable for 90 days; `analytics-service` is no longer an undeployed 2238-line ghost | every later phase needs to know what users do. Doing it first means the rest is measured, not guessed. |
| **1a** | **Triage the ~30 undeployed services** — for each: adopt, port into an existing service, or delete | no 35th service appears by accident; phases 3/7/8 are scoped against code that already exists | decide this *before* phase 1, because phase 1 adopts one of them. |
| **2** | **Channels** | create / edit / avatar / banner / visibility / delete, all server-authorised | everything else hangs off a channel. It is also the smallest useful user-visible slice. |
| **3** | **Upload engine** + ladder | real file → `ready`, all 5 renditions, poster + filmstrip | the core asset pipeline. Nothing publishes before this. |
| **4** | **Reels** + 4-platform readiness check | the grid shows pass/fail per platform with a reason | cheap once §3 exists, and it is what creators will judge the product on. |
| **5** | **Plans + entitlements** + trial + device limits | 3-day trial saves nothing, server-refused; 7 plans from `.env`; lifetime device slots enforced | every quota needs an entitlement to check. Before billing, not after. |
| **6** | **Subscriptions** (Razorpay) + wallet ledger | webhook-driven, idempotent, 3-day grace | money in, with an audit trail. |
| **7** | **Ads manager** + booking | a campaign in the editor, booked against a channel | needs media (§3) and entitlements (§5). |
| **8** | **Creator payouts** | monthly, threshold, 14-day age, ledger-derived | needs real money movement first (§6). |
| **9** | **Multi-currency** | `₹299` checkout, locked per session | needs a price to convert. |
| **10** | **Multi-language** | 6 locales, `ar` RTL correct | cheapest to do while the surface is small, most expensive after. |
| **11** | **Dashboard depth** — every record the user has | projects, edits, uploads, earnings, devices, sessions, plan history | pure read path over tables the earlier phases created. |
| **12** | **Backup + 30-day purge** | restore proven from a real backup | last, and only once the schema stops moving. |

### 12.1 Phase 0 status: complete

Done, and it turned up more than the two defects it was scoped for:

- `surface` column + composite index; `page` normalised at write time on the
  server; `target` resolved from `data-track` / `aria-label` / classes.
- `NEXT_PUBLIC_*` now passed as Docker **build args** to all **8** apps. It had
  been dead everywhere — `next build` inlines it, so compose's runtime
  `environment:` block cannot reach the browser, and every app was on its
  fallback. Verified behaviourally, not by grep: `tools/check-surfaces.mjs`.
- The **superadmin app's JavaScript was entirely dead** — its runner stage copied
  static to `./.next/static` while `output: 'standalone'` looks under
  `apps/superadmin/.next/static`. Every chunk 404'd with an HTML body, so nothing
  hydrated. One bug, previously reported as three.
- The audit route existed as **three drifting copies**, five of which reported an
  unreachable store as `400`. Now one handler in `@wideo11/ui/audit-handler`.
- HSTS could never be switched on: config read `NEXT_PUBLIC_HSTS_MAX_AGE`, the
  env set `SECURITY_HSTS_MAX_AGE`.

Detail in `updatedtodo.md`, Session 16.

### 12.1 On "complete the app that is already built"

Phases 0 and 1 are that work. Before them, the only other thing already built and
unfinished is what the editor itself says it cannot do — the marker notes not
persisted with the project, and the Phase D3 backup service (now phase 12).

---

## 13. The security model, in one place

| Concern | Rule |
|---|---|
| Authorisation | server-side, every request, from the verified session. Never from a client claim. |
| Media access | private buckets + 15-minute presigned URLs. No exception. |
| Money | integer minor units; ledger not counters; idempotency keys on every charge and payout. |
| Rate limits | Redis (already in place), per user **and** per IP, with the tighter of the two winning. |
| Secrets | env only. `.env` is gitignored. New keys go in `.env` + `.env.example` with a description. |
| Audit | every state change writes an `audit_events` row: actor, action, target, before/after, ip, ts. |
| Deletion | soft delete + 30-day purge (§11). Backup purge and account purge are the same mechanism. |
| Uploads | validated by decoding, never by trusting the client's declared content-type or extension. |
| Webhooks | signature-verified, stored raw before processing, idempotent on provider event id. |
| PII | 30-day retention on anything holding raw IP + email; IP truncated to /24 after. |

---

## 14. Decisions I made, and the ones I refused to fake

| Question | Decision | Note |
|---|---|---|
| How many plans | **7**, in three families (monthly / studio / lifetime) | more than this and the choice itself becomes a support problem |
| Trial | 3 days, 0 saved, 2 in-session, day-1 warning | the honest version of "try it" |
| Reel length | **90 s**, 9:16 only | 90 s is the common ceiling across all four platforms |
| Currency model | multiplier per group, charm-rounded, locked at checkout | not a live FX rate, and not pretending to be |
| Plans per currency | convert from one USD table | 180 hand-priced plans would be 180 chances to be wrong |
| Subscriber count | derived, never a stored counter | a counter drifts and never tells you |
| Auto-post to social | **not built in phase 1** | those APIs need per-creator OAuth and app review. I will not build against an API that does not exist and call it finished. |
| Backup position | last (phase 12) | a backup of a moving schema is not a backup |
| Services count | 6 new at most | every extra one costs deploys, alerts and backups |
