# Content Platform — the plan

**Status:** written before any code, as asked. Nothing here is implemented.

**The headline finding, first, because it changes everything below:** most of what
you described already exists in this codebase. It is correct, tested, and **not
connected to anything.** The plan is therefore not "build upload, build plans, build
ads". It is **"connect the pieces that are already sitting there, then build only the
four things that genuinely do not exist."**

---

## 1. Four facts that constrain everything

### 1.1 Nothing ever grants a plan. Therefore every quota is zero.

`entitlements` is a well-designed ledger. `EntitlementService` has `Grant`, `Cancel`,
`Limit`, `Can`, `CheckUsage`, `EffectivePlanCode`, `Seed`. The semantics are right —
folding is `MAX` not `SUM`, cancelled rows count until `ends_at`, unlimited
short-circuits, a grant of `0` returns `ErrQuotaDenied` rather than
`ErrQuotaExceeded`. Someone thought carefully about this.

**`Grant` has zero production callers.** No payment webhook, no admin action, no trial
provisioning. `entitlements` is empty in every running system. So `Limit()` returns
`ErrEntitlementMissing`, every quota resolves to **0**, and the media upload path
fails closed with `ErrMediaQuotaExceeded`.

**Nobody can upload anything, on any plan, because no plan is ever attached to
anyone.** That is the first thing to build. Everything else is downstream of it.

### 1.2 The revenue-split engine runs nowhere.

`billing-service/src/service/ad-economics.go` implements exactly what you described:

```
ViewerShare              60%
Creator (subscribed)     20%
Creator (free)           10%
Platform                 20%
```

It also implements the **50% content-uploader discount** you asked for
(`GetPlanForCreator`, `ContentUploaderDiscountPercent = 50`).

**Every function in that 365-line file has zero production callers.** It is called
from its own tests and nowhere else. Meanwhile `handler/device-revenue.go:81-83`
re-hardcodes `total * 0.60 / 0.20 / 0.20` inline instead of calling it, with a
comment conceding settlement "happens at ledger time" — and no ledger exists.

So the split logic you want is written. It is just not connected to any event.

### 1.3 `ads-service` is a web banner server, and it is not deployed.

An `Ad` here is `{HTMLContent, MediaURL, TargetURL, Width, Height, CPC}`. It has no
`asset_id`, no `channel_id`, no `user_id`. It cannot see `media_assets` or `channels`
— there is no client and no foreign key. Selection is **random shuffle**
(`rand.Shuffle`), and `AdDeliveryRequest` accepts `Country`, `Region`, `City`,
`Device` while **filtering on none of them** — they are only copied onto the
impression row.

It is not in `docker-compose` either. It has a Helm chart, so it is Kubernetes-only.

### 1.4 There is no GST anywhere.

I searched every `.go` and `.sql` file. `gst`, `cgst`, `sgst`, `igst`, `hsn` — zero
matches as identifiers. `TaxRate` exists as a stored row. `Invoice.TaxAmount` exists
as a column defaulting to `0.00`. **Nothing multiplies anything by a rate.**
`CreateInvoice` hardcodes `"IN"` as the customer country.

This is a real build, not a wiring job. It needs a chartered accountant, not an
engineer — see §7.

---

## 2. What you asked for, mapped to reality

