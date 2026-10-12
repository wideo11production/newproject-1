# WIDEO11 — MASTER BLUEPRINT & ARCHITECTURAL SPECIFICATION

> **Status:** DRAFT for approval. **No code has been written for this document.**
> This is the freeze. Every remaining decision is written down here so we stop
> re-litigating design mid-build.

---

## 0. EXECUTIVE SUMMARY

Wideo11 is a **monorepo** with 38 Go service directories, 8 Next.js apps, and 16
shared packages. The scale is large but the *deployed* scale is much smaller:

| Layer | Exists in repo | Actually deployed (docker-compose) |
|---|---|---|
| Go services | 38 (113,000 LOC) | **6** — auth, transcoding, billing, analytics, webhook-receiver, currency |
| Frontend apps | 8 | **7** — web, video-editor, superadmin, billing, admin, analytics, monitor, currency |
| DB migrations | 34 | 34 (all applied) |

**The single biggest risk is not "what is missing" — it is that two design systems
are running at once.** See §2.1. That is a freeze-breaker and must be decided first.

---

## 1. COMPREHENSIVE PROJECT AUDIT & STATE

### 1.1 Backend — what is real

Only these are built AND deployed (have a `docker-compose` build context):

| Service | LOC | Responsibility | State |
|---|---|---|---|
| **auth-service** | 50,006 | Identity, channels, media pipeline, entitlements, RBAC, security (PIN/questions/WebAuthn), moderation, comments | **Production-ready** — 34 migrations, 153 Go files, full test suite green |
| **transcoding-service** | 4,483 | ffmpeg ladder + **automated content moderation** (visual frame-by-frame + text line-by-line) | **Working** — engine built, 14+ tests |
| **billing-service** | 12,985 | Plans, subscriptions, grants, ledger | **Built** |
| **analytics-service** | 4,900 | Telemetry, click ledger | **Built** |
| **upload-service** | 2,881 | Chunked/resumable upload | **Built (not composed — see §1.3)** |
| **webhook-receiver** | 740 | Inbound partner events | **Built** |
| **currency-service** | 781 | FX rates | **Built** |

Also substantial but **NOT in docker-compose** (code exists, never deployed):
`video` (4,194), `recommendation-service` (2,842), `user-service` (2,250),
`cdn-service` (2,117), `withdrawal-service` (1,798), `ads-service` (1,590),
`dashboard-service` (1,574), `ledger-service` (1,510), `wallet-service` (1,502),
`stream` (1,446), `push-gateway` (1,328), `push-service` (1,302),
`campaign-service` (1,258), `accounting-service` (1,214), `config-service` (1,117),
`royalty-service` (1,116), `subtitle-service` (1,000), `thumbnail-service` (713),
`streaming-service` (544), and ~14 smaller.

### 1.2 Backend — models (18 in auth-service)

```
channel_setup      channel_subscription   comment          creator
entitlement        media_asset           media_moderation_audit   model
rbac               security              security_alert_ack      settings
superadmin         trial_device          user_registration  verification
webauthn
```

`comment` + `comment_likes` are the newest (built this session, migration + service +
handler + tests complete).

### 1.3 Backend — the deployed vs undeployed gap is the #1 architectural finding

`upload-service`, `video`, `cdn-service`, `streaming-service`, `push-service`,
`thumbnail-service`, `subtitle-service`, `ads-service`, `wallet-service` etc. all
have **working code with zero compose wiring**. Consequences:

- The upload path currently runs through **auth-service** (`/media/initiate`,
  `/media/:id/finalize`) — not `upload-service`.
- HLS packaging runs through **transcoding-service** — not `video` or `cdn-service`.
- There is **no notification/push delivery** despite `push-service` + `push-gateway`
  + `push-preferences` existing.

**Decision required (§5 Q3):** wire these in, or delete them from the repo? A
half-deployed fleet is worse than either answer, because nobody can tell what is
live.

### 1.4 Frontend — what is real

| App | Pages | TSX LOC | State |
|---|---|---|---|
| **web** | 19 | 30,975 | **Main work.** Studio/Discover/Channel/Watch built this session |
| **video-editor** | 1 (SPA, 141 files) | 26,016 | Large existing editor |
| **superadmin** | 3 | 7,286 | login, moderation, awareness |
| **monitor** | 3 | 7,136 | Grafana-style metrics |
| **analytics** | 1 | 6,105 | |
| **admin** | 1 | 5,015 | |
| **billing** | 1 | 4,865 | |
| **currency** | 1 | 468 | |

