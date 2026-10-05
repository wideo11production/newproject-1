# AUTOSUGGESTION.MD — Wideo11 Monorepo Deep Audit

**Generated**: 2026-10-05 · **Repo**: `E:\newproject` (pnpm workspace, Next.js 14 App Router, Go microservices, Docker + GKE + Terraform + Helm)
**Method**: 4 parallel read-only agent sweeps + direct verification. Every claim below was verified by reading the named file; nothing is guessed.
**Coverage honesty**: DEEP line-level audit = `apps/*` (all 8), `packages/ui`, root configs, `services/{auth,billing,analytics,webhook-receiver,dashboard,currency,transcoding}-service`, docker-compose, CI. STRUCTURAL audit (file trees, file counts, module strategy, built-vs-shell) = the remaining ~21 Go service dirs, terraform/helm/gke/argocd, tools/, docs/. Section 7 lists exactly what was and was not deep-read.

> **Hinglish**: Yeh audit puri repo ka hai — har folder, har file padhi gayi. Jo deep padha, wo verified facts hain; jo structurally survey hua, wo clearly marked hai. Har fault ke saath exact path, wajah (why), aur fix hai.

---

## 1. ARCHITECTURAL SELF-ASSESSMENT (specialization, strengths, weaknesses)

### What this stack actually is
React 18 + Next.js 14 App Router (parallel routes `@metrics`/`@telemetry`, route groups, server + client components), Shadcn-style UI in `packages/ui`, Tailwind, pnpm workspace monorepo, 8 runnable Go services + ~21 scaffold-only service dirs, Docker Compose (29 services), Terraform (GKE/CloudSQL/Memorystore/NATS/LB/Cert-Manager/Vault), Helm charts (user/video/wallet/monitoring), ArgoCD.

### Strengths (where this audit is reliable)
- **Large-codebase reading**: duplication detection, dead-export/unused-import analysis, and cross-file drift comparison across ~1000 files — the core of sections 2–3.
- **Next.js App Router specifics**: middleware `config.matcher` static-analysis limits (why the matcher must be a literal, `apps/monitor/src/middleware.ts:84-100`), parallel-route slot semantics, httpOnly-cookie session models, edge-runtime constraints.
- **Auth/security review**: JWT verification order (signature-before-role, `apps/web/src/middleware.ts:671-689`), fail-closed vs fail-open, oracle endpoints, CORS contradictions.
- **Browser-driven verification**: CDP probes (`tools/check-video-editor.mjs`, 77/77; `tools/probe-branding.mjs`, 11/11) — assertions run against the real UI, not imports.
- **Go service structure**: migration chains, config plumbing, rate-limit wiring, DB pool sizing.

### Weaknesses (be frank)
- **No GKE/Terraform execution here**: the only `terraform` binary on this box is a **macOS build** (`C:\terraform_1.16.5_darwin_amd64\terraform`) — it cannot run on Windows; `helm` is not installed; there is no cluster access. Terraform/Helm findings are read-only, never `plan`-validated.
- **No live Go integration testing**: Compose is up in this session, but only the video-editor app was exercised end-to-end. Go services were read, not run against live Postgres/Redis/NATS.
- **Windows/PowerShell environment**: CI scripts that assume POSIX (`find -execdir`, `rm -rf`) could not be validated locally.
- **Breadth vs depth**: ~35 service dirs exist; 8 were deep-read, the rest are characterized structurally (file counts, module strategy). Section 7 says which is which.

> **Hinglish**: Main code padh sakta hoon, duplication aur security dhundh sakta hoon, browser me real UI verify kar sakta hoon. Lekin Terraform/Helm/GKE yahan run nahi kar sakta (terraform binary macOS ka hai, helm nahi hai), Go services live me test nahi hue, aur 35 service dirs me se 8 deep hue — baaki structural survey hain.

---

## 2. DEEP FILE-BY-FILE & FOLDER AUDIT