| You asked for | Reality | Verdict |
|---|---|---|
| Upload engine | **Exists** in auth-service: `/media/initiate` → presigned PUT → `/media/:id/finalize`. MIME + extension allowlists, channel ownership check, quota check. | Wire it. Don't rebuild. |
| Free-tier clip/reel limits | **Exist** as plan grants: `starter` = 25 media + 10 reels, `trial` = 0/0. | Connect the grant. |
| Paid plan limits | **Exist**: 7 plans, `media_assets` up to unlimited, `export_height`, `concurrent_transcodes`, `seats`. | Connect + add missing caps. |
| 50% uploader discount | **Exists** in `GetPlanForCreator`. Uncalled. | Connect. |
| Notifications for free users | `push-service` exists on disk, **not deployed**, and nothing publishes `NOTIFICATION.push`. | Build the sender. |
| Editor default 30s free clips | Editor has **no plan awareness at all**. No duration cap, 11 ungated export presets up to 4K. | Build. |
| Editor plan settings + user choice | No `entitlement`/`plan` token exists in the editor source. No server-side projects. | Build. |
| Ads on clips, per-channel | **Does not exist** in any form. | Build. |
| Viewer ad packages (min/max per clip, channel + country + continent targeting) | **Does not exist.** | Build. |
| Ads booking engine | **Does not exist.** | Build. |
| Superadmin per-user content/revenue reports | Awareness has registrations + devices only. **Zero revenue, zero content, zero subscription.** | Build. |
| GST monthly report | **Does not exist.** | Build. |

---

## 3. The four security problems found on the way

These are not part of your request. They surfaced while auditing, and two of them
break things you asked for.

### 3.1 Most of billing-service is unauthenticated

`main.go:50-53` registers all 30+ routes with only `gin.Logger()` and
`gin.Recovery()`. `AuthRequired()` is applied **only** to the payout group. So these
are reachable by anyone who can reach the port, with `user_id` taken from the request
body:

```
POST /subscriptions        POST /plans
POST /invoices             POST /invoices/payments
PUT  /payments/:id/refund  PUT  /plans/:id
```

Anyone can create a plan, subscribe themselves to it, issue an invoice, mark it paid,
and refund it. **The entire billing surface is writable by an unauthenticated
caller.** Fix this before building anything that touches money.

### 3.2 The superadmin ledger merge is silently broken

`apps/superadmin/src/app/api/ledger/route.ts:91` merges auth activity with billing
revenue on `a.primary_device_id`. **That field does not exist** anywhere in the
repository — it is not on auth-service's `UserActivity`. `String(undefined ?? '')`
→ `''` → every lookup misses → **`device_revenue` is `null` for every user, always.**

This is why the dashboard's revenue table has looked empty. It is not a data problem.

### 3.3 Three copies of the billing schema

`auth-service`, `billing-service` and `analytics-service` each define their own
`SubscriptionPlan`, `Subscription`, `TaxRate`, `InvoiceItem`, `Payment`. Three
databases, three definitions, no synchronisation, and a fourth set in
`royalty-service`. Plus **three disagreeing answers to "what currency are plans
priced in"** — `plans.go` says USD, `ad-economics.go` says INR/USD/`LOCAL`,
`handler.go:300` hardcodes `"IN"`.

Pick one owner before adding a fourth concept to any of them.

### 3.4 Two smaller ones

- `device-ad-revenue-guard.go:136` — `record.AdImpressions += record.AdImpressions`
  **doubles the impression counter** instead of incrementing by one.
- `creator.go:617-636` switches on `"lifetime_1"` / `"lifetime_5"` / `"lifetime_10"`,
  but the real codes are `lifetime1` / `lifetime5` / `lifetime10`. All three fall
  through and display the raw code to users.

---

## 4. Phase 0 — unblock everything (do this first, ~1 day)

Nothing else can be verified until these exist. None of it is new architecture.

### 0.1 Make plans grantable

The one thing blocking every quota in the product. Four writers, in priority order:

1. **Admin grant** — `POST /admin/entitlements` (superadmin-gated). Lets you grant a
   plan by hand, which is what makes everything else testable today.
2. **Signup trial** — `Grant(..., "trial", 3 days)` on registration. Turns the
   `trial` plan from decorative into real.
3. **Subscription purchase** — on `payments` success.
4. **Migration grant** — one-off for existing users.

Wire `Grant`/`Cancel` and the quotas start working. This is the highest
value-per-hour change in the entire plan.

### 0.2 Fix the three defects that hide the rest

- Authenticate billing-service (§3.1)
- Fix `primary_device_id` (§3.2)
- Fix the impression doubling and the `lifetime_N` codes (§3.4)