### 1.5 Frontend — web app page inventory (verified)

```
✅ /                       landing (Prime-Video style shell)
✅ /auth/login             public   — the ONE login for the whole platform
✅ /auth/register          public   — onboarding
✅ /auth/verify            public   — email verification target
✅ /auth/reset-password    public
✅ /auth/security-setup    public   — the gate itself (deadlock fix)
✅ /channels               public   — browse channels
✅ /channel/[handle]       public   — channel page (studio split built)
✅ /videos                 public   — Discover (built this session)
✅ /watch/[id]             PROTECTED — watch page (comments UI pending wiring)
✅ /dashboard              protected
✅ /dashboard/upload       protected — studio workspace (built)
✅ /dashboard/plans        protected
✅ /dashboard/settings     protected
✅ /dashboard/channels/setup  protected
✅ /browse                 public
✅ /ads                    public
✅ /workspace              protected
✅ /superadmin/awareness   role-gated
⚠️ /pricing               PUBLIC IN MIDDLEWARE, NO PAGE EXISTS  ← BUG
⚠️ /resources             LINKED FROM STUDIO HEADER, NO PAGE     ← BUG
⚠️ /profile               NOT BUILT                             ← GAP
```

### 1.6 Frontend — component inventory

Shared studio components (`apps/web/src/components/studio/`) — **all built this session:**

```
ActivePlayerPane.tsx     ChannelHeaderCard.tsx   Comments.tsx
DiscoverSidebar.tsx      MediaLibraryPane.tsx    PublishConfirmDialog.tsx
StudioHeader.tsx         StudioIconRail.tsx      StudioMediaCard.tsx
StudioSidebar.tsx        StudioUploadBox.tsx     (StudioUploadBox now unused)
```

Root-level shared: `HoverPreviewThumbnail.tsx`, `InlinePlayer.tsx`,
`InlinePlayerProvider.tsx`, `PreviewVideo.tsx`, `MediaCard.tsx` (deleted),
`GalleryThumbnail.tsx` (deleted).

---

## 2. DESIGN SYSTEM & UI/UX SPECIFICATIONS

### 2.1 🔴 CRITICAL FINDING — TWO DESIGN SYSTEMS ARE RUNNING AT ONCE

| | `packages/ui/design-system.ts` (exists, exported) | Studio pages (built this session) |
|---|---|---|
| Background | `#111217` `grafanaBgHex` | `#0d0f11` **hardcoded hex** |
| Panel | `#181b1f` `grafanaPanelHex` | `#16181d` **hardcoded hex** |
| Panel hover | `#1f2227` | `#1f2227` ✅ |
| Border | `#2c3235` | `#2c3235` ✅ |
| Body text | `#d8d9da` | `#e6e6e6`/`#fff` |
| Muted text | `#9fa7b3` | `#8b949e` |
| **Primary/accent** | **`#5794f2` (Grafana blue)** | **`#ff6500` (Wideo11 orange-red)** |

The studio pages do **not** import a single token from the design system. Every
colour is a raw hex in a `className`. **This is exactly the class of drift the
design system was created to prevent**, and it is now present in 10 files.

**This must be resolved before another pixel is drawn.**

### 2.2 Shadcn/UI status — does not exist

There is **no** Shadcn setup. No `components.json`, no `components/ui/` library,
no `cn()`-based primitive set beyond `packages/ui/src/lib/utils.ts`. The request to
standardise on "Shadcn/UI + Tailwind" means **building that layer from scratch**,
or adopting the existing `design-system.ts` token classes and calling that the
component layer.

### 2.3 Typography — undefined

No font-family tokens exist in `design-system.ts` or the web `tailwind.config.ts`.
Type scale is ad-hoc (`text-xs`, `text-[9px]`, `text-[10px]`, `text-[11px]` — note
three sub-`text-xs` arbitrary sizes in the studio components alone).

### 2.4 The rules I propose to freeze (needs your sign-off)

**A. Palette — ONE source of truth**

Tokens move into `packages/ui/design-system.ts` and the studio hex values become
aliases of them, not competitors:

```
surface.0   #0d0f11    page background
surface.1   #16181d    card / panel
surface.2   #1f2227    hover / raised
surface.3   #2c3235    border / separation (NOT a line — contrast only)
text.0      #ffffff    primary
text.1      #e6e6e6    body
text.2      #8b949e    muted
accent      #ff6500    brand orange-red (replaces grafanaPrimaryHex everywhere in product UI)
```

`grafanaPrimaryHex #5794f2` stays only where it already means "informational"
(player spinner, links) — it is not the brand accent.

