# Wideo11 — Implementation Status & Next Phases

> Last updated: 2026-09-29
> Verified against a live run. Every "done" item below was checked in a real
> browser or via the real API — not assumed from reading the code.

---

## Current state

- **Frontend:** runs on the host via `pnpm dev` → http://localhost:3000
- **Backend:** all services in Docker (25 containers, healthy)
- **Database:** purged to 0 users — clean slate, any email is free
- **Builds:** Go build ✅ · web typecheck ✅ · all Go tests pass ✅
- **Migrations:** 001→012 replay clean and idempotent on a live PostgreSQL ✅
- **Prometheus:** 7/7 targets up, 14 alert rules loaded ✅

---

## ✅ Completed and verified

### Auth reliability
| Item | Evidence |
|---|---|
| Register / verify / login / resend | full chain tested end-to-end |
| 30-minute verification TTL | `expires_at` confirmed in DB |
| Unverified login blocked | `403 "please verify your email"` |
| Resend issues a fresh token | old token deleted, count stays 1 |
| Rate limiter sane | 1/min → per-route (register 3/5min, login 8/min, verify 10/min) |
| Console fallback in dev | `SMTP_HOST` empty ⇒ logs instead of sending |

### Security gate (mandatory 3 steps)
Order is **PIN → Security Questions → Biometric (last)**.
| Item | Evidence |
|---|---|
| PIN + questions + biometric enforced | `/dashboard` → `307 /auth/security-setup` until complete |
| Biometric genuinely required | skip not taken ⇒ still blocked |
| Step-selection logic | explicit per-step numbering (was stale after reorder) |
| Auto-redirect on completion | gate loads → lands on `/dashboard` unprompted |
| PIN rollover | wrong old PIN → 403, nothing changes; valid → 200 |
| Password change | same two-step unlock pattern |
| Session invalidation | PIN change revoked other sessions, **kept current** |
| Biometric skip | persisted as opt-out, **no redirect loop** |

### User settings hub (`/dashboard/settings`)
One scrollable grid — profile, appearance (theme/accent), language, content +
subscription toggles, PIN, password. No repeat trips.
- PIN / password cards are **locked until the current credential verifies**
- Unlock is UI-only; the final change re-verifies server-side
- Accent/theme/language use an **allowlist** (blacklists are bypassable)
- `javascript:` / `data:` avatar URLs rejected

### Creator dashboard (`/dashboard`)
Profile · channels (create/list) · signed-in devices. Session avatar appears in
the header app-wide via a shared identity context — one fetch, no per-component
refetch, instant update after change.

### Avatar upload (B2.3)
Real file upload to **self-hosted MinIO** via presigned URLs. File bytes never
touch the app server.
| Attack | Result |
|---|---|
| HTML file renamed `.png` | rejected — magic bytes |
| `.svg` upload | rejected outright |
| Another user's object key | rejected — ownership check |

### Roles & routing
| Item | Evidence |
|---|---|
| `role` column + CHECK | migration 006, backfilled |
| Role in signed JWT claim | verified inside the token |
| `/api/v1/admin/*` gated | was **open to any logged-in user**; now 403 |
| `/superadmin` gated | normal user → 403 / redirected |
| Middleware exact-match paths | was prefix-matched (`/auth*` bypass) |

### Telemetry (real data only)
Country/continent/device/browser/OS captured **server-side** from real headers.
Awareness grid aggregates live rows and reports `countries_missing` honestly
rather than filling in a fake value. No dummy or seeded data anywhere in main.

---

## 🐛 Bugs found & fixed this session

Recording these because several were subtle enough to survive a green build:

1. **Colliding context keys** — `clientIPKey` and `clientUAKey` were both
   `clientInfoKey{}`, which are the *same value* in Go. The second
   `WithValue` overwrote the first, so **every "IP address" in the database was
   actually a User-Agent string**. That string overflowed `VARCHAR(45)`, which
   is why registration was returning **500**. Fixed with distinct key types +
   a regression test asserting IP ≠ UA.
2. **`session_id` always `uuid.Nil`** — token was generated *before* the
   session insert, and the ID came from a *database* default. Nothing could
   identify "current session", so PIN rollover was impossible. Now generated
   in code.
3. **`role` never set in request context** — the superadmin gate blocked
   *everyone*, including real superadmins.
4. **`/api/v1/admin/*` had no role check** — any logged-in user could read
   security events and device locks.
5. **GORM crash-loop** — a view on `sessions.ip_address` blocked every
   `AutoMigrate`. Dropped the view, query the table directly.
6. **Presigned URLs embedded the internal host** (`minio:9000`), so the
   browser got a dead URL. Needed a second client for browser-facing URLs.
7. **Stale step numbers** after the reorder sent users back to questions.
8. **"Skip biometric" was fake** — it marked completion locally while the
   backend still said incomplete, producing an infinite redirect loop.
9. **Auto-redirect never fired** — the gate showed "Redirecting…" and then sat
   there forever.
10. **Empty space in the biometric form** — `min-h-[600px]` on a ~200px step.

Two of these I introduced myself in this session (the context keys and the
invalid hook call), and both were caught before you saw them.

---

## 🔴 Open security gaps — NOT yet closed

Listed honestly because "unhackeable" is not achievable and pretending
otherwise just stops the search for real holes.

| # | Gap | Risk | Effort |
|---|---|---|---|
| 1 | **MinIO uses root credentials** | Full storage compromise if leaked | Low — rotate + bucket-scoped service account |
| 2 | **No security headers** (CSP, HSTS, X-Frame-Options) | Broad XSS / clickjacking surface | Low — one file, high value |
| 3 | **No JWT `jti` denylist** | Stolen token valid until expiry even after logout | Medium |
| 4 | **PII in telemetry, no retention policy** | Privacy / compliance exposure | Medium |
| 5 | **Verification link hardcoded to `localhost`** | Broken on phone / any other device | Low — env var |
| 6 | **Gmail for production email** | ~500/day cap; account can be locked | Medium — Postfix in prod |
| 7 | **Rate limiter is in-memory** | Resets on restart, useless across replicas | Medium — Redis (already available) |
| 8 | **No 2FA at login** | PIN is asked *after* login, so password alone grants a session | High — architectural |

**Recommended order:** #1 → #2 → #5, then #3 and #7.

---

## 📋 Next phases

### Phase A — Close the cheap security gaps *(small, high value)*
1. MinIO service account (rotate from root)
2. Security headers middleware (CSP, HSTS, X-Frame-Options, Referrer-Policy)
3. `VERIFICATION_BASE_URL` to a reachable host

### Phase B — Real user dashboard depth
4. Channel management beyond create (edit, cover image, visibility)
5. Content upload surface wired to the `content_upload_enabled` toggle
6. Viewer subscription management

### Phase C — Session & auth hardening
7. JWT `jti` denylist (instant logout)
8. Move rate limiting to Redis (survives restart, works across replicas)
9. 2FA at login

### Phase D — Operations
10. Email templates for channel/subscription notifications
11. Content retention + cleanup jobs
12. Backup/restore runbook

---

## 🧪 How to test the verified flow

```powershell
# 1. fresh start
cd D:\newproject; docker compose up -d
cd apps\web; pnpm dev

# 2. register at http://localhost:3000/auth/register
# 3. verification link arrives in email (check spam)
# 4. log in -> security gate: PIN -> Questions -> Biometric
# 5. dashboard -> /dashboard
```

Useful commands:

```powershell
# email + auth service logs
docker logs wideo11-auth-service --tail 40

# what is stored
docker exec wideo11-postgres psql -U postgres -d auth_service -c "SELECT username,email,is_verified,role FROM users;"

# wipe everything and start clean
docker exec wideo11-postgres psql -U postgres -d auth_service -c "TRUNCATE channels, webauthn_sessions, webauthn_credentials, security_questions, security_events, security_pins, security_profiles, verification_tokens, refresh_tokens, sessions, user_sessions, pins, devices, device_accounts, test_account_markers, click_events, user_registrations, users RESTART IDENTITY CASCADE;"
```

---

## ⚠️ Notes before this goes live

- **Nothing is committed.** The working tree has unreviewed changes across
  `services/auth-service`, `docker-compose.yml`, `monitoring/`, and `tools/`.
  Review before the first commit.
- **Test accounts were promoted to `superadmin`** during verification. They are
  now purged, but check for any others before deploying.
- **`packages/common/public/` is untouched** and clean.
- **Headless testing cannot do real WebAuthn** — biometric enrollment was
  verified via the skip path. The Windows Hello face flow needs one run in your
  own browser to confirm end-to-end.

---

# Session 2 — Schema integrity, authz enforcement, ops hardening

> 2026-09-29. Driven by `services/auth-service/migrations/011_channel_management.sql`,
> which was rewritten from scratch. The real finding was not in 011 itself: the
> whole migration chain had silently rotted, and two authorization checks were
> cosmetic. Every item below is verified against a live container, not by
> reading code.

## 🔴 Secrets in git history — ACTION REQUIRED

`.env.example` is **git-tracked** and had real, working credentials in it,
committed across four commits (`41b07ff`, `d3bed83`, `83e7af5`, `0236747`):
a live Gmail app password, an OpenAI project key, and live Stripe secret +
webhook keys.

The values are now placeholders, and `tools/audit-secrets.mjs` blocks the
recurrence (wired into `.husky/pre-commit`). **But the history still contains
them. Scrubbing git history is not a substitute for rotating the secrets —
anyone who cloned the repo already has them. Rotate all of them now:**

| Secret | Where to rotate |
|---|---|
| Gmail app password | Google Account → Security → App passwords |
| OpenAI project key | platform.openai.com → API keys |
| Stripe secret + webhook | dashboard.stripe.com → Developers → API keys |