### 0.3 Reconcile the currency answer

One owner, one currency of record, one conversion point. `currency-service` already
does FX correctly and costs nothing (manual seed + optional keyless
`frankfurter`); it simply does not know plans exist.

**Deliverable:** a creator can be signed in, granted `starter` by hand, and upload
up to 25 videos and 10 reels. Everything after this is provable.

---

## 5. Phase 1 — content upload engine (the "real" engine)

You asked what to do with the existing upload service. **Delete
`services/upload-service`.** Its own successor rejects it in writing
(`media_upload.go:9-27`): no auth, `uint` user IDs against `uuid`, port 8085
collision, and chunking 8 GB video *through* a Go service instead of straight to
object storage. It is not in compose and nothing references it. Keeping it is a trap
for the next person.

The live pipeline is already the right shape:

```
POST /media/initiate          -> entitlement check, then a presigned PUT URL
  (browser PUTs bytes straight to MinIO; they never touch Go)
POST /media/:id/finalize      -> mark uploaded, enqueue transcode
GET  /media/:id/status        -> poll
```

**What is missing and must be built:**

| Gap | Why it matters |
|---|---|
| **File size not enforced.** `DefaultMaxMediaBytes = 8 GB`, `DefaultMaxReelBytes = 512 MB` are declared and **referenced nowhere**. A comment points at `media_limits.go` — **that file does not exist.** | Anyone can request a presigned URL for a 500 GB object. |
| **Duration not enforced.** `DefaultMaxReelSeconds = 90` likewise dead. | A "reel" can be 4 hours. |
| **No server-side verification.** `Bytes`, `DurationS`, `Width`, `Height`, `HasAudio` are **0 on every `ready` asset** — the callback copies them onto themselves. Only `poster_public_url` is populated. | Quotas cannot be measured from real data, and the player has no dimensions. Needs an ffprobe pass after upload. |
| **No `kind` in the editor's awareness.** One upload path serves video/reel/audio correctly via `kind`, but nothing tells the editor what a plan allows. | Phase 2 depends on it. |

Add a `ffprobe` step between `finalize` and `ready` that **writes** those five
columns. Everything downstream — duration limits, storage accounting, editor
defaults, ad slot placement — needs them to be real.

---

## 6. Phase 2 — plan-aware editor

Today the editor has no plan awareness whatsoever. Concretely, three changes:

### 6.1 A limits endpoint the editor can ask

```
GET /api/v1/me/limits
-> { plan, media_assets: {used, limit}, reel_assets: {...},
     max_clip_seconds, export_height, concurrent_transcodes, seats }
```

The editor cannot enforce anything it cannot read. This endpoint is the whole
contract.

### 6.2 Plan defaults, and let the user override within them

Your requirement: **free gets 30-second clips by default; paid get more; the user
chooses what to load.**

So the limits are **defaults, not walls**:

| | free | starter | pro |
|---|---|---|---|
| default clip length | 30s | 120s | 300s |
| max export height | 720 | 1080 | 2160 |
| concurrent transcodes | 0 | 1 | 2 |

`CapExportHeight` already exists as a grant; nothing reads it. Filtering
`EXPORT_PRESETS` (`exporter.ts:50-63`) by it is a one-line change that turns an
ungated 4K export into a plan-respecting one.

### 6.3 "More clips, more settings" for paid

Your point about paid users feeling like it's *their* app rather than a demo. The
concrete version: **the free editor is the same editor with defaults lowered**, not a
smaller editor. Same timeline, same effects, same export dialog — with the free
default duration at 30s and 720p. Paid users get longer defaults, higher ceilings,
and no watermark.

There is already a `watermark_enabled` column on `channels` (migration 022) and an
empty-state logo in `preview-canvas.tsx:35-46` that is **not** a watermark. Wire the
real thing to `CapSeats` / free tier.

### 6.4 One honest constraint