**B. No hardcoded hex in components.** Enforced by an ESLint rule
(`no-restricted-syntax` on hex literals in `className`). This is the rule that
stops this from recurring.

**C. Type scale — six steps, no arbitrary values**

`text-2xl` (page title) / `text-base` (section) / `text-sm` (card title) /
`text-xs` (body) / `text-[11px]` (meta) / `text-[10px]` (label).
The `text-[9px]`/`text-[8px]`/`text-[7px]` sizes currently in use are removed —
anything that small is unreadable and they were used to fit text that should
instead wrap or truncate.

**D. Spacing — 4px base, one set**

`gap-1` `gap-1.5` `gap-2` `gap-3` `gap-4` `gap-5`. No `gap-2.5` alongside `gap-3`
for the same role. The studio currently mixes both.

**E. Radii — three only**

`rounded-lg` (controls), `rounded-xl` (cards), `rounded-2xl` (panels). No
`rounded-md`.

**F. Depth, never borders**

The blueprint rule stands: separation comes from background contrast and soft
shadow, **not** from `border-*`. `#2c3235` is a *surface*, not a stroke.

**G. State specification — every interactive element has all five**

```
default / hover / focus-visible / disabled / loading
```
Currently the studio cards have default + hover only. `focus-visible` is absent on
the card itself, which means **the media grid is not keyboard-reachable** — an
accessibility defect, not a polish item.

### 2.5 Component state spec (public vs protected)

| | Public view | Protected view |
|---|---|---|
| Source of truth | `/api/public/*` (no session forwarded) | `/api/*` (session forwarded) |
| Gate behaviour | Never 401s; 404 for private/unscreened | 401 → login; 403 → setup |
| Player | public stream route, no `assetOwnerId` | owner route, owner affordances |
| Publish / Go Live | **absent** | present, only when `moderation_status === 'approved'` |
| Delete/Edit comments | absent | author-or-clip-owner |
| Delete media | absent | owner only |

---

## 3. ROUTING & ACCESS CONTROL BLUEPRINT

### 3.1 The gate is centralised — and that is correct

`apps/web/src/middleware.ts` is **configuration only**; every decision lives in
`@wideo11/ui/gate`. This was the right refactor and must not be undone. The gate
enforces, in order:

1. **Rate limit** (works on public routes too — login is public)
2. **No session** → API `401` JSON; page → `/auth/login?next=<original>`
3. **Email unverified** → `403` / `/auth/verify?next=...`
4. **Security setup incomplete** → `403` / `/auth/security-setup`
5. **`/superadmin` + `/api/superadmin`** → requires `superadmin` role; page → `/dashboard`, API → `403`

Plus **silent token renewal** (refresh cookie → new access token, 90s window). This
is load-bearing: without it users are silently signed out every 15 minutes.

### 3.2 Auth pipeline — all flows through port 3000

Confirmed by audit and memory:
- The **web** app owns the only login page. Superadmin/billing/admin/analytics/monitor apps **redirect to `localhost:3000/auth/login`**.
- auth-service returns `users.role` in the JWT.
- Roles: `user`, `staff`, `superadmin`, `superadmin_recovery`.

⚠️ **Verified gap:** I could not find **any** code that reads the role and performs
the post-login redirect to `:3008/superadmin`. Memory records the design intent;
the implementation appears **absent or in a location I did not locate**. See §5 Q2.

### 3.3 Route map — proposed (with corrections)

```
PUBLIC (no session)
  /                        landing
  /auth/login              ← single login for the whole platform
  /auth/register
  /auth/verify
  /auth/reset-password
  /auth/security-setup
  /channels                browse channels
  /channels/@[handle]      channel page
  /videos                  Discover
  /browse
  /ads
  /pricing                 ← CREATE (referenced by middleware, missing)
  /resources               ← CREATE (linked from StudioHeader, missing)

PROTECTED (session + email verified + security setup)
  /dashboard
  /dashboard/upload        studio workspace
  /dashboard/plans
  /dashboard/settings
  /dashboard/channels/setup
  /workspace
  /profile                 ← CREATE
  /watch/[id]              ← DECISION NEEDED: currently protected; should it be public?

ROLE-GATED
  /superadmin/*            superadmin + superadmin_recovery + staff
  /admin/*                 (app :3004)
  /billing/*               (app :3003)
  /analytics/*             (app :3005)
  /monitor/*               (app :3001) superadmin only

APP PORTS (from memory)
  3000 web (public, login page)
  3001 monitor      — superadmin only
  3002 video-editor — any logged-in user
  3003 billing      — any logged-in user
  3004 admin        — any logged-in user
  3005 analytics    — any logged-in user
  3008 superadmin
```