If the repo was ever pushed to a remote, assume compromise. If it is
local-only, the rotation is still worth doing, but history is not urgent.

## 🟠 Migration chain could not be provisioned from scratch

Migrations 003, 004, 005, 009 and 010 contained **SQL Server syntax**
(`IF COL_LENGTH`, `dbo.`, `CURSOR`, `GO`, `sys.sp_addextendedproperty`,
`GETDATE()`, `BIT NOT NULL`). None of it runs on PostgreSQL. Each had been
applied by hand against a SQL Server origin, so the files *looked* fine and had
never executed here — a from-scratch deploy would have died at 003.

All twelve migrations are now clean, idempotent PostgreSQL and verified by a
replay harness:

- `TestMigrationChainReplays` builds a scratch database, runs AutoMigrate, then
  applies 001→012 **twice** and asserts the end state. Skipped unless
  `AUTH_MIGRATION_REPLAY=1`.
- `TestAutoMigrateCoversEveryPersistedModel` fails if a model is wired into a
  handler but not into `AutoMigrate` — the failure mode where a service starts
  fine and 500s on first real use.

```powershell
cd services/auth-service
$env:AUTH_MIGRATION_REPLAY = "1"
go test ./internal/database/ -run TestMigrationChainReplays -v
```

Two bugs this caught immediately, both of which had shipped:

1. `011` still had `WHERE is_public = 1` in the code while its own comment
   claimed it was fixed. On a fresh database that is
   `ERROR: operator does not exist: boolean = integer`. The comment documented
   the fix; the statement never received it.
2. `002` was not idempotent and declared `token_hash VARCHAR(255)` where the Go
   model wants 512 — a live insert would have failed with "value too long".

## 🟠 Account deletion was impossible

7 of the 10 foreign keys referencing `users` had `ON DELETE NO ACTION`, so
`DELETE FROM users` was rejected the moment a user had a session:

```
ERROR: update or delete on table "users" violates foreign key
       constraint "fk_users_sessions" on table "sessions"
```

Data-erasure requests could not complete, and orphaned auth material —
sessions, refresh tokens, WebAuthn credentials, each carrying IP and user-agent
— was stranded indefinitely. `012_cascade_user_deletions.sql` fixes all of
them. The replay test now asserts "no FK is NO ACTION" rather than a fixed
list, so a new table gaining a user FK is covered without editing the test.

## 🟠 `content_upload_enabled` was not enforced

The settings toggle was documented as the user's upload consent, and
`internal/service/content_policy.go` implemented the policy — but
`RequireContentUpload` was **never called**. Disabling content upload changed
one row and nothing else; a user could still mint presigned cover URLs through
the API.

`internal/handler/content_policy_gate.go` now gates all four entry points
(cover upload-url, cover finalize, avatar upload-url, avatar finalize).
Verified end-to-end: with the toggle off, all four return
`403 disabled_by_user`; re-enabling restores access.

Two ordering details that matter and are easy to get wrong:

- The gate runs **before** the ownership check, so a policy refusal is not also
  a "this channel exists" oracle.
- Finalize is re-checked, not just upload-url. A presigned URL stays valid for
  `STORAGE_PRESIGN_TTL_MINUTES`; gating only step 1 leaves mint→disable→
  upload open.

## 🟡 500 instead of 400 on a client error

`CreateChannel` returned `ErrChannelNotFound` for an empty or over-long
display name, and its handler had a private error switch that did not handle
it. The request fell through to the 500 default — telling the client the
server was broken for what was plainly their own validation mistake.

The duplicate switch is gone; `writeChannelError` is the single mapping.
`channel_errors_test.go` pins every error → status pair, and
`TestWriteChannelErrorNeverLeaksInternalDetail` keeps raw pg errors from
reaching the client.

## 🟡 Monitoring that looked alive and was not

| Problem | Effect |
|---|---|
| `rule_files` pointed at a directory never mounted in compose | Prometheus loaded **zero** rules. The alert pipeline was structurally incapable of firing. |
| No rule files existed at all | Now 14, in `monitoring/rules/platform.yml` |
| `nats:8222/metrics` scraped | 404 forever — NATS has no Prometheus endpoint |
| `node-exporter:9100` scraped, service did not exist | Target permanently down |
| `DiskFillingUp` / `DiskSpaceCritical` used `node_filesystem_*` | Needed node-exporter, so **permanently inert** — green-looking, never firing |

Fixed: `nats-exporter` and `node-exporter` services added, all 7 scrape targets
now up, `node_filesystem_*` returns 10 real series. Prometheus reloads without
a restart via `--web.enable-lifecycle`:

```powershell
curl -X POST http://localhost:9090/-/reload
docker exec wideo11-prometheus promtool check rules /etc/prometheus/rules/*.yml
```

> **Dashboard gotcha:** exporter v0.15.0 emits `gnatsd_*`, **not** `nats_*`. A
> panel built on the wrong prefix shows "No data" and gives no hint that the
> panel itself is wrong.

## 🟡 Container health

- `monitor`, `video-editor`, `billing`, `admin`, `analytics` had **no
  healthcheck and no restart policy**. A crash loop in any of them was invisible
  until someone noticed the site was down. All five now have both, plus memory
  limits.
- `restart: unless-stopped` added across the long-running services.
- `NewPostgresDB` now `PingContext`s with a 5s timeout. `gorm.Open` is lazy and
  never touched the network, so startup previously logged "connection
  established" and then failed on the first query — which reads like a query
  bug rather than a config or outage problem.

## ✅ Verified complete, no action needed

These were listed as open in earlier passes but are already done. **Do not
rebuild them.**

| Item | Evidence |
|---|---|
| MinIO scoped service account | Live: user `wideo11authu3Yzru…` enabled, policy `wideo11-auth-avatars`, scoped to `avatars/*` + `covers/*` only — no access to video/thumbnails |
| Security headers | Live `curl`: `x-content-type-options`, `x-frame-options`, `referrer-policy`, `permissions-policy`, HSTS |
| `VERIFICATION_BASE_URL` | Config + reachability check + `.env` wired |
| Channel edit / delete / cover UI | `channel-manager.tsx`, `cover-uploader.tsx`, plus BFF routes under `apps/web/src/app/api/channels/` |
| Rate limiting | Per-route limits, enforced |

## ✅ Phase C8 complete — rate limiting wired into auth-service

`auth-service` par pehle **koi rate limiting nahi thi**. Sirf ek limiter thi —
`apps/web/src/lib/rate-limiter.ts`, Next.js ki process memory. Woh asli
protection nahi thi:

1. **Bypassable.** Port 8085 host pe published hai. Verify kiya gaya: seedhe
   30 attempts → zero 429. Unlimited password guessing.
2. **Restart-reset.** Next.js restart saare counters wipe kar deta tha.
3. **Per-replica.** Do instances = double the documented limit.

Ab `internal/middleware/ratelimit.go` directly `auth-service` routes par hai,
Redis-backed. **Verified live: 8 attempts allowed, 9th se 429.**

### Char policies, teen keys — ek limit adhoori hai

IP-only limiting credential stuffing me **kamzor** hai: attacker 500 IPs
rotate karke ek hi account par guess karta hai, har IP apni limit ke andar
rehta hai. Isliye:

| Policy | Limit | Key | Rokes |
|---|---|---|---|
| `login` | 8 / 1 min | IP+email | narrow per-pair abuse |
| `login_sustained` | 30 / 15 min | IP+email | unlimited total |
| **`login_account`** | **10 / 15 min** | **email only** | **credential stuffing** |
| `login_ip` | 20 / 5 min | IP only | password spray |

`login_account` ki key me **IP hai hi nahi** — IP rotate karne se koi nahi
bach sakta. Ye woh rule hai jo brute force rokta hai.

Rate-limited routes: `/login`, `/register`, `/resend-verification`,
`/refresh`, `/security/pin/verify` (public 4-digit PIN check — brute-forceable
bina limit ke).

### Fail-open, jaan-boojh kar

Redis down hone par request **ALLOW** hota hai. Fail-closed matlab "Redis
down ⇒ sab login fail", jo brute-force se bade nuksaan ko ek cache outage se
badal deta hai. Degradation logged + counted.

### Case-normalisation ek real bypass hai

Bina `ToLower` + `Trim` ke `A@x.com` aur `a@x.com` alag counters hote —
attacker case badal-karke apna budget multiply kar sakta tha. Test covers it.

## ✅ NATS JetStream audit stream

Blocked attempts ab durable, queryable events hain — core NATS fire-and-forget
hota, to 3am ka attack jab koi consumer na ho to gayab ho jata. JetStream
persist karta hai, so late consumer bhi dekh leta hai.

Stream `WIDEO11_SECURITY`, 7-day retention, 256MB cap (a flood cannot fill
the disk). Publish **fail-open** — request already blocked hai, sirf event
kho sakta hai; the reverse would let an attacker who knocks NATS over also
disable rate limiting.

---

# Session 4 — Bugs found while wiring the limiter

## 🔴 Two startup panics, and a test that would have caught both

Do consecutive deploys `auth-service` ko **start hi nahi hone** diya:

```
panic: handlers are already registered for path '/api/v1/auth/verify'
panic: handlers are already registered for path '/api/v1/auth/resend-verification'
```

Dono ka reason ek: rate limit add karte waqt naya registration add kiya, purana
delete nahi kiya. Gin duplicate par panic karta hai — container nahi chalta,
port 8085 se koi connection nahi hota, aur symptom ye dikhta hai ki service
"missing" hai jabki koi process chal hi nahi raha.