`ProjectDoc` has no `UserID` and projects live in **IndexedDB on the client**. So
`CapSaveProjects` ("2 saved projects" on trial) is not observable today — there is no
server-side project record. Either drop the capability or build server-side projects.
**Recommendation: drop it from the catalogue now** rather than advertise a limit you
cannot enforce.

---

## 7. Phase 3 — ads: the largest genuine build

This is the only part of your request with nothing behind it. Three sub-builds, in
dependency order.

### 7.1 Make revenue attributable to content

Today ad revenue is attributed to a **device fingerprint**, and nothing ever writes
to `device_ad_revenue` at all. There is no table anywhere linking a revenue row to a
`media_assets.id` or a `channels.id`.

Add `content_revenue`:

```
content_revenue(id, asset_id, channel_id, user_id, period,
                gross_minor, viewer_minor, creator_minor, platform_minor,
                impressions, source)
```

Then call `CalculateRevenueSplit` from the impression-recording path instead of
re-hardcoding 0.60/0.20/0.20 in `device-revenue.go`. That single substitution turns
the whole split engine on.

**Keep the device cap.** `ad-revenue-guard.go` caps revenue per device precisely
because there is no third-party ad network — one person running three accounts
inflates their own earnings. That is a good design for a self-hosted platform and
should not be replaced.

### 7.2 Ad slots in the player, with viewer packages

You asked: viewers choose how many ads, max and minimum per clip, whose channels,
which country/continent.

This needs `ad_breaks` and a viewer preference, both of which **do not exist**:

```
ad_breaks(id, asset_id, offset_ms, kind)        -- pre_roll | mid_roll | post_roll
viewer_ad_prefs(user_id, max_ads_per_clip, min_ads_per_clip,
                channels_opt_out, countries_opt_out, continents_opt_out)
```

The **caps must be server-enforced**, because a client-side ad limit is a suggestion.
And the country/continent targeting is the piece `ads-service` currently pretends to
do: `AdDeliveryRequest` already accepts `Country`, `Region`, `City`, `Device` and
ignores all four. Wiring the filter is most of the work; the schema already wants it.

### 7.3 Booking engine

Campaigns with budget, flight dates, frequency caps, and pacing. `ads-service` has
`Ad.CampaignID` as an **unvalidated `uint` with no foreign key and no campaign table**.
This is a real build.

**Honest scoping note:** booking engines are deceptively large. Budget pacing,
over-delivery control, fraud detection on clicks, reconciliation against actuals —
that is weeks, not days. I would ship **7.1 and 7.2 first**, which already give you
revenue attributable to content, and defer 7.3 until there is revenue to book against.

---

## 8. Phase 4 — superadmin reporting

You asked for per-user: what they did, how much they uploaded, how many ads on their
content, how many subscriptions, how many packages, **plus an automatic GST monthly
report**.

### 8.1 Per-user reporting (straightforward — the data exists)

A new superadmin-only endpoint joining what is already there:

```
GET /admin/reports/users?period=YYYY-MM
-> per user: content_uploaded, total_bytes, channels, active_plan,
             subscriptions_bought, months_subscribed,
             ad_impressions, ad_revenue_minor, lifetime_value_minor
```

Every field already exists in `media_assets`, `channels`, `entitlements`,
`channel_subscriptions`, and (once 7.1 lands) `content_revenue`. This is a reporting
query, not a new subsystem.

### 8.2 GST — this needs an accountant, not an engineer

Being direct, because the wrong answer here is expensive:

**India GST is not one rate.** It is CGST + SGST (intra-state, split) or IGST
(inter-state), plus cess where applicable, decided by the **supplier state and
customer state**, with HSN/SAC codes on every invoice. `TaxRate` has a generic
`Country`/`Region` and no state codes, no GSTIN, no HSN, no place-of-supply.

What I can build:

- A proper tax table: `tax_rates` extended with `hsn_code`, `supplier_state`,
  `place_of_supply`, `cgst`, `sgst`, `igst`, `cess`.
- Calculation **at invoice issue**, so the amount is recorded rather than recomputed
  later — a tax figure that changes when you recalculate it is not a tax record.