### 3.4 Backend ↔ frontend contract (auth-service, verified)

~110 routes across these groups:

| Group | Prefix | Auth | Notes |
|---|---|---|---|
| `auth` | `/api/v1/auth/*` | mixed | login/register/refresh/verify are public |
| `protected` | `/api/v1/auth/*` | session | profile, settings, PIN, password, avatar, channels, moderation queue |
| `publicGroup` | `/api/v1/public/channels/*` | none | list, `/:handle`, `/:handle/media` |
| `publicMediaGroup` | `/api/v1/public/media/*` | none | list, `/:id/stream`, `/:id/comments` |
| `protectedMedia` | `/api/v1/auth/media/*` | session | initiate, finalize, retry, delete, list, stream, **publish**, **comments** |
| `adminRBAC` | `/api/v1/auth/*` | role | privilege registry, grant/revoke service |
| `secGroup`/`secProtected` | `/api/v1/auth/security/*` | session | PIN, questions, biometric, events |
| `waGroup` | `/api/v1/auth/webauthn/*` | session | passkey register/login |
| internal | `/api/v1/internal/media/transcode-callback` | **shared secret** | transcoder → auth-service |

**A contract defect worth noting:** comments are registered TWICE — once under
`protectedMedia` (`/:id/comments`) and once under `publicMediaGroup`
(`/:id/comments`). Both resolve to `authHandler.MediaComments`. The protected copy
is dead code and should be removed; the public one is the correct one.

### 3.5 Notification flows — **NOT IMPLEMENTED**

`push-service`, `push-gateway`, `push-preferences` exist (3,299 LOC combined) and
**none are in docker-compose**. There is no notification delivered on any event.

Flows that need designing:

| Trigger | Audience | Channel |
|---|---|---|
| Register success | the new user | email (via `mail`) |
| Email verify success | the new user | email |
| Security setup complete | the new user | email |
| New comment on your clip | clip owner | in-app + push |
| New subscriber | channel owner | in-app + push |
| Moderation approved | uploader | in-app + email |
| **Moderation rejected** | uploader | in-app + email — must name the category |
| Moderation flagged | reviewer queue | in-app |
| Publish/Go-Live done | uploader | in-app |
| Plan/subscription change | subscriber | email |

---

## 4. PAGE-BY-PAGE BREAKDOWN & EXECUTION ROADMAP

### 4.1 Completed — do not touch without a reason

| Page | Route | Status |
|---|---|---|
| Landing | `/` | ✅ |
| Login | `/auth/login` | ✅ |
| Register | `/auth/register` | ✅ |
| Email verify | `/auth/verify` | ✅ |
| Reset password | `/auth/reset-password` | ✅ |
| Security setup | `/auth/security-setup` | ✅ |
| Channels browse | `/channels` | ✅ |
| Channel page | `/channel/[handle]` | ✅ (studio split, sidebar, header card) |
| Discover | `/videos` | ✅ (sidebar tabs, split, player) |
| Studio upload | `/dashboard/upload` | ✅ (channel filter, publish dialog, list+grid) |

### 4.2 Pending — ordered by dependency, not by preference

| # | Page / Task | Route | Backend dep | Why this order |
|---|---|---|---|---|
| **P0** | **Design token unification** | n/a | none | Everything after this depends on the palette. Doing it later means re-doing everything. |
| **P0** | Shadcn primitive layer | `packages/ui` | none | Blocks consistent form/control states across all 8 apps. |
| **P1** | **Watch page** | `/watch/[id]` | comments ✅ built | `Comments.tsx` component exists but is **not wired into the watch page**. Smallest high-value gap. |
| **P1** | `/pricing` + `/resources` | those routes | none | Both are referenced and 404. Broken links in the nav. |
| **P1** | Profile page | `/profile` | `GET /profile/full` ✅ | Nav has no profile destination. |
| **P2** | Role-based post-login redirect | n/a | JWT role ✅ | Superadmin currently has no verified path to `:3008`. |
| **P2** | Notification layer | n/a | push-service (undeployed) | User asked for it; needs compose wiring first. |
| **P3** | Editor parity | `/workspace` | — | 26k LOC editor exists; integration unspecified. |
| **P3** | Live / Playlists tabs | in DiscoverSidebar | **no backend** | Buttons exist, endpoints do not. Must NOT ship as empty. |
| **P4** | Undeployed services decision | n/a | — | Wire or remove. See §5 Q3. |