`cmd/auth-service/routes_test.go` ab ye rokta hai:
- `TestMainHasNoDuplicateRouteLiterals` — `main.go` scan karta hai aur
  **resolved** path compare karta hai. Group-prefix resolution zaroori thi:
  `protected.POST("/pin/verify")` aur `secGroup.POST("/pin/verify")` dono
  literal `/pin/verify` use karte hain par ALAG routes hain. Literal-only
  scanner ne false positive diya — aur jo test jhooth bolta hai wo delete ho
  jaata hai, real protection samet.
- `TestNoDuplicateRoutes` — real gin engine pe duplicate panic karta hai.

Test khud verify kiya gaya: ek real duplicate inject karke confirm kiya ki
pakda, phir revert kiya.

## 🔴 Audit stream chup-chaap sab kuch pheka raha tha

Pehla publish attempt: `nats: no response from stream`.

Stream `auth-service.security.>` par banaya gaya tha, publisher
`WIDEO11_SECURITY.*` bhej raha tha. **Stream healthy dikha, connection up
dikhā, startup clean tha — aur har event discard ho raha tha.** Rate limiting
theek chal rahi thi, isliye kuch bhi broken nahi lag raha tha; sirf audit
trail khaali thi, aur sabse bura: koi warning nahi jo koi padhta ho.

`TestSubjectsMatchStreamFilter` ab publisher ke subjects ko stream filter ke
saath cross-check karta hai, NATS wildcard semantics ke saath (`foo.>` `foobar`
ko match nahi karta). Verified: buggy prefix par test fail karta hai.

## Mera apna verification galat tha — correction

Pehle maine 25 login attempts test kiye aur kaha "brute force lock fail". Woh
**galat tha mera apna test** — PowerShell single-quote quoting ne JSON body
tod di thi, isliye `email` extract hi nahi hua aur saare keys IP-only the.
`{"error":"invalid request"}` dekh kar bhi maine code ko saa-sa, blame
`BodyEmailCapture` par daala.

Sahi tareeka: `curl -d @file`. Uske baad:

```
login:172.19.0.1|victim@wideo11.test     = 12
login_sustained:172.19.0.1|victim@...     = 8
login_ip:172.19.0.1                      = 8
login_account:victim@wideo11.test        = 8   <-- email, no IP
```

Sikh: ek "verification fail" ko baar-baar code ki galti samajhna, jab woh
test harness ki galti ho, dono me time barbaad karta hai. Ek `{"error":"..."}`
body ko actually padhna chahiye tha — usme se pata chalta ki ye parse error
hai, credential error nahi.

Middleware ab 5 regression tests se covered hai, `TestBodyIsPreservedThroughRateLimiter`
sabse important hai — body restore nahi hui to EVERY login fail hoti, aur ye
sirf real chain (Capture → RateLimit → handler) me dikhta hai.

## ✅ Port 3001 was never actually working — three separate bugs

The page returned HTTP 200, every asset returned 200, both API routes
returned 200, and the server-rendered HTML contained the complete dashboard.
It was still visibly broken. **No HTTP-level check can catch any of the three
bugs**, because all three produced a technically-successful response.

### 1. ECharts rendered nothing — components were never registered

`packages/charts` imports `echarts/core`, which is the **tree-shakeable**
build. Unlike full `echarts`, it ships no chart types and no renderers; each
must be registered with `echarts.use([...])`. The file **never called it**.

The symptom is the worst kind — no error, no warning, no failed request.
`init()` succeeds, `setOption()` succeeds, the canvas stays blank. Six
panels, all empty, while the API returned 121–241 points each.

Also fixed in the same file: the chart was `dispose()`d and re-`init()`ed on
every option change (visible flicker at a 15s refresh), and there was no
`ResizeObserver`, so a chart initialised at 0-width stayed 0-width forever.

### 2. Tailwind was never compiled — `postcss.config.mjs` was missing

This is the one that made it look like "plain text". The shipped CSS was
**529 bytes** and contained, literally:

```css
@tailwind base;@tailwind components;@tailwind utilities;...
```

A browser ignores those directives, so the page rendered with default browser
spacing, no colours, no layout. The web app compiles to ~86KB of real
utilities; monitor stayed at 529 bytes and still returned 200.

`apps/web` hit the **identical bug** and carries a note about it in its own
`postcss.config.mjs` — this was the second app bitten, so a third should get a
shared config rather than another copy.

After the fix: **259 CSS rules parsed**, panels 549px wide instead of 1562px
(the 2-column grid now applies).

### 3. Fabricated telemetry in the layout — and it broke the page

`layout.tsx` built a fake snapshot from `Math.random()` and inlined it:

```js
console.log("Monitor telemetry snapshot: {"clusterName":"wideo11-k8s-cluster-1","cpuUsage":75.7,...}")
```

`uptime: "99.8%"` was hardcoded. `activeNodes: 14` claimed fourteen Kubernetes
nodes on a **Docker Compose** stack. This is the same invented-metric problem
removed from the telemetry panel earlier — just hidden in a `console.log` so
it looked harmless.

It also **threw on every page load**. `JSON.stringify` output was interpolated
into a JS string literal without escaping quotes, so the JSON's own `"`
closed the string early:

```
SyntaxError: missing ) after argument list @ http://localhost:3001/:1:12205
```

A parse error in an inline script on the root document is fatal to that
script. Removed entirely.

### A 404 that trained people to ignore the logs

`/favicon.ico` was missing, so every load logged an error. Cosmetic on its
own, but a monitoring tool that emits unexplained errors teaches people to
skim its logs. Added `src/app/icon.svg` (hand-rolled SVG, no binary in the
repo, reviewable in a diff).

---

## 🛠️ `tools/check-dashboard.mjs` — visual verification that actually works

Written because the three bugs above are invisible to HTTP checks. It drives
real Chrome over the DevTools protocol, waits for hydration, and inspects
**what is on screen**:

- canvas pixel content read via `getImageData` — distinguishes "chart drew"
  from "container exists"
- whether the CSS **layout engine** applied utilities, rather than whether the
  stylesheet returned 200 (the check that would have caught bug 2 immediately)
- canvas width, to detect a collapsed grid
- uncaught exceptions **with URL and line number** — the bare
  `SyntaxError: missing ) after argument list` said nothing; the location
  pointed straight at the inline script
- remaining `Loading metrics…` and empty panels

```powershell
node tools/check-dashboard.mjs http://localhost:3001/ --out dash.png
```

Exits non-zero on any of these, so it can be a CI gate. Current output:
`OK: dashboard rendered with styling, grid and data.`

### The lesson worth keeping

Four separate "verifications" of port 3001 passed while it was visibly
broken — 200 response, 10/10 assets, 2/2 APIs, 6 charts with real pixels.
What finally worked was rendering the page and *looking* at it, plus asking
the layout engine a question instead of the network.

A check that returns "OK" because it verified the wrong thing is worse than no
check, because it replaces looking.

---

# Session 5 — Thin scrollbars, and the superadmin flow that did not work

## ✅ 2px scrollbars, project-wide

`packages/ui/src/styles/scrollbar.css` — **ek shared file**, teen jagah
copy-paste nahi. Teen alag copies hoti to design drift hota: koi app update
bhool jaata, aur UI me ek mota scrollbar wapas aa jata.

`::-webkit-scrollbar { width: 2px }` — Chromium aur Safari me pencil-thin.
**Firefox me ~8px rahega**, aur ye jaan-boojh kar hai: Firefox ka native
minimum `scrollbar-width: thin` hai, aur usse 1px karne ka koi standard tareeka
nahi hai. Browser chhupane se behtar ye hai ki user ko pata ho.

`postcss-import` dono apps ke postcss config me add kiya. Iske bina
`@import` production bundle me file shamil nahi hoti — koi error nahi, bas
styling chup-chaap gayab. Aur `@wideo11/ui` ke `exports` map me
`"./styles/*"` entry zaroori thi, warna deep import **block** ho jata tha
(webpack build error).

### Ek honest negative

`tools/check-dashboard.mjs` me scrollbar assertion DAALA, aur wo **hamesha
fail** ho raha tha. Investigate kiya: headless Chrome custom scrollbar styling
ko bilkul honour nahi karta. Probe me `::-webkit-scrollbar` seedhe us
scrolling element pe inject kiya, aur `scrollbar-width:thin` alag se — dono
ka gutter 15px hi raha. Universal selector seedhe selector se kam nahi ho
sakta, isliye mera "CSS apply nahi hui" wala conclusion galat tha.

Assertion hata diya, sirf report karta hai. Jo check hamesha fail hota hai
use koi serious nahi rakhta — aur usse rehne dene ka matlab hai ki asli
failures bhi ignore hone lagein.

### 3000 par webpack error

`@wideo11/ui/src/styles/scrollbar.css` import karne se web dev server fail
hua. Wajah: `packages/ui/package.json` ka `exports` field ek explicit
allowlist hai, aur `src/styles/*` usme nahi tha. Node/webpack deep imports
block kar deta hai. Entry add karke fix kiya.

---

## 🔴 Superadmin flow: 3 bugs, dashboard tak pahunch hi nahi sakta tha

### 1. Master root ka `users.role` `user` hi rehta tha

`RegisterMasterSuperadminRole()` sirf `superadmin_accounts` me row banata
tha. Par authz **`users.role`** se chalti hai:

- login JWT ka `role` claim `users.role` se banta hai
- `RequireSuperadmin()` wahi claim padhta hai

Matlab master root login karta, uska token `role:"user"` carry karta, aur
**har superadmin endpoint 403 deta**. `superadmin_accounts` row hone se kuch
nahi hota — wo table provisioning track karti hai, authorization nahi.

Worse: log line `Master root registered with superadmin role` bol rahi thi
jabki actual role `user` tha. Jo log galat success bataye, wo debugging se
zyada mushkil hota hai.

Ab `users.role` ensure hota hai (idempotent, har startup).