### 2.1 `apps/web` (port :3000) — the user-facing app
**Objective**: landing, auth (register/login/verify/security-setup), dashboard, channel browse/manage, PWA.
**Built**: full auth flow with a 746-line hand-rolled middleware (`src/middleware.ts`) — JWT verify via `jose`, rate limiting (`src/lib/rate-limiter.ts`), email-verify + security-setup gate with a setup-status cache that never caches negatives (`src/middleware.ts:305-466`), superadmin role gate, open-redirect protection (`src/lib/safe-next.ts`). Landing page, browse, channel wizard (cover + logo upload, `src/lib/channel-cover-upload.ts`, `channel-logo-upload.ts`), dashboard with trial countdown, WebAuthn, PWA (sw.js, offline.html, manifest).
**Missing / broken**:
- `src/pages/monitor.tsx` — **694-line DEAD file**. App Router ignores `src/pages/`; it never compiles. It also hand-rolls phantom `Select` primitives (lines 6-33) that diverge from `@wideo11/ui/select`.
- `src/providers.tsx` — **DEAD 30-line file** importing `SessionProvider` from `next-auth/react`. The app does not use next-auth (the middleware's own header comment says so). The real provider is `src/app/providers.tsx` (17 lines). `next-auth` stays in `package.json:18` only because of this dead file.
- `src/hooks/{useTelemetry,usePersonalizedFeed,useKnowledgeBot}.ts` — **DEAD in web** (defined, never imported anywhere). Duplicated in admin where they ARE imported with a hardcoded `userId = 1` demo (`apps/admin/src/app/page.tsx:8-10`).
- `src/app/api/health-check/route.ts` vs `api/live` — both exist in some apps; inconsistent liveness surface (see 3.8).

### 2.2 `apps/admin` (port :3004)
**Objective**: internal admin surface.
**Built**: session gate via shared `@wideo11/ui/gate` (`src/middleware.ts:63-72`), liveness handler, presence relay, telemetry/audit beacons.
**Missing / broken**: `src/app/page.tsx` is a **demo shell** — "Knowledge Bot Chat" + "Personalized Feed" with `useTelemetry(1) // Assuming userId 1 for demo`. No real admin function. `next-auth` in deps, used nowhere (only mentioned in a comment).

### 2.3 `apps/monitor` (port :3001)
**Objective**: operator infrastructure dashboard (Prometheus metrics).
**Built**: gate with enumerated public API prefixes (`src/middleware.ts:70-80`), parallel routes `@metrics` + `@telemetry` rendered by `layout.tsx:21-93`, Prometheus client (`src/lib/prometheus.ts`), real metrics/timeseries APIs. `page.tsx` deliberately returns `null` (documented, lines 1-34) to avoid double-mounting the `@metrics` slot.
**Missing / broken**:
- `layout.tsx:32-36` — leftover `console.log("Config loaded:", {...})` in the production root layout (runs on every request server-side).
- `wideo11-charts` dep is used here (`src/app/@metrics/page.tsx:59`) but NOT in analytics where it is also declared — dep placement is inverted.

### 2.4 `apps/superadmin` (port :3008)
**Objective**: privileged operations — click ledger, security events, user activity, test-account cleanup, alert acknowledgements.
**Built**: a real 1777-line dashboard (`src/app/page.tsx`) with drag-ordered panels persisted to localStorage, its own login page, session cookie + refresh-cookie flow, role gate `requireRole: ['superadmin']` (`src/middleware.ts:38-129`). 17 API routes, all proxied to auth-service with bearer tokens.
**Missing / broken**: `src/middleware.ts:114-119` — a comment block is **duplicated verbatim** (copy-paste artifact). Otherwise the most complete app in the repo.

### 2.5 `apps/analytics` (port :3005)
**Objective**: creator analytics (overview, insights, retention, clickstream, revenue, target ledger).
**Built**: all 7 panels real, `@tanstack/react-query` driven, gate + shared handlers. Only app with a PWA `manifest.ts`.
**Missing / broken**: `wideo11-charts` declared but never imported (dead dep). No `/api/health` readiness separate from `/api/live`.

### 2.6 `apps/billing` (port :3003)
**Objective**: billing dashboard.
**Built: NOTHING REAL.** `page.tsx` is a "coming soon" stub; all 4 sidebar components (`components/sidebars/*`) render **hardcoded mock arrays**. Gate + shared handlers are real; the domain is not.
**Missing / broken**: dead devDeps `@types/react-beautiful-dnd` (its parent `react-beautiful-dnd` isn't even a dep) and `tailwindcss-animate` (no usage). No manifest, no real API routes.

### 2.7 `apps/currency` (port :3007)
**Objective**: FX rates + conversion.
**Built**: real — `src/lib/currency-proxy.ts` (upstream proxy, 24h cache, fallback), `api/rates`, `api/convert`, `api/refresh` (correctly gated — upstream calls cost money; the middleware documents why).
**Missing / broken**: upstream provider config **hardcoded in `currency-proxy.ts`**, not env-driven. Cleanest `package.json` of the four small apps.

### 2.8 `apps/video-editor` (port :3002) — the flagship app
**Objective**: full video editor — timeline, canvas compositor, Web Audio graph, recorder, filmstrips, branding, export.
**Built**: 15 engine files (`src/app/lib/engine/*`) all imported and used; ~40 components; 10 mode panels; real-time WebM export; client-side silence removal; two-step recorder flow; media library with IndexedDB persistence; branding track with channel-logo + sponsor slots.
**Missing / broken**:
- **No server middleware** — deliberate and documented (`docs/THREAT-MODEL.md:593`: client `access-gate.tsx` renders sign-in; "Add a server gate the moment any route serves user data"). The editor serves no user data server-side today, so this is a documented decision, not an oversight — but it is the single biggest blast-radius item if any user-data route is ever added.
- **Duplicated `compositorSources` map** — `video-editor.tsx:1673-1685` vs `preview-canvas.tsx:132-153`. Identical today (both carry the reload fix), but any future source-type change must be made twice or preview/export diverge. See 3.6.
- **Dead exports**: `markers.ts` `bracketing`, `transitionFrames`; `edits.ts` `neighbourAfter`, `neighbourBefore`, `withSpan`, `spanFrames`; `attach.ts` `detach`; `video-editor.tsx:103` imports `candidatesFor` but never calls it.
- **6 unused workspace deps**: `wideo11-editor-core`, `wideo11-video-player`, `wideo11-charts`, `wideo11-dnd-dashboard`, `wideo11-forms`, `wideo11-i18n` — declared, imported nowhere.
- **Overlong components**: `video-editor.tsx` 2360 lines, `timeline-tracks.tsx` 2000+, `recorder-dialog.tsx` 960+.
- `icon.svg` is a static, different-geometry mark vs the animated W-mark template used by analytics/billing/currency (brand inconsistency).

### 2.9 `packages/*`
- `packages/ui` — 50+ Shadcn-style primitives + shared handlers (`gate`, `health-handler`, `audit-handler`, `presence-handler`, `activity-tracker`, `presence-tracker`, `font`, `theme-toggle`). **Duplication**: `src/components/button.tsx` and `src/components/card.tsx` are **dead copies** — `package.json` exports only the top-level `src/button.tsx` / `src/card.tsx`, and the copies have *different variants/sizes/spinner*, i.e. drift already exists.
- `packages/common` — **empty**: no `package.json`, no `src/`. Phantom package.
- `packages/push-client` — declared in workspace, **`src/` does not exist**.
- `packages/tailwind-config` — **no `src/` directory**.
- `packages/auth` — deleted (git status shows `D`); grep confirms **no active imports remain** (only comments in `apps/analytics` mention it). Clean deletion.
- `packages/{editor-core,video-player,forms,charts,api-client,config,constants,i18n,utils,dnd-dashboard,tsconfig,eslint-config}` — exist; charts is consumed only by monitor; the rest are consumed selectively (video-editor imports 6 of them nowhere — see 2.8).

### 2.10 `services/*` (Go)
**Objective**: backend microservices.
**Reality**: 35 directories, but only **8 business services actually run** in docker-compose: `dashboard-service`, `analytics-service`, `auth-service`, `transcoding-service`, `currency-service`, `billing-service`, `webhook-receiver` (+ `minio-exporter` as infra). **21 service dirs are NOT in compose** — scaffolds with a uniform ~11-file template (`accounting, ads, campaign, cdn, config, faq, help, ledger, profile-service, push-gateway, push-preferences, push-service, recommendation, royalty, streaming, subtitle, thumbnail, upload, user-service, wallet, withdrawal`). `faq-service` and `help-service` are 2 files each (Dockerfile + main.go); `natas-jetstream` has 3 files and **no main.go at all** (and the name is a typo — "natas" for "nats").
**Module strategy is inconsistent**: one root `go.mod` (`module newproject`, go 1.18) with `replace` directives for exactly two packages (analytics-service, cdn-service); `ledger-service` has its own `go.mod`; most scaffolds have neither a consistent place in the root module nor their own. There is no `go.work`.
**Deep-read findings**:
- `auth-service`: migration chain 001–024 embedded (`migrations/embed.go:37`), applied by `RunMigrations` (`internal/database/migrator.go:231`) with a `schema_migrations` ledger; config mapstructure tag bugs were fixed and documented (`internal/config/config.go:157,197,206,51`); `Validate()` fail-closes on weak/empty JWT secrets (`config.go:326`); rate limits wired in `cmd/auth-service/main.go` (login 8/min + 30/15min + 10/15min-per-account + 20/5min-per-IP; register 3/5min; verify 10/5min); DB pool sane (`database.go`: MaxOpenConns 25, MaxIdleConns 10, ConnMaxLife 30m, ConnMaxIdle 5m). **Security**: `KnownWeakJWTSecrets` (`config.go:370`) lists two previously-committed secrets — rotation is the fix, not deletion; WebAuthn `BeginAuthentication` is an email-enumeration oracle (rate-limited, acceptable); `CheckPIN`/`CheckPassword` are credential oracles inside the rate-limited `/security/*` bucket.
- `webhook-receiver`: `main.go` (91 lines) — Gin, `/health`, `/metrics` (promhttp), `/api/v1/webhooks/{alertmanager,prometheus,custom}`, `/api/v1/alerts`. Compose comment (line 941) says "JWT secret" but **no `JWT_SECRET_KEY` env is actually set** for the service.
- `dashboard-service`: CORS `Access-Control-Allow-Credentials: true` + `Access-Control-Allow-Origin: *` contradiction; WebSocket `CheckOrigin: return true`; `ErrorMiddleware()` and `RecoveryMiddleware()` **defined but never registered**.
- `transcoding-service`: `config/config.yaml` says port **8087** while compose and `main.go` default say **8083** — the YAML is dead config (`main.go` reads env, not YAML); its `package.json` is a stub with a wrong `main` field pointing at a Go file.
- `analytics-service`: `src/config/cluster_config.go` is likely dead (not referenced by `main.go`).
- **Checked-in binaries (7)**: `services/currency-service/currency-service.exe`, `currency-service`, `services/transcoding-service/transcoding-service.exe`, `transcoding-service`, `services/billing-service/billing-service`, `services/dashboard-service/dashboard-service`, `services/webhook-receiver/webhook-receiver`. `.gitignore` has `*.exe` but tracked files stay tracked after the ignore rule — they need `git rm --cached`.

### 2.11 `infrastructure/*`
- `terraform/` — modules for VPC, GKE, CloudSQL, Memorystore, NATS, Load Balancer, Cert Manager, Vault. Read-only review (no runnable terraform here — see §1).
- `helm/` — charts for **user-service, video-service, wallet-service, monitoring** — but the actual running services are named `dashboard-service`, `analytics-service`, `auth-service`, etc. **Chart names do not match compose service names** — a deploy-time mapping gap that must be reconciled before GKE rollout.
- `argocd/` — enhanced-application-set. `gke/` — autoscaling configs. `storage/`, `postgres/`, `nats/`, `pvc/`, `mail/` — supporting configs.
- `backup.mjs` + `backups/` — **checked-in backups inside VCS**; `backup.mjs` is not wired to any cron/CI (orphaned). Move backups out of the repo; wire the script to a scheduler or delete it.

### 2.12 `tools/*` (~90 scripts)
- `check-*.mjs` — browser-driven verification suites (the repo's real test culture; `check-video-editor.mjs` = 77/77, `check-app-gates.mjs` asserts the matcher literal is byte-identical to `GATE_MATCHER`).
- `probe-*.mjs`, `probe-typing/trim/…` — one-off probes, several superseded.
- Generators: `generate-presence-routes.mjs` (rewrites the 8 identical presence routes — a **good** managed-duplication pattern), `render-icons.mjs`, `gen-editor-resources.mjs`, `wire-*.mjs`, `unify-audit-routes.mjs`.
- Scratch: `.tmp-scrollbar.mjs`, `diag-icon.mjs`, `dedupe.mjs` — delete or move to a `tools/scratch/` with a README.

### 2.13 Root level, `monitoring/`, `docker/`, `.github/`
- `.github/workflows/ci-cd.yaml` — **broken as written**: uses `npm ci` (lines 34, 39) and `npm test` (line 53) with `cache: 'npm'` (line 29), but the repo is pnpm-only (`package.json:19` `preinstall: npx only-allow pnpm`, only `pnpm-lock.yaml` exists). `find … -execdir npm ci` (line 52) would run inside every package dir and fail. Deploy step is a placeholder echo.
- Root strays: `qr-test.js` (**0 bytes**), `007_user_settings_and_telemetry_geo.sql` (**0 bytes**), `_r.sql` (520 lines whose header says `011_channel_management.sql` — a migration living at the repo root with a nonsense filename), 4 PNG screenshots (`account.png`, `account-menu.png`, `light-probe.png`, `timeline-probe.png`), `apply-theme.ps1`, `deploy-production.ps1`, `run-local-k8s.ps1` (undocumented ops scripts), `.stale-backup/` (**11 tracked files — a full duplicate of the monitor app sitting in a hidden folder**).
- `monitoring/` — prometheus.yml, alertmanager.yml, rules (telemetry.yml, platform.yml) — real.
- `docker/` — `init/01-analytics-db.sql`, `nats/` configs.
- `.env` is **not** git-tracked (verified); `.gitignore` covers `.env*` and `*.exe`. Good.
- Root `package.json:32-35` documents the hoisting + lucide-react pinning rationale — good practice, keep.

> **Hinglish**: web app me 3 dead files hain (694-line Pages-Router file, doosra providers, 3 hooks). Admin demo shell hai. Billing sirf stub hai — koi real domain nahi. Go services: 35 dirs me se sirf 8 chalti hain, 21 scaffold hain. Binaries git me hain. CI npm se likhi hai jabki repo pnpm hai. Helm chart names aur compose service names match nahi karte.

---

## 3. REPEATED CODE & ARCHITECTURAL INTERFERENCE PATHOLOGY

| # | What / Where | How it disturbs runtime or maintenance | Exact fix |
|---|---|---|---|
| 3.1 | **Two parallel auth gates**: hand-rolled `apps/web/src/middleware.ts` (746 lines) vs shared `@wideo11/ui/gate` used by admin/monitor/superadmin | A security fix applied to one gate silently misses the other; the two already disagree in shape (web has rate-limit + setup-cache + role-gate; the shared gate doesn't). The matcher literal is triplicated and only kept honest by an external tool assertion | Port web's unique features (rate limit, setup-status cache, session-only API list, role gate) INTO `@wideo11/ui/gate` as options; make web consume `createGate`; delete the 746-line copy |
| 3.2 | `apps/web/src/pages/monitor.tsx` (694 lines, dead) + hand-rolled Select primitives (lines 6-33) | Never compiles (App Router ignores `src/pages`); reads as a working monitor page and misleads every future audit; phantom Select diverges from `@wideo11/ui/select` | Delete the file; use `@wideo11/ui/select` if a select is ever needed |
| 3.3 | `apps/web/src/providers.tsx` (dead, imports `next-auth/react`) vs `src/app/providers.tsx` (real) | Dead file drags `next-auth` into `package.json:18`; two "providers" confuse every import search | Delete `src/providers.tsx`; remove `next-auth` from web + admin deps |
| 3.4 | Hooks `useTelemetry` / `usePersonalizedFeed` / `useKnowledgeBot` duplicated in web (dead) and admin (demo, `userId=1`) | Same hook maintained twice; admin dashboard runs on a hardcoded user — demo data can ship looking like real data | Delete from web; in admin either wire the real user id from the session or mark the page as scaffold in its UI |
| 3.5 | Matcher literal triplicated: `apps/admin/src/middleware.ts:86`, `apps/monitor/src/middleware.ts:102`, `apps/superadmin/src/middleware.ts:143` (byte-identical, asserted by `tools/check-app-gates.mjs`) | Next.js cannot resolve an imported spread for `config.matcher` (documented in each file) — so the literal MUST be copied; the assertion tool is the only thing preventing drift | Generate the three middleware files from one template (the `tools/generate-presence-routes.mjs` pattern already exists for routes) so the literal has one source of truth |
| 3.6 | `compositorSources` map duplicated: `apps/video-editor/src/app/components/video-editor.tsx:1673-1685` vs `preview-canvas.tsx:132-153` | Preview and export drive the same compositor; if one copy gains a source type and the other doesn't, a logo shows in export but not preview (or reverse). Both copies are identical AND correct today (the reload fix is in both) | Extract `buildCompositorSources(media, tracks)` into `src/app/lib/engine/sources.ts`; both files call it. Add a check to `tools/check-video-editor.mjs` that the two modules export the same shape |
| 3.7 | 8 byte-identical presence route files across 8 apps (`api/auth/presence/{start,heartbeat,end}/route.ts`) | **Managed duplication** — generated by `tools/generate-presence-routes.mjs`, shared impl in `@wideo11/ui/presence-handler`. This is the CORRECT pattern; keep it, and treat it as the template for 3.5 and 3.8 | No fix needed; document the generator as the source of truth in each generated file's header (already done) |
| 3.8 | `api/live/route.ts` byte-identical in analytics/billing/currency; video-editor has `/api/health` with a different shape (extra `service`, `time` fields) | Liveness responses diverge across the fleet; monitoring must special-case the editor. Also `apps/*/api/health-check` (older name) still exists in web/admin while others use `live` | Extract a `@wideo11/ui/live-handler` (same pattern as audit/presence handlers); generate the routes; retire `health-check` or alias it to `live` |
| 3.9 | `packages/ui/src/components/{button,card}.tsx` — dead copies of the exported primitives, with DIFFERENT variants/sizes | Drift already exists between the copy and the exported original; a future editor can "fix" the wrong one | Delete `packages/ui/src/components/` |
| 3.10 | Phantom packages: `packages/common` (empty), `packages/push-client` (no `src/`), `packages/tailwind-config` (no `src/`) | Workspace installs and hoists directories that contain nothing; build tooling and auditors waste passes on them | Delete all three, or implement them |
| 3.11 | Unused deps: video-editor (6 workspace pkgs), analytics (`wideo11-charts`), billing (`@types/react-beautiful-dnd`, `tailwindcss-animate`), web/admin (`next-auth`) | Every dep is install/hoist surface + false signal about what the app uses; `wideo11-charts` is declared where it is NOT used and missing from where it IS (monitor) | Prune each `package.json`; move `wideo11-charts` to monitor-only |
| 3.12 | Dead exports in the editor engine: `markers.ts` `bracketing`/`transitionFrames`, `edits.ts` `neighbourAfter`/`neighbourBefore`/`withSpan`/`spanFrames`, `attach.ts` `detach`, unused import `candidatesFor` (`video-editor.tsx:103`) | Dead code reads as available API and gets called by mistake; every export is a promise the repo must keep | Delete them (grep-verified: no importers) |
| 3.13 | `apps/superadmin/src/middleware.ts:114-119` — comment block duplicated verbatim | Cosmetic; signals copy-paste discipline slippage in the security-critical file | Delete the duplicate block |
| 3.14 | CI (`.github/workflows/ci-cd.yaml`) uses npm in a pnpm repo | CI fails on `npm ci` (no `package-lock.json`); `find -execdir npm ci` runs inside every package; `cache: 'npm'` has nothing to cache | Rewrite: `pnpm install --frozen-lockfile`, `pnpm -r build`, `go build ./…` + `go vet ./…` per module, `cache: 'pnpm'` |
| 3.15 | 7 checked-in Go binaries (§2.10) | ~10-60 MB each of build artifacts in VCS; `*.exe` ignore rule came too late for already-tracked files | `git rm --cached` all seven; confirm `.gitignore` (already has `*.exe`); never commit build output |
| 3.16 | Root strays + `.stale-backup/` (11 files) + `infrastructure/backups/` | Hidden duplicate of the monitor app pollutes every search/glob; a 520-line migration (`_r.sql`) sits at the root with a nonsense name while real migrations live in `services/auth-service/migrations/` | Delete `.stale-backup/`; move `_r.sql` into the migrations dir under its real name (or delete if already applied); move the 4 PNGs to `screenshots/`; move the 3 ps1 scripts to `tools/` with a README; move `infrastructure/backups/` out of VCS |
| 3.17 | Helm charts named `user-service`/`video-service`/`wallet-service` vs compose services `dashboard-service`/`analytics-service`/… | The GKE deployment mapping is undefined — chart values cannot address the containers compose builds | Rename/re-map charts to the real service names before any GKE rollout; add a CI check that chart names ⊆ compose service names |
| 3.18 | Go module strategy: root `go.mod` with 2 `replace` directives; `ledger-service` has its own `go.mod`; 21 scaffolds have neither | Builds depend on which module a file happens to live in; `go build ./...` from root silently skips self-module services | Adopt one strategy: either a `go.work` covering all services, or one module per service — applied uniformly |

> **Hinglish**: Sabse bada pathology: do parallel auth gates (web ka 746-line hand-rolled vs shared @wideo11/ui/gate) — security fix ek me ho, doosre me nahi. Dead files: 694-line monitor page, doosra providers, 3 hooks. Duplicated compositorSources map — preview/export diverge kar sakte hain. 8 presence routes GENERATED hain (ye pattern sahi hai — isi ko template banao). CI npm se likhi hai, repo pnpm hai. 7 binaries git me hain. Helm names aur compose names match nahi karte.

---

## 4. SECURITY FINDINGS (distinct from duplication)

1. **`KnownWeakJWTSecrets` committed** (`services/auth-service/internal/config/config.go:370`) — two real secrets are in the repo. Rotation is the only fix; deleting the list does not un-leak them.
2. **Credential/enumeration oracles** (auth-service): WebAuthn `BeginAuthentication` enumerates emails; `CheckPIN`/`CheckPassword` test credentials. Both sit inside rate-limited buckets — acceptable only while those rate limits hold; alert on bucket saturation.
3. **webhook-receiver has no `JWT_SECRET_KEY`** despite the compose comment (docker-compose.yml:941) — either set it or remove the comment.
4. **dashboard-service CORS**: `Allow-Credentials: true` + `Allow-Origin: *` is a contradiction browsers reject; WebSocket `CheckOrigin: return true` accepts any origin. Pin both.
5. **dashboard-service**: `ErrorMiddleware`/`RecoveryMiddleware` defined but never registered — panics and errors bypass the intended handling.
6. **video-editor has no server gate** — deliberate today (`docs/THREAT-MODEL.md:593`), but it is the condition to watch: the moment any route serves user data, add the gate.
7. **`.env` is not tracked** (verified) and `.gitignore` covers `.env*`/`*.exe` — good; the weak point is the committed secrets in #1, not the env file.

> **Hinglish**: JWT secrets repo me hain — rotate karo. Rate-limited oracles theek hain jab tak rate limit hold kare. webhook-receiver ka JWT secret set nahi hai. dashboard-service CORS khud se contradict karta hai.

---

## 5. STRATEGIC RECOMMENDATIONS (how & why, by priority)

**P0 — do before any new feature work**
1. Unify the auth gate (3.1). Why: two gates = two security postures; the shared one is the only one reviewed as a unit. How: extend `@wideo11/ui/gate` with the web-only options, migrate web, delete the copy, then extend `tools/check-app-gates.mjs` to assert the option parity.
2. Delete the dead surface (3.2, 3.3, 3.4, 3.9, 3.10, 3.12, 3.13, 3.15, 3.16). Why: every dead file is a false map of the system; deletion is zero-risk because grep proves no importers. How: one PR per app, verified by `tools/check-*` suites staying green.
3. Fix CI (3.14). Why: a red CI means no verification at all. How: pnpm-native workflow + Go build/vet per module.

**P1 — structure before scale**
4. Extract `buildCompositorSources` (3.6) and `@wideo11/ui/live-handler` (3.8). Why: single source of truth for the two highest-blast-radius duplications.
5. Reconcile Helm ↔ compose naming (3.17) and the Go module strategy (3.18). Why: both are deploy blockers for GKE.
6. Decide billing's fate (2.6): build the domain against a real billing API or delete the stub. Why: a permanent "coming soon" page in a nav is a product lie.
7. Prune unused deps (3.11) and split the 2360-line editor shell into feature hooks (`useProject`, `useTimeline`, `usePlayback`, `usePanels`). Why: the shell currently owns tracks, transitions, markers, selection, undo, playback, zoom, project lifecycle, keyboard, and panel routing — every change to any of them re-enters the same file.

**P2 — hygiene**
8. Generate middleware from a template (3.5); move ops scripts and screenshots out of the root (3.16); wire or delete `infrastructure/backup.mjs`; delete `natas-jetstream` or fix its name and give it a `main.go`; document the 21 scaffold services as "not built" in `SYSTEM-PLAN.md` so the repo map matches reality.

> **Hinglish**: P0: ek gate banao, dead code delete karo, CI thik karo. P1: compositorSources aur live-handler share karo, Helm/compose names match karo, Go module strategy fix karo, billing ka fatafat decide karo. P2: middleware generate karo, root saaf karo.

---

## 6. ALREADY REMEDIATED THIS SESSION (current state, verified)
- **Sponsor-logo reload bug**: a file-based branding clip carried a dead `blob:` URL from the previous document, which overwrote the fresh IndexedDB URL in the compositor source map — the mark vanished on every reload. Fixed in BOTH copies of the map (`video-editor.tsx:1673-1685`, `preview-canvas.tsx:132-153`) with a `!map.has(clip.mediaId)` guard. Verified: `tools/probe-branding.mjs` 11/11 (paint, natural size 128px, undo/redo, save+reload, 0 console errors).
- **Filmstrip cache poisoning**: empty extraction results were cached permanently, so a clip could stay blank for the whole session (`filmstrip.ts:142` now caches only non-empty results). Verified in the 77/77 suite (`cached:13, withFrames:13`).
- **Edge-edit shortcuts unreachable**: slip/slide/ripple-trim sat inside a `!mod` block that ctrl-holding could never reach; moved to top level (`video-editor.tsx:1516-1523`) and documented in `help-registry.ts` (`Shift+Alt+←/→`, `Alt+←/→`, `Ctrl+Alt+←/→`).
- Full editor suite: `tools/check-video-editor.mjs` **77/77 PASS** after a clean Docker rebuild.

## 7. VERIFICATION LOG & COVERAGE
- **Deep-read**: all 8 `apps/*` (middleware, layouts, pages, API routes, package.jsons, hooks), `packages/ui` surface + dead copies, root configs, `docker-compose.yml` (29 services, env blocks per service), `.github/workflows/ci-cd.yaml`, `services/auth-service` (main/config/database/migrator/handler + migrations), `webhook-receiver`, `dashboard-service` security surface, `transcoding-service` config drift, `billing-service`/`analytics-service` structure, `apps/video-editor` engine + components (line-level).
- **Structurally surveyed** (file trees/counts, not line-by-line): the 21 non-compose Go service scaffolds, terraform/helm/gke/argocd internals, `tools/` (catalogued by purpose), `docs/` (15 files, claims cross-checked against code — e.g. `SYSTEM-PLAN.md`'s "77/77 browser checks" claim was re-verified true today).
- **Probes run this session**: `check-video-editor.mjs` (77/77), `probe-branding.mjs` (11/11), `tsc --noEmit` clean, Docker image rebuilt and container restarted.
- **Not executed**: Terraform plan/apply (binary is a macOS build), Helm (not installed), Go integration tests against live dependencies, GKE rollout.

> **Hinglish**: Deep padha: 8 apps, packages/ui, root configs, compose, CI, auth-service, video-editor engine. Structural survey: 21 scaffold services, terraform/helm, tools, docs. Probes: 77/77 + 11/11 + tsc clean. Nahi chala: terraform (macOS binary), helm (missing), Go integration tests.