### 4.3 The serialised execution plan — one item at a time, no parallel design changes

```
STEP 0  DESIGN FREEZE
        └─ You approve §2.4 (palette / type / spacing / radii / states)
        └─ Nothing is built until this is signed off. This is the step that
           prevents the mid-build redesign problem.

STEP 1  TOKENS FIRST (P0)
        └─ Move studio hex → design-system.ts tokens
        └─ ESLint rule banning hex literals in className
        └─ Audit: grep for every #hex in apps/web/src
        └─ VERIFY: zero hardcoded hex outside design-system.ts
        └─ Only then may any visual work resume.

STEP 2  COMPONENT LAYER (P0)
        └─ Shadcn-init packages/ui
        └─ Build ONLY these primitives, consuming tokens: Button, Input, Select,
           Checkbox, Dialog, Card, DropdownMenu, Skeleton, Toast
        └─ Each with all five states (§2.4 G)
        └─ VERIFY: one Story-less visual check per component, 8 apps can import

STEP 3  WATCH PAGE (P1)
        └─ Wire existing Comments.tsx into /watch/[id]
        └─ Add focus-visible to the player controls
        └─ VERIFY: comments post, like toggles, link ban refuses with a reason

STEP 4  MISSING PAGES (P1)
        └─ /pricing, /resources, /profile
        └─ VERIFY: nav has zero 404s (crawl every Link href)

STEP 5  ACCESS + NOTIFICATIONS (P2)
        └─ Role-based redirect (needs Q2 answered)
        └─ Notification events table → wire push-service into compose
        └─ VERIFY: register → email arrives; comment → owner notified

STEP 6  CATEGORY COMPLETION (P3)
        └─ Live / Playlists: build the backend FIRST, or remove the tabs
        └─ VERIFY: no tab renders an empty state that looks like a bug

STEP 7  MONETISATION SURFACES (P4)
        └─ Ads, wallet, withdrawal, royalty against billing-service
        └─ VERIFY: an end-to-end earnings number reconciles with the ledger
```

**The rule for every step:** *backend contract → frontend → verify → only then
move on.* Never "build the page and find the endpoint".

---

## 5. CLARIFYING QUESTIONS — I need these before Step 0

**Q1. Palette — which accent is the brand?**
`design-system.ts` says **Grafana blue `#5794f2`**. The studio pages you approved in
the mockup use **orange-red `#ff6500`**. They cannot both be the primary. My
recommendation: `#ff6500` is the brand accent (it is what your mockup shows and what
every studio component uses), and `#5794f2` survives only as an *informational*
colour. **Confirm or override.**

**Q2. Where does a signed-in superadmin actually get sent?**
You have said (and memory records) that superadmin/superadmin_recovery should land on
`localhost:3008/superadmin`, and that all login happens at port 3000. I audited for
the implementation and **could not find it**. Is this already written somewhere I did
not look, or is it genuinely missing?

**Q3. The 32 undeployed services — wire or remove?**
113k LOC of Go exists; 6 services are deployed. Specifically: do you want
`upload-service`, `video`, `cdn-service`, `streaming-service`, `push-service`,
`thumbnail-service`, `subtitle-service`, `ads-service`, `wallet-service`,
`withdrawal-service` **wired into compose**, or **deleted from the repo**? Right now
nothing can tell which are live. This affects the notification work directly
(push-service exists but is not running).

**Q4. Should `/watch/[id]` be public?**
It is currently auth-gated. Your Discover page plays clips in an inline player
already, so the watch page is mostly a shareable full-page target. If it stays
protected, a shared link hits a login wall. **My recommendation: make it public**,
gated by the same `ready + approved + public channel` rule the inline player uses.

**Q5. What is the priority order of the four asks you gave me?**
You asked for audit → design system → routing → page roadmap. I have ordered the
*execution* as tokens → components → watch → missing pages → notifications. If your
priority differs (e.g. you want notifications before the design work), say so now,
because the order changes what gets rebuilt twice.

**Q6. Video-editor integration.**
The editor is 26k LOC as a standalone SPA on `:3002`. Is it meant to be a *route
inside web*, a *separate app*, or reachable from the studio (e.g. "Edit this clip"
from `/dashboard/upload`)? This changes the routing section materially.

**Q7. Which of these already exist that I may have counted as built?**
My audit is file-based. If, for example, a `/pricing` page exists outside
`apps/web/src/app`, or the superadmin redirect lives in `packages/ui/gate`, tell me
and I will correct the audit rather than plan to build something that is already
there.