### 2. Password rotation — env var set karne se kuch nahi hota tha

`bootstrap.DefaultSuperadminPasswordHash` **source me compiled** hai. Matlab
repo wala koi bhi bcrypt-crack kar ke master-root ka password test kar
sakta hai — default password effectively public.

`SECURITY_SUPERADMIN_PASSWORD` override ka raasta code me documented hai, par
wo **kaam hi nahi karta tha**: hash upar derive hota tha, par existing user
ke liye kabhi DB me likha nahi jaata tha — sirf naya account create karte
waqt. Isi liye env var set karne par bhi password nahi badalta.

Fix, ek guard ke saath:

```
stored == built-in default  ->  env password apply karo
stored != built-in default  ->  chhodo (insaan ne rotate kiya hai)
```

Guard zaroori hai: bina uske admin app se password badalta, restart hota, aur
uska change chup-chaap revert ho jata.

**Ye default hash ab bhi source me hai.** Ek baar `SECURITY_SUPERADMIN_PASSWORD`
set kar diya gaya hai, to account default se aage nahi gaya. Par hash repo me
hono repo me hai — rotate karne ka matlab ye NAHI ki wo safe ho gaya, sirf
itna ki wo ab active nahi hai. Production me `DefaultSuperadminPasswordHash`
ko bhi replace karna chahiye.

### 3. Doc comment me galat path

`awareness.go` ka header `/api/v1/admin/registrations` likhta tha. Asli
prefix `/api/v1/auth/admin/` hai (group `auth` ke andar banta hai). Maine
khud isi comment padh kar galat path test kiya aur 404 mila.

404 aur 403 bilkul alag hain — 403 = "access nahi mila", 404 = "route hai hi
nahi". Documentation authorization surface ka hissa hai, isliye sahi honi
zaroori hai.

### Verified end-to-end

| Check | Result |
|---|---|
| Superadmin login | 200 |
| Brand-new user registered | 201, `users` + `user_registrations` dono me |
| **Naya user `/auth/admin/registrations` me?** | **YES** |
| `/auth/admin/awareness` | 200 — `total_users`, `signups_by_day`, `by_device`, `by_browser`, `by_os`, `by_country`, `by_continent` |
| Normal user same endpoint par | **403** (correctly denied) |

---

## 📍 Ports — kahan kya hai

| Port | App | Kya dikhata hai |
|---|---|---|
| **3000** | web | Main app. Host pe `pnpm dev` se chalta hai |
| **3001** | monitor | **Wideo11 monitoring dashboard** — Prometheus se real metrics |
| 3002 | video-editor | |
| 3003 | billing | |
| **3004** | **admin** | **Superadmin dashboard — naye users yahan** |
| 3005 | analytics | |
| 8085 | auth-service | API (health: `/health`) |
| 9090 | Prometheus | Targets, rules, alerts |

### Naye user ki activity kahan dikhegi

| Kis baat ke liye | Kahan |
|---|---|
| Naya user register hua | **3004** → registrations list, ya `GET /api/v1/auth/admin/registrations` |
| Total users, signups/day, device/browser/OS/country breakdown | **3004** → `GET /api/v1/auth/admin/awareness` |
| Click/activity stream | `click_events` table → superadmin analytics |
| Infra metrics (CPU, disk, DB) | **3001** |

**Superadmin login:** http://localhost:3004

---

---

# Session 6 — The security-gate loop, and 3005

## 🔴 The reported bug: complete the gate → bounced back to PIN

User's report: "saare mandatory security steps complete karke dashboard me land
nahi ho rha, wapas security PIN par aa raha hai."

**Do alag bugs the, dono ek saath, dono real:**

### 1. The middleware cached the NEGATIVE result

`apps/web/src/middleware.ts` cached `setup_complete` per user for 10s —
**including `false`**. That produces a guaranteed loop:

1. Gate completes. Backend correctly returns `setup_complete: true`.
2. Gate calls `window.location.href = '/dashboard'`.
3. Middleware reads the **cached `false`** (TTL not expired) → redirects
   back to `/auth/security-setup`.
4. Gate remounts, sees `true`, navigates to `/dashboard` → step 3.

It looks intermittent because after ~10s the TTL expires and the user gets
through. It is not intermittent; it is a loop with a 10-second period.

**The rule now: only `true` is ever cached.** A `false` is a *blocking*
decision — caching it makes the block self-perpetuating, because the stale
value keeps re-enforcing itself. A `true` is a *permissive* decision; if it
were ever stale, the cost is a few extra seconds before the user reaches the
dashboard, which is harmless.

### 2. There was NO escape hatch when biometrics "were supported"

The skip button rendered only in the `!biometricSupported` branch. So for a
user whose browser *claims* a platform authenticator but whose sensor never
responds — or who cancels the OS dialog, or who never enrolled Touch ID —
`biometricSupported === true`, so **no skip button existed at all**. The user
was stuck on step 3 with no way forward and no error message.

A skip affordance now renders in **both** branches. When support is claimed
it reads "This isn't working — skip biometric", because that is the situation
the user is actually in. The handler is shared, not duplicated — the two
copies of that logic diverging is what produced this bug.

Security is unchanged: skipping does not enrol anything; the backend records
the decision in `security_profiles.biometric_opted_out` and the completion
rule counts it as satisfied. PIN and security questions remain mandatory.

### Verified in a real browser

`tools/e2e-user-journey.mjs` drives Chrome through the whole journey and
samples the URL every 2.5s for 15s to prove the loop is gone:

```
1. create account (API) + mark verified      HTTP 201
2. log in (real form)                        -> /auth/security-setup
3. PIN          -> questions -> biometric
   "This isn't working — skip biometric"
   after skip -> /dashboard
4. sampled every 2.5s: /dashboard x 6
   bounces back to security-setup: 0
   RESULT: PASS
```

Also confirmed: `security_profiles` reads `pin=true questions=true
opted_out=true complete=true` in the DB — the backend was always right; only
the browser-side loop was broken.

**Why this needed a browser test.** Every API-level check passed while the
flow was broken: `POST /pin` 200, `PUT /questions` 200, `POST /biometric/skip`
200 returning `setup_complete: true`, `GET /setup-status` 200 returning
`setup_complete: true`, and the DB agreeing. The bug lived entirely in a
redirect between two working endpoints.

## 🔴 Email verification 404 — stale IP

`VERIFICATION_BASE_URL` was `http://10.121.186.95:3000`, an IP from a different
network. The machine's actual address is `192.168.31.81`, and the stale IP times
out entirely (curl exit 28). Every verification email pointed at a dead host,
so **no user could ever verify their email**, and since login is gated on it,
no new user could get past registration.

Fixed to `http://localhost:3000`. The `/auth/verify` page and its
`/api/auth/verify` BFF proxy both already existed and work.

Verified end to end: register → open the link → 200 → `verified: true` →
`is_verified = t` in the DB → login 200 → session works → logout invalidates
it (401).

## ✅ 3005 Analytics — same three classes of bug, plus fabricated data

| Bug | Detail |
|---|---|
| No `postcss.config.mjs` | Third app with this. Shipped CSS was 529 bytes of raw `@tailwind` directives. |
| `layout.tsx` never imported `globals.css` | Zero `<link rel=stylesheet>`, zero CSS rules, every Tailwind class a no-op. |
| Six "unavailable" stubs | `page.tsx` defined inline stubs claiming "the module is not present". It was present — the stubs hid it. |
| **All six panels were fabricated** | 1.2M views, 3.4K creators, $45.2K revenue, five named creators with subscriber counts. Zero `fetch` calls anywhere. |
| Dockerfile clobbered workspace links | `COPY apps/analytics ./apps/analytics` wiped the deps-stage `node_modules`, breaking `wideo11-charts`. |
| `packages/auth` imported `@wideo11/api-client` | Package is actually `wideo11-api-client`. Pre-existing; broke any consumer. |

**What replaced the fake data:** one server-side `/api/analytics` route that
forwards the caller's own token (never an admin credential in the browser) to
the superadmin awareness endpoints. Panels now show real counts, and anything
not instrumented — views, watch time, revenue, retention curves, payouts — is
labelled as such instead of being filled with plausible numbers.

Revenue shows no figure at all, and says why: it lives in billing-service and
this app has no route to it. Inventing a substitute there would have been the
worst possible choice, since revenue is the number people make decisions on.

Verified with real data: 5 users, 3 registrations, 100 click events, and the
superdashboard shows them.

## 🟡 DiskFillingUp fired with 62 GB free

The prediction said −46.7 GB. Cause: Prometheus had **2 samples** for that
metric, and `predict_linear` was fitting a line through two points — noise,
not a trend. Separately, this session's own `--no-cache` rebuilds had left
**31.6 GB of build cache** (pruned), which is what actually moved the disk.

Rule now requires `count_over_time(...) > 100` (~1.7h of real history) before
it will predict anything, and uses a 24h window so a build burst is diluted
rather than read as a sustained rate. An alert that predicts from insufficient
data is worse than no alert, because it states a confident falsehood.

Disk is stable at 62.6 GB free, 0 GB change over 25 minutes.

## A correction I had to make

My first `e2e-user-journey` run "passed" nothing useful: it drove the
register form with synthetic input events, which do not satisfy React's
password-strength validation, so the form silently refused to submit. I read
that as a product bug and went looking. It was a bug in my test.

Registering through the API (201, user row created) is what registration
actually is, and it works. Only the post-login flow is the reported problem,
so that is what the browser drives.

---

# Session 7 — All six frontends

> Started from "jo remaining frontend hai unka dashboard sahi karo". Audited all
> six first, because the same bug had already appeared in three of them and the
> pattern was predictable.

## The audit that found everything