- A monthly **GSTR-1/3B-shaped export**: B2B invoices, HSN-wise summary, state-wise
  summary.

What I cannot build, and you must confirm before I start:

1. Are you registered GST, and in which state? This sets your place of supply.
2. Are you selling **services** (likely — a creator platform) or goods? Different
   rate slabs entirely.
3. Do you need a marketplace view (GST collected on behalf of creators)? If yes,
   that is a substantially larger obligation than your own GST.
4. Cross-border? `RegionHigh`/`RegionLow` implies non-INR customers, which means
   **export zero-rated** treatment and no IGST.

**My recommendation: do not build this until those four are answered by whoever does
your filings.** The schema and the exporter are a week of work and are trivially
wrong if the underlying answers change. Getting a chartered accountant's answer first
costs a day and saves a rewrite.

---

## 9. Sequencing

```
Phase 0  grant + 3 defect fixes          ← unblocks everything, ~1 day
Phase 1  ffprobe + size/duration caps   ← upload engine becomes real
Phase 2  /me/limits + editor gating     ← plan-aware editor
Phase 3a content_revenue + call split   ← revenue attributable to content
Phase 3b ad slots + viewer packages     ← ads on clips
Phase 4a per-user reports               ← superadmin visibility
────── accountant answers before ──────
Phase 4b GST tables + exporter          ← only after §8.2 is answered
Phase 3c ads booking engine             ← defer; weeks of work
```

---

## 10. Suggestions

**Do the boring Phase 0 first.** It is one day and it is the difference between a
platform where plans work and one where they are decorative. Everything in your
request depends on a user having a plan, and right now nobody can.

**Delete `services/upload-service`.** It is 701 lines of wrong code that a future
developer will find and try to adopt. Its own successor rejects it in writing.

**Pick one owner for billing schema.** Three copies, three currencies, one hardcoded
country. A fourth concept added to that is a fourth place to forget.

**Advertise only what you can enforce.** `CapSaveProjects` is unobservable because
projects are client-side. Either build server-side projects or drop the capability.
A limit shown to a user and not enforced is worse than no limit, because it teaches
them the numbers are decorative.

**Keep the device-level ad-revenue cap.** It looks like a workaround and it is
actually correct for a self-hosted platform with no third-party ad network. Do not
replace it with per-user attribution alone.

**Consider whether the ads booking engine is worth it yet.** With no third-party
demand, you are building supply-side tooling for buyers who do not exist. 3a and 3b
give you real revenue attribution; 3c can wait until someone books a campaign.

---

## 11. What I would not build, and why

| Request | Recommendation |
|---|---|
| MAC-address binding | **Impossible here.** A web page gets no hardware identifier from the platform. We use a per-browser random id. Already discussed; unchanged. |
| Fingerprint-based sharing detection | Use **concurrent distinct devices per account**, which `user_sessions.device_id` already supports and presence now populates. That measures the thing you actually care about. |
| Auto-revoke on geo-IP anomaly | **Do not.** Geo-IP is wrong for VPN, corporate proxy, mobile carrier CGNAT and travel. Auto-permanent-ban on it bans paying customers. Use it as a *signal for review*, never as an automated verdict. |
| Daily database backups | Keep the monthly cycle you asked for, but run `backup.mjs verify` in the same cycle. A monthly job that only dumps will run for a year producing archives nobody has restored. |

---

## Appendix — evidence

Every claim above is from source. The four most load-bearing:

| Claim | Where |
|---|---|
| `Grant` has zero production callers | `entitlements.go:351` defined; only `entitlements_test.go` calls it |
| Only 2 of 8 capabilities are enforced | `media.go:103`, `device_slots.go:194` — the only two `Limit()` callers in the repo |
| `ad-economics.go` has zero production callers | every function called only from `ad-economics_test.go` |
| billing-service routes are unauthenticated | `cmd/billing-service/main.go:50-53`; `AuthRequired` only at `:83-93` |