| App | Port | postcss | globals imported | Verdict |
|---|---|---|---|---|
| web | 3000 | yes | yes | OK |
| monitor | 3001 | yes | yes | OK |
| **video-editor** | 3002 | **MISSING** | yes | **unstyled** |
| billing | 3003 | yes | yes | OK |
| **admin** | 3004 | **MISSING** | yes | misconfigured, happened to work |
| analytics | 3005 | yes | **MISSING** | unstyled |

Two more apps needed `postcss.config.mjs`. **Five of six** have now needed it,
which makes it a pattern rather than an accident — the fix belongs in a shared
config at the repo root, not a sixth copy.

`admin` was the instructive one: it rendered 140 CSS rules and *looked* fine,
so a quick check would have skipped it. Something in its build path compiled
the directives by luck. "It looks right" is not "it is configured" — the file
is there now so the next build-path change cannot silently drop the styling.

## 🔴 video-editor: three components were stubs or broken

### 1. Every panel rendered twice

`sidebar.tsx` rendered each panel in **both** `TabsContent` *and* a manual
`{activeTab === 'x' && <X />}`. The media list appeared stacked on itself with
the tab labels overlapping the second copy. Radix Tabs already renders only the
active content, so the manual block was both redundant and the source of the
duplication. Each duplicate also mounted its own state, so selecting a
thumbnail in one did nothing to the other.

### 2. `TimelineTracks` was a literal stub

```tsx
export function TimelineTracks(props: TimelineTracksProps) {
  return <div>Timeline Tracks</div>;
}
```

Sixty-six lines, full prop types, no implementation. There was no timeline. The
surrounding `TimelineEngine` was also constructed on a store where every method
was `() => {}`, so even the parts that did render had nothing to show.

### 3. Invalid CSS, so the media bin overflowed

`h-[calc(100%-140px)]` is not valid CSS — `calc()` requires spaces around the
operators. The class was silently dropped, the ScrollArea had no height, and
the grid laid out at natural size and spilled horizontally out of its column.
This, not the images, is what made the list look like spilled garbage.

### 4. Broken images and invented media

Every tile pointed at `/placeholder-video-1.jpg` and friends. Those files do
not exist, so each tile rendered a broken-image glyph plus its alt text. Under
that sat a hardcoded array of eight fake items with invented durations —
presented as the user's own library.

## ✅ What the editor is now

A real, functional NLE — verified by `tools/check-video-editor.mjs`, which
imports a **real file** and clicks it, then asserts a clip actually lands:

```
baseline:  405 css rules, 0 broken images
import:    "Sample Clip.mp4" tile appears, 0 broken images, 0 overflow
click:     clipCount 1 — "Sample Clip.mp4 · 0:05"
           track headers present, readout "0:00 / 0:30"
RESULT: PASS
```

- **Media bin** — real file input, object-URL previews, duration read from
  media metadata (with a 4s timeout, so one corrupt header cannot pin a
  permanent spinner), all blob URLs revoked on unmount, type filters, search,
  per-tile remove. An empty state that says so instead of showing fake media.
- **Timeline** — three lanes (Video/Audio/Text) with per-track mute, hide and
  lock; clips positioned by **pixels-per-second, not percentage**, so a 3s clip
  and a 30s clip stay proportional to time (a percentage-based timeline stops
  being a time axis the moment the window resizes); click to select, trash or
  Delete to remove, click empty lane to seek, zoom −/+, playhead, time readout.
- **Wiring** — the same click that imports media adds the clip. State lives in
  the editor shell, so the bin, timeline and preview read one source of truth.
- **Layout** — preview `flex-[3]`, timeline `flex-[2]`. `PreviewCanvas` renders
  `<Card className="h-full">`, which in a flex column means "take everything",
  collapsing the timeline to zero height. The timeline was in the DOM and
  testable but had no room to be seen.

Blob URLs are labelled session-scoped. A real upload endpoint is deliberately
not faked — that means multipart, resumable chunks, progress and auth, a
project of its own, and worse than nothing if half-done.

## Verified state

| Check | Result |
|---|---|
| Containers | 27, all healthy |
| Ports 3000–3005 | all HTTP 200, CSS compiled in all six |
| video-editor | import → click → clip on timeline, verified in browser |
| User journey | register → verify → login → gate → dashboard, 0 bounces |
| Go build / vet / test | clean, 7/7 packages |
| Migrations 001→012 | replay clean and idempotent |
| Secret audit | clean |
| Brute force | 8 attempts then 429, per-account keyed on email |

---

# Session 8 - 3002 rebuilt to Movavi's actual structure

> The user supplied the Movavi product link after saying the editor "doesn't
> look like Movavi". They were right. The earlier version shared a *vibe* with
> a video editor; it did not share Movavi's architecture.

## What was structurally wrong

| | Movavi (verified from their docs + product page) | Before this session |
|---|---|---|
| **Timeline** | **full width, bottom half** | **confined to the right column** |
| Left mode rail | separate icon strip, one per creative mode | merged into the bin's tab list |
| Player controls | **below the preview** | toolbar across the top of the editor |
| Clip trimming | drag clip edges | **absent** |
| Split / blade | primary edit, first-class | **absent** |

The full-width timeline is the defining feature, and getting it wrong is not a
styling miss - it changes how the tool works. A timeline's width *is* its
value: a clip whose end you cannot see is a clip you cannot cut precisely.

## Now matching Movavi

```
+--------------------------------------------------+
| File  Edit  Clip  View  Playback                  |  menu bar
| [icons: undo redo | cut copy del | snap | ...]   |  toolbar
+----+----------+----------------------------------+
|rail| media bin|  preview                         |  top
|    |          +----------------------------------+
|    |          |  player controls                 |  under preview
+----+----------+----------------------------------+
|              timeline (FULL WIDTH)                   |  bottom
+--------------------------------------------------+
```

- **Menu bar** - File / Edit / Clip / View / Playback, each item showing its
  keyboard shortcut. Menus close on outside click, Escape, or activation, and
  hover-switches once one is open. Keyboard-reachable via F10.
- **Icon-only everywhere.** No name sits next to any icon. Each tooltip
  answers three questions, not one: what it is called, what it does, and how to
  use it ("Blade - Cut the clip under the playhead into two / Shortcut: S").
  Every icon also carries an `aria-label`, so it is not invisible to a screen
  reader - asserted in the test (`railButtonsNamed`).
- **Modes that do not exist yet are disabled with a dot**, not drawn as if they
  work. Nine grey squares that silently do nothing are worse than eight honest
  ones.
- **Trim** - drag either clip edge, with a `MIN_CLIP` floor so a drag past the
  other edge cannot produce a negative-length clip.
- **Blade** - split at the playhead (`S`); both halves keep their `mediaId` so
  each stays a real reference to the source.
- **Player bar under the preview** - timecode, prev frame, play/pause, next
  frame, volume, real Fullscreen API (Esc exits for free; a CSS "fullscreen"
  does neither).

## Two real bugs found while testing

**1. `laneRef` was never attached to any element.** It was created and read by
`timeFromEvent`, but no element carried `ref={laneRef}`. So `laneRef.current`
was always `null`, `timeFromEvent` always returned `0`, and **clicking anywhere
on a track lane seeked to the start of the timeline** instead of where you
clicked. The seek "worked" - just always to the same wrong place - which is why
it survived a build, a screenshot and several rounds of visual review.

**2. The resize was inverted.** The media bin's handle sits on the panel's
**right** edge, so dragging right should widen it. It had an `invert` flag
making it shrink instead. The timeline handle sits on the **top** edge, so that
one genuinely needs `invert`.

The rule is now written at the call site:

    handle on the panel's RIGHT edge -> no invert
    handle on the panel's TOP  edge -> invert

## A test that was asserting the bug

My resize test dragged the bin handle **left** and asserted it grew - which only
passed *because* the panel was inverted. The test and the bug were cancelling
out, so the suite reported green on broken behaviour. It now drags **right**
and asserts growth, so flipping `invert` fails the test instead of shipping.

Same class of error as earlier in this project: a check that returns OK
because it verified the wrong thing.

## Verified

    modeRailIcons 10 . railButtonsNamed true . playerBar true
    menuCount 5 . toolbarGroups 5 . trimHandles 2 . brokenImages 0
    drag bin  300->380 (right = wider)   drag timeline 300->390 (up = taller)
    clamp: floor 200==min, ceiling 480==max
    trim out-edge 450->510 . blade split 1->2 clips
    RESULT: PASS

27 containers healthy.

## Movavi features: status as of Session 12

This list was written when moving clips and transitions did not exist. Every row
below is now either **built and verified** or **still open with a stated
reason**. It is kept rather than deleted, because "what does this editor NOT
do" is the more useful half of the answer.

| Feature | Status |
|---|---|
| Move clips along the timeline | **Built** - drag the body; across lanes as well as along one, with a drop-target ring |
| Transitions between clips | **Built** - 11 types, rendered live, editable from their badges |
| Overlay / picture-in-picture track | **Built** - add a second video lane, then pick a layout; the matrices come from the stock resources |
| Audio waveforms on clips | **Built** - decoded peaks, cached; a file the browser cannot decode draws a flat line rather than a fake squiggle |
| Audio track split (linked vs independent) | **Built** - lanes are added at runtime, and clips on two lanes can be linked so they move together |
| Filters / LUTs / colour correction | **Built** - 15 grades read out of the stock Effect::ManualEnhance files, plus manual sliders |
| Undo / redo | **Built** - and redo survives a page reload, because the future stack is part of the saved project |
| Clip properties dialog (speed, opacity, volume) | **Built** - speed, opacity, volume, fades, colour, position, fit, size, rotation and text styling |
| Frame-accurate editing | **Built** - every position is an integer frame at 24/25/30/50/60 fps |
| Ripple trim, roll, slip, slide | **Built** - toolbar buttons as well as shortcuts |
| Markers | **Built** - M to drop one, comma and period to step between them |
| Persistent workspace across refresh | **Built** - zoom, scroll, panel sizes, lane heights, fps, snapping, theme, playhead and more |
| Silence removal | **Built** - RMS windowing in the browser; no model, no upload, no cost |
| Auto-subtitles, stabilisation, chroma key, motion tracking, slow motion | **Still open** - each has a disabled mode in the rail with the reason in its tooltip |
| Drop-frame timecode | **Still open** - needs a real drop-frame table per rate; the colon form shown is the correct non-drop standard |

The two that mattered most at the time - **moving clips** and **transitions** -
were the first two rows, and they are done.

---

# Session 9 — Timeline precision, multi-select, recording, local AI

> Constraint given: **no third party may ever be paid a penny.** Every "AI"
> feature below therefore runs in the browser, on the user's own machine, with
> no key, no quota and no upload.

## Frame-accurate timeline

`FPS = 30` is a single exported constant, and everything derives from it.
Timecode is `HH:MM:SS:FF`, not seconds — at 30fps a clip you believe is 2.0s is
60 frames, and `0:02` cannot tell you whether it is 2.000 or 2.033.

- Ruler ticks step by a power-of-two **frame** count, with a hairline per frame
  below a 5-second label step. You can see where frame 47 is.
- Arrow keys scrub one frame (ten with Shift). That is the only way to land the
  playhead on an exact frame without a mouse.
- Snapping (`snapToFrame`) is applied on every seek, trim and placement.
  Without it a cut made on a fractional frame yields a clip one frame longer
  than the picture it was cut from.

## Multi-select, select-all, delete, restore

Selection is a `Set<string>`, not a nullable id — a single id cannot express
"three clips", so every consumer would re-derive membership elsewhere.

- **Marquee**: drag on empty lane space. Click and drag are told apart by a 4px
  movement threshold, not by a modifier, because 4px of trackpad jitter is not
  an intention to select.
- **Shift-drag** adds to the selection; a plain drag replaces it.
- **Ctrl+A** selects all, **Del** deletes all selected in **one** undo step,
  **Ctrl+Z** restores them.

Undo stores **snapshots of the track list**, not inverse operations. A restore
is then one assignment and cannot be wrong — the failure mode of "undo the
split" being computed separately is that the two implementations drift and undo
produces a project that never existed. Bounded to 50 entries, because this is
browser memory.

## Status footer at the very bottom, 20px, height-only resize

It was inside the timeline pane, so it scrolled away with the tracks and jumped
whenever the timeline was resized. Now it is pinned below everything, outside
the resizable pane, and resizes in **height only** — a status strip has no
horizontal extent, and offering a horizontal drag would imply a behaviour that
does not exist.

## The player no longer shrinks when the timeline is resized

The preview is `min-h-0 flex-1` and absorbs the leftover space, while the
handle moves the *timeline's* height. Growing the timeline shrinks the preview;
it never pushes the footer off screen.

## Camera and microphone recording

`getUserMedia` + `MediaRecorder`, both browser APIs. Camera and mic are
**separately** toggleable, because a voiceover should not carry a stray camera
track.

The flow is deliberately three states, and there is **no path from recording to
the bin that skips review**:

```
idle -> recording -> REVIEW -> (keep | discard) -> idle
```

A take is not free to redo — wrong framing, a cough, the cat. REVIEW loads the
clip, plays it, and requires a choice. Camera hardware is released the moment
recording stops, so the LED goes off rather than staying lit through review.

## "AI" that costs nothing — and why it isn't a model

**Silence removal** is signal processing, not AI: measure 20ms-window RMS,
threshold it, find quiet runs longer than 350ms, drop them, write a WAV. That is
a few hundred lines of arithmetic in `lib/audio/silence.ts` and it costs nothing,
works offline, and never uploads the user's audio anywhere.

Every product selling "AI silence removal" either runs exactly this DSP or runs
a model server-side and bills per minute. The first is what is built here. Where
a real model would genuinely help is content-aware speech detection —
distinguishing a pause from a whispered word — and that is an explicit later
decision, not a silent dependency.

Defaults are chosen and explained: −45 dBFS (≈0.0056) sits at a decent mic's
noise floor; 350ms is below the gap between words, so cutting shorter makes
speech sound clipped; 80ms of edge pad avoids the click you get from trimming
hard to the first sample. The UI reports how much came out — **0% removed is a
legitimate answer** and means the threshold is wrong for that recording.

Decoding resamples to a fixed rate via `OfflineAudioContext` and downmixes to
mono. Per-channel RMS would read half the amplitude and make everything look
quiet, and a 44.1k vs 48k source would otherwise make every cut 9% early.

## A layout bug the tests caught

The editor was `h-[calc(100vh-4.5rem)]`, reserving 72px for an app header that
does not exist in this layout. So the status footer sat above a band of empty
page. A check measuring the footer against the **viewport** caught it; a check
against the editor's own height never would have.

## Verified

```
frameRuler true · footerAtBottom true · footerIs20px true
blade split 1 -> 2 (TC 00:02:25)
select all 2 -> delete 0 -> undo 2 (restored)
trim out-edge 450 -> 510 · resize both directions · clamps at min and max
RESULT: PASS
```

27 containers healthy, 7/7 Go packages pass.



---

# Session 10 - The remaining editing features

> Continued from the "not built" list in Session 9. Everything below is
> implemented and verified in a real browser, not asserted.

## Clip repositioning - drag to move

The gap that made the editor feel incomplete. Move is a **separate gesture
from trim**, deliberately: they change different things (position vs
duration), and combining them makes a clip silently change length when the
user only meant to nudge it.

- A **3-frame movement threshold** before the drag commits, so the click that
  also selects does not nudge the clip by a frame.
- Drag feedback is **preview-only**; the committed change and its undo entry
  happen on pointerup. An abandoned drag leaves no history.
- **Snapping** (`N` toggles) to the playhead, every other clip's start and end,
  and zero, within an 8px threshold. The frame grid is deliberately *not* a
  snap target; that would fight the frame ruler for the same gesture.

## Video thumbnails - a real decoded frame

`<img src={blobUrl}>` cannot work: a browser will not render a video as an
image. That is why every tile showed a broken-image glyph.

`lib/media/thumbnail.ts` seeks a hidden `<video>` to 10% of its duration and
copies the frame out of a `<canvas>`.

- **Time-boxed at 1.5s.** `seeked` does not always fire - files with no index
  (webcam captures, `MediaRecorder` output) can decode the first frame and
  never settle. A thumbnail that never appears is worse than a generic one,
  because "still loading" and "broken" look identical.
- **Off-screen, not `display:none`.** A `display:none` element may never be
  decoded at all, which is a well-known way to get a permanent no-op.
- **Deduplicated by URL** with shared in-flight promises, and stored as a
  320px data URL - not a second copy of the video, which would be a memory
  leak wearing a helpful name.
- Seeks to the 10% mark, not 0:00, because the first frame is often black or
  mid-fade.
- Applied **lazily** - the clip is added immediately and the poster fills in
  behind it. Awaiting the decode first meant the clip appeared seconds later
  on a long file.

If extraction fails, the tile falls back to a **drawn** gradient keyed off the
filename - never a path to a file that does not exist, which is what produced
a field of broken glyphs.

## Hover a clip -> it plays

The hard part is not playing it, it is **restoring what was playing**:
previous source, previous time, and whether it was playing at all. Without all
three, hovering pauses your timeline and leaves it paused when you move away -
worse than not having the feature. Each clip now carries the media's own `url`
alongside the small `poster` data URL, because pointing the player at the
poster would show a still, not motion.

## Redo

`history` alone cannot support redo - undoing pops the present onto nowhere.
Added a `future` stack, cleared on any new edit (standard, and the only
behaviour users find unsurprising). `Ctrl+Shift+Z` and `Ctrl+Y`.

## The bug that made undo look like it worked

Undo ran, the history shrank, the toast said "Undone" - **and nothing moved.**

The cause: `setHistory` was being called *inside* a `setTracks` updater. React
is free to invoke an updater more than once (StrictMode does it deliberately).
On the second invocation `prev` was already the *new* state, so the "before"
snapshot captured the new state and undo restored the new state.

Every observable signal said success. That is the worst shape a bug can have,
and it is the same family as the resize test that was asserting its own bug.
All three state setters are now driven from values read in the render, with
React's batching doing the pairing.

## Verified

    trim out-edge      450 -> 510
    blade split        1 -> 2 clips (TC 00:02:25)
    select all 2 -> delete 0 -> undo 2 (restored)
    drag to move       148 -> 403  (moved 255px)
    undo/redo          403 -> 148 -> 403  (both work)
    resize both ways, clamps at min and max
    RESULT: PASS

27 containers healthy, 7/7 Go packages, secret audit clean.

# Session 11 — the editor's own engine

> Date: 2026-09-29
> Every item below was driven through the real interface in a real browser
> against a real MP4, a real WAV and a real PNG generated by ffmpeg. The
> harness is `tools/check-video-editor.mjs` — **52/52 checks pass**, and the
> screenshots it writes are the ones this section is describing.

The previous session's "Still not built" table had eight rows. All eight are
now built. What follows is not a list of features; it is the list of things
that were *wrong* and had to be fixed to get there, because those are the
parts a reader cannot infer from the code.

## The premise changed: one compositor, two consumers

Before this session the preview pointed a single hidden `<video>` at whatever
was last hovered. It could show exactly one clip, which is why the table above
said transitions and export "need a compositor". They did. There wasn't one.

`lib/engine/compositor.ts` is that compositor now. It draws the project at an
instant onto a canvas, and **the preview and the exporter drive the same
instance's code** — the export path does not re-implement anything, it renders
the same picture into a capture stream. There is therefore no class of bug
where the preview looks right and the file is wrong.

That one decision unlocked, with no further argument:

| Feature | How it falls out of the compositor |
|---|---|
| Transitions | a second scratch canvas, blended per transition type |
| Picture-in-picture | a second video lane, drawn with its own opacity/size/corner |
| Colour filters | `ctx.filter` from the grade on the clip |
| Pan & zoom | a scale drift across the clip's own duration |
| Titles & stickers | text drawn on the same pass, above the picture |
| Speed | the source time the playhead implies, per frame |
| Export | `canvas.captureStream()` + the existing Web Audio graph |

## Resources, actually read rather than retyped

`apps/video-editor/src/app/resources/samples/stock/**` contains real Movavi
effect definitions. `tools/gen-editor-resources.mjs` extracts them into one
typed module, and the panels read that:

- **15 colour grades** — the real `Effect::ManualEnhance` values, with
  `highlights`/`shadows`/`gamma`/`tint` folded into the nearest CSS operator
  (the mapping is written out in the generator, so what was discarded is
  visible rather than assumed).
- **21 pan-and-zoom presets** — the two-keyframe `Envelope::TransformationPreset`
  envelopes, read as a start zoom, an end zoom and a pan.
- **9 picture-in-picture layouts** — straight off each `Effect::PictureInPicture`
  affine matrix.
- **15 audio effects** — real Web Audio node graphs built from each file's own
  parameters. A gate's `threshold` is a `DynamicsCompressor` threshold, a
  radio's `lBound`/`rBound` are a band-pass, an echo's `echos[0].time` is a
  `DelayNode`.

The bundled *title themes* are deliberately **not** offered: each points at
`resourcePath: "#DOWNLOADABLE_PATH#/…mpack"`, a package that is not in this
repository. A button that always fails to download is worse than no button, so
the panel says how many were skipped and why.

## Transitions

Eleven types, all real: crossfade, dip-to-black, fade-to-white, four wipes, two
slides, circle-open, zoom-through.

They are a property of the **join**, not of either clip — a transition stored on
a clip travels with it when the clips are reordered and then sits on a boundary
that no longer exists. During a transition the outgoing clip is *held past its
own end* for the transition's length, so applying or removing a transition never
moves a single frame of the edit underneath it. The audio follows the picture:
an audio crossfade has both takes audible at once, or it is a crossfade in
picture and a hard cut in sound.

## The bug that silently split a clip about once a second

`setBlade(bladeAtPlayhead)` stored a function in `useState`. React's
eager-state optimisation **invokes a function passed to a state setter** to see
whether the state actually changed, before deciding whether to re-render. So
the setter did not store the blade — it *ran* it, passing the previous state
as an argument, and the blade cuts whatever clip is under the playhead.

The symptom pointed nowhere near the cause. The timeline looked like it had a
few extra clips, and every "why is there a second copy of this?" answer led
somewhere else: the duplication was in the *model*, ids were minted by three
different call sites, and the clip count crept upward across unrelated
operations. It was found by instrumenting `nextId` to log its own stack, which
is why `nextId` exists as a named function rather than an inline template.

The blade is now a **ref**. That is also the right shape for an imperative
handle that changes on every playhead tick.

## The ruler was 178 pixels out of step with the clips

The ruler owned an `overflow-x-auto` of its own and began at the pane's left
edge. The lanes began 178px later, under the track-header column. Nothing
errored; the ruler simply described a different timeline from the one under it:

- ticks never lined up with the clips they labelled,
- clicking the ruler at 5 seconds seeked to 3,
- dragging a loop handle moved a different distance than the pointer did.

The ruler, the lanes and the playhead now live in **one horizontally scrolled
strip** with the header column as a sibling. They share an origin by
construction, so they cannot disagree. The track headers and the lanes are
still two columns, so their vertical scroll is mirrored explicitly.

## The container was building a different editor than the workspace

A hydration error on every page load, with nothing to find it by: a minified
`React error #418` and then a full client re-render.

Every app image runs `pnpm install --shamefully-hoist`, which flattens the whole
workspace into one `node_modules` and lets the first writer win each package
name. Four apps pin four different `lucide-react` versions (0.321 / 0.400 /
0.428 / 0.454); the hoisted copy was **0.321.0** while the editor declares
0.400.0. So the image rendered a *different editor* — visibly: the Save icon
in the toolbar was the old glyph — and hydrated a tree the client bundle did
not expect.

Fixed at the root rather than worked around: the root manifest now declares
`lucide-react` so the hoisted copy is the one the editor asks for. The
workspace and the image build the same thing now, which is the property that
actually mattered and the one that was missing.

## The light theme was a white page around a dark editor

Adding a theme toggle to panels written with literal `bg-slate-900` produced
exactly that: `document.body` white, the toolbar still `rgb(15,23,42)`.

Every surface is now one of five roles — workspace, raised panel, overlay,
border, text — named `--ve-surface`, `--ve-text-primary` and so on, and mapped
to Tailwind classes. The `ve-` prefix is load-bearing: the shared theme's tokens
are HSL channel triples consumed as `hsl(var(--x))`, and feeding one to
`rgb(var(--x))` is not a missing variable but a **valid colour of the wrong
kind** — `rgb(217.2 32.6% 17.5%)` parses, clamps and paints dark red, which is
exactly what every border in the editor did on the first attempt.

Both themes are now screenshotted by the harness on every run, because a theme
that has only ever been checked in dark is a theme with white-on-white
somewhere in it.

## Overlapping clips used to be drawn on top of each other

Two clips on one lane at the same time rendered on top of each other, so their
names collided into an unreadable smear and the one underneath could not be
seen or clicked. Since a pasted or duplicated clip lands on top of what it was
copied from, this is not a rare state — it is where a first-time user is within
a minute of opening the app. Clips now stack into rows, as in any NLE.

## Small things that were quietly wrong

- A `pointerdown` whose `pointerup` never arrived — released outside the window,
  or swallowed by a dialog — left its move handler live on `window`, and the
  next unrelated pointer event anywhere dragged a clip. Drags now belong to one
  `pointerId`, end on a new `pointerdown`, and end on window blur.
- The cross-lane drop target was found by walking a ref map, where a lane that
  had not mounted yet was simply absent — and an absent lane reads as "no lane
  there", so the drag *silently refused* to change tracks. It asks
  `elementFromPoint` now, which is the same question the user's hand answered.
- `previewMove` added the dragged clip to **every** lane, not just the target
  one, so a linked clip landed in three places at once.
- A new track was appended to the bottom of the list, which put a new V2 lane
  below three other lanes — so a picture-in-picture you had just set up rendered
  under the title track and was off-screen when you dragged onto it. New lanes
  are inserted after the last lane of their family.
- The media bin's tiles pointed at `/placeholder-video-1.jpg` and friends, which
  do not exist in the repo, so every tile showed a broken-image glyph and its
  alt text.

## Honest remainder

> Re-checked at the end of Session 12: all three are still open, and Session 12
> adds a fourth (drop-frame timecode). The list below is therefore still
> accurate — see "Still not built" at the end of Session 12 for the current
> version.

Three things are still not built, and each says so in the interface rather than
shipping a plausible-looking approximation:

| Feature | Why, and where it says so |
|---|---|
| **Speech-bubble callouts** | needs a leader line anchored to a point that tracks as the picture moves; nothing here anchors a point to a frame. The mode rail's dot has a tooltip that says exactly this. |
| **Stabilization** | needs motion estimation between frames to recover a camera path. That is a real analysis job, and doing it badly looks worse than not doing it. |
| **Chroma key** | a real key is a per-pixel shader. The canvas filter API has no chroma operator and a per-pixel JavaScript pass at preview resolution is too slow to ship. |

Two limits of the export are stated in the dialog rather than discovered
afterwards: it is **real-time** (a 60-second timeline takes 60 seconds; the
progress bar tracks the render clock, not a fake timer), and the container is
whatever `MediaRecorder` produces here — WebM. The audio is the same mix being
played, because it comes out of the same Web Audio graph rather than a second
one.

## Verification

```
fixtures: real 3s MP4 (red), real 3s MP4 (blue), real WAV tone, real PNG
52/52 checks passed
RESULT: PASS
```

Covered by the harness, all through the real interface: real file import
through a real `<input type=file>`; decoded durations and thumbnails; the
compositor drawing the *red* frame at 0s and the *blue* frame at 4s; a
crossfade sampled mid-transition and found to be blended (151,0,101 — neither
pure red nor pure blue); waveform canvases; edge-trim; fade-corner drag;
a clip dragged onto a second video lane; the properties dialog writing 2×
speed; the filters, audio-effects and titles panels; select-all/delete/undo/
redo; duplicate and paste; save; **a page reload restoring the clips, the
media, the transitions and the redo stack**; the export dialog's honest copy;
all three resize handles dragging in the correct direction; playback advancing;
the theme toggling and repainting; no broken images, no overflow and **no
console errors at boot or at the end**.

---

# Session 12 — frame accuracy, persistence, and the ruler that measures

> Date: 2026-09-30
> Every item below was driven through the real interface in a real browser
> against a real MP4, a real WAV and a real PNG generated by ffmpeg.
> The harness is `tools/check-video-editor.mjs` — **59/59 checks pass**, and it
> screenshots both themes on every run.

## What this session was asked for

A professional timeline: frame-accurate editing, and a workspace that survives a
refresh. Two of the three reported defects were real bugs with invisible causes;
the third was a stylesheet that said one thing and rendered another.

---

## ✅ The three reported bugs, and what each one actually was

### 1. SSR / localStorage during render

The settings store read `localStorage` at **module scope**. That value became the
first React render's state, so on every page load the server rendered the
defaults, the client rendered the user's real zoom, panel sizes and frame rate —
and React threw "Minified React error #418", discarded the tree, and re-rendered
everything from scratch. Five console errors per load, and it only reproduced
for a user who had *saved* settings, so nobody with a fresh profile could ever
find it.

**Fixed** by making the store start as the defaults and reading storage from a
mount effect, with `useSyncExternalStore` given an explicit server snapshot so
the hydration render is provably identical to the HTML it is hydrating. Nothing
is suppressed with `suppressHydrationWarning`; nothing mismatches.

### 2. Trim clamp

Two defects in one.

*The minimum.* `MIN_CLIP_FRAMES` was 2, on the theory that "a one-frame clip
cannot be grabbed". That is a real usability point answered with the wrong tool:
it silently refuses edits that leave exactly one frame — a legitimate
single-frame cut that Resolve and Premiere both make. The right answer is to
keep the trim handles visible on narrow clips, which the lanes now do. The floor
is **1 frame**, as asked.

*The maximum.* There wasn't one. Dragging an out-edge past the end of the file
produced a clip longer than its own media — a duration the decoder can never
deliver, and an export that ends on a frozen frame. The trim is now bounded by
what the **source file** can supply, in source frames and divided by the clip's
speed: a 3-second file at 2x supplies 180 timeline frames, not 90.

*And the bug that hid all of it.* The trim handler passed the snap **correction**
to the shell instead of the total **delta**:

```
onTrimClip(clipId, 'out', res.frame - end);      // zero on every unsnapped drag
onTrimClip(clipId, 'out', res.frame - originalEnd); // what was meant
```

So a trim only ever moved by the snapping error — which is zero almost every
time. It was found by instrumenting `nextId` to log its own stack and then
bisecting to a three-clip timeline in a probe.

### 3. The scrollbars

A stylesheet that says 1px and renders 15px is worse than no stylesheet, because
reading the CSS says the job is done. Both numbers were measured in a real
browser:

```
getComputedStyle(el, '::-webkit-scrollbar').width   ->  "1px"   (the rule)
el.offsetWidth - el.clientWidth                      ->  15      (what renders)
```

The cause is in the shared `scrollbar.css`, imported **unlayered**, so it beats
every cascade layer in the app. It sets `scrollbar-color` on `html` for Firefox.
Chrome 121+ also reads it — and when `scrollbar-color` is present at all, Chrome
ignores every `::-webkit-scrollbar` rule in the document and draws its own 15px
scrollbar. The app's own rules were being applied and then discarded.

Fixed in the video editor only, deliberately **unlayered** and outside every
layer: `html { scrollbar-width: auto; scrollbar-color: auto; }`. Now
`::-webkit-scrollbar` applies: **1px**, fully transparent track, thumb
`#2c3235` (Grafana's neutral-4), lightening on hover so the control can still
be found. The shared file belongs to every app in the monorepo and was left
alone.

The harness now asserts this by **measuring every scrollable box** — and only
boxes whose computed overflow is `auto` or `scroll`, because an
`overflow: hidden` element also reports a non-zero `offsetHeight - clientHeight`
when its content overflows, and it renders no scrollbar at all.

---

## ✅ Timeline: the parts that were missing

| Requirement | How it is done |
|---|---|
| Frame-based model | Every timeline position is an integer **frame**; seconds only exist at a media element. `lib/engine/frames.ts` |
| 24 / 25 / 30 / 50 / 60 fps | All five offered; the toolbar select is the control |
| Frame fields per clip | `startFrame`, `lengthFrames`, `sourceInFrame`, `sourceOutFrame`, and the clip element carries `data-frames-start` / `data-frames-length` |
| Zoom to a single frame | Zoom is **pixels per frame**, not a seconds multiplier — a multiplier changes meaning when the frame rate does. The range reaches 64px/frame |
| Alt + wheel zoom | Anchored on the **pointer**, so the frame under the cursor stays under the cursor |
| Zoom slider | In the track header, showing the percentage live |
| Playhead | Stored as a frame number; ← → step one frame, Shift+← → step ten |
| Ripple trim | Moves the edge and slides everything after it, leaving no gap |
| Roll | A handle on the boundary between two ADJACENT clips: left grows, right shrinks, total unchanged |
| Slip | The source slides inside the clip; position, length and neighbours untouched |
| Slide | The clip moves between its neighbours, which grow and shrink to fill |
| Split | Cuts at the playhead frame, refuses to leave either half under the minimum, and shifts nothing |
| Snapping | Playhead, every clip edge on every track, markers, both ends of the timeline, and transition joins — with a visible line and a label saying what was caught |
| Markers | `M` at the playhead, `,` and `.` to step; drawn on the ruler, lines through the lanes, and snap targets |
| J / K / L | J and L ramp the rate while held, K stops |
| Viewer | `HH:MM:SS:FF` timecode plus **timeline frame and source frame** side by side |
| Virtualisation | Only the visible window renders, with generous overscan; the footer says "N clips (M drawn)" rather than hiding the difference |
| Persistent settings | Zoom, scroll, panel sizes, **lane heights**, frame rate, playback rate and speed, snapping and its threshold, waveforms, grid, theme, loop and measurement range, viewer zoom/layout/badge, last project, playhead |

### The ruler

It is a **measuring tape**, not a clock face, and it has two bands rather than a
mode flag:

- **upper band** — scrub: click or drag to move the playhead
- **lower band** — measure: drag out a selection and read its length

Three tick weights, a ladder of steps **in frames** (a "2 second" step is 60
frames at 30fps and 120 at 60, so a second-based ladder changes which numbers
appear whenever the frame rate changes), labels that change format with the
zoom (frame number → fractional seconds → timecode), a cursor readout that
reports the frame under the pointer even when you are not scrubbing, markers,
the loop region, and a grid that matches the frame count.

The band boundary sits at 55% and **scrub owns the midpoint**. When it was at
50%, a click in the vertical centre of the ruler measured instead of seeking —
so the single most obvious thing to do to a ruler did nothing visible.

### Two footer bars became one

There were two: one from the lanes (clip and transition counts) and one below it
(timecode, frame rate, project name). Two bars for one piece of information is a
bar the user looks past, and the second cost 20px of timeline height. There is
now one strip: timecode, frame range, measurement, playback rate and snapping on
the left; project, save state, clip counts and selection on the right.

---

## ✅ The workspace really does survive a refresh

The stated test is "user zooms, resizes, changes layout, refreshes — everything
should appear exactly as before". So the harness **changes the workspace,
reloads the page, and compares**: zoom, frame rate and theme are set to non-
default values, the page is reloaded, and the DOM is re-read.

Two decisions made that work:

- **The workspace's frame rate wins over the project's.** Both hold a rate and
  they can disagree. If the project's won, the rate a user deliberately chose
  would be reverted by opening a file — the exact "my settings reset" complaint
  the store exists to end. The project adopts the workspace rate instead, so
  the two converge.
- **Writes are coalesced by 250ms, and flushed on `pagehide` and
  `visibilitychange`.** A resize drag fires a write per frame; localStorage is
  synchronous, and on Windows that is long enough to make the drag stutter.

---

## 🟡 Still not built — and each one says so in the interface

| Feature | Why, and where it says so |
|---|---|
| **Speech-bubble callouts** | Needs a leader line anchored to a point that tracks as the picture moves; nothing here anchors a point to a frame yet. The mode rail's dot has a tooltip that says exactly this. |
| **Stabilization** | Needs motion estimation between frames to recover a camera path. That is a real analysis job, and doing it badly looks worse than not doing it. |
| **Chroma key** | A real key is a per-pixel shader. The canvas filter API has no chroma operator and a per-pixel JavaScript pass at preview resolution is too slow to ship. |
| **Drop-frame timecode** | The semicolon form needs a real drop-frame table per rate; the colon form shown is the correct non-drop standard and says so. |

Two honest limits of the export, stated in the dialog rather than discovered
afterwards: it is **real-time** (a 60-second timeline takes 60 seconds, and the
progress bar tracks the render clock rather than a fake timer), and the container
is whatever `MediaRecorder` produces here — WebM. The audio is the mix being
played, because it comes out of the same Web Audio graph rather than a second
one.

---

## Verification

```
fixtures: real 3s red MP4, real 3s blue MP4, real WAV tone, real PNG
59/59 checks passed
RESULT: PASS
```

Notable checks, all through the real interface: the compositor drawing the
**red** frame at 0s and the **blue** frame at 4s; a crossfade sampled
mid-transition and found blended (151,0,101 — neither pure red nor pure blue);
roll verified as *left grew, right shrank, total unchanged*; trim, slip and
slide driven from their **toolbar buttons**; all five frame rates offered; zoom
reaching ≥24 pixels per frame; markers added and stepped between; the ruler
measuring a range and reporting its length in frames; **zoom, frame rate and
theme all surviving a browser refresh** with the project and its media restored
from IndexedDB; every scrollable box measured at 1px; the lanes virtualised with
the footer reporting the difference; and **no console errors at boot or anywhere
in the run**.

---

## Still open, honestly

The harness passes, but three things are untested at the scale they claim to
handle: **1000+ clips** (virtualisation is verified at ~20 clips, which proves
the windowing works but not the memory profile), **very long timelines**
(thousands of ruler ticks), and **export at 4K** (the encoder path is exercised
by the dialog, not by a full render — a 60-second render takes 60 seconds, so it
was not run in every iteration).

Two tools were written to find these bugs and are worth keeping:
`tools/probe-trim.mjs` (replays one gesture and reports the state after every
event) and `tools/probe-console.mjs` (dumps every console message unfiltered —
a production build only says "Minified React error #418", and the way to read
the real text is to point it at a dev server).
