# NEWTODO — Wideo11 / WideoCut Pro: verified status + next build plan

> **Date:** 2026-10-05
> **Kaise bana:** `updatedtodo.md` (37 sessions, 6255 lines) ko live repo se
> **compare** kiya — har claim ko `grep`/`glob`/`read`/`go build`/`pnpm typecheck`
> se verify kiya, assert nahi kiya. Is repo ka apna rule hai: *"purane `[x]`
> VERIFIED NAHI hain"* — isliye is file me sirf verified status hai.
>
> **Hinglish:** ye file batati hai ki kya **bana hai**, kya **incomplete hai**,
> aur **kya banayenge** — with security/robustness/unique-ideas suggestions.

---

## PART 1 — Comparison: doc vs live repo

### ✅ BUILT & VERIFIED (do NOT rebuild — repo confirms)

| Area | State (evidence in repo today) |
|---|---|
| Auth chain | register/verify/login/resend, 30-min TTL, unverified blocked, Redis-backed 4-policy rate limiting (login 8/min, 9th → 429, per-account key) |
| Session security | JWT `jti` denylist **mounted** on logout + protected group (was dead code), session tokens SHA-256 hashed, bcrypt 12, migration 013 (`refresh_tokens.session_id` + CASCADE) |
| **RBAC** | `RequirePermission` / `RequireService` **exported AND wired** on channel routes (`cmd/auth-service/main.go:770-814`) + `rbac-wiring_test.go` pins it (5 tests incl. `TestSuperadminIsBarredFromCreatorCapabilities`) |
| Security gate | PIN → Questions → Biometric; skip in both branches; middleware caches only `true` (negative-caching loop fixed) |
| All 8 frontends | web, monitor, video-editor, billing, admin, analytics, superadmin, currency — postcss + globals everywhere, **real data only** (fabricated metrics purged from monitor/analytics) |
| Video editor (3002) | Movavi-parity NLE: frame-accurate timeline (24/25/30/50/60fps), compositor, 11 transitions, PiP, 15 grades, 15 audio effects, 21 pan/zoom presets, real thumbnails, multi-select/marquee, persistent undo/redo, local-DSP silence removal, camera/mic recording with REVIEW flow (save bug fixed, `tools/check-recorder.mjs` 9/9) |
| Monitoring | 7/7 Prometheus targets, 14 rules, nats-exporter + node-exporter, healthchecks on all 5 apps |
| Migrations | 001→013 replay clean + idempotent (replay harness) |
| Content policy | `content_upload_enabled` enforced on all 4 entry points (upload-url + finalize, before ownership check) |
| **CI** | pnpm + turbo (`ci-cd.yaml` converted — the old `npm ci` breakage is CLOSED) |
| **Typecheck** | root `pnpm typecheck` **9/9 green** (fixed today: `@wideo11/tsconfig` had no `name` field, so strict mode was silently off; 26 unmasked errors fixed) |
| Today's hardening | repo purge (7 `.dump` + `.bak` untracked), dashboard CORS allowlist (was `*` with credentials), webhook-receiver `JWT_SECRET_KEY` fail-closed binding |

### 🔴 INCOMPLETE — doc says open AND repo confirms

| # | Item | Why it matters |
|---|---|---|
| R1 | **Rotate `JWT_SECRET_KEY`** | Historical default is committed; validation can't un-publish it |
| R2 | **Rotate Gmail / OpenAI / Stripe keys** | Same — commit = disclosure |
| R3 | **Rotate superadmin password** | `DefaultSuperadminPasswordHash` still in source, offline-attackable |
| R4 | **Backup/restore service (Phase D3)** | **No service exists.** An untested backup is a rumour |
| P0.7 | **2 compose entries still fail-OPEN** | `docker-compose.yml:187` (dashboard-service) and `:1595` (billing-service Go) still `JWT_SECRET_KEY: ${JWT_SECRET_KEY:-}` — every other service is `:?` |
| P0.1–P0.3 | **Entitlement grants** (`POST /admin/entitlements`, trial-on-register, grant-on-payment) | Blocks **every quota in the product** |
| N1 | **7-day refresh only on :3008** | Other 7 apps discard refresh token → logout every 15 min. Fix belongs in `@wideo11/ui/gate` |
| N2 | **`/dashboard/plans` 404s** | Trial-countdown links to it; page does not exist (confirmed: no `dashboard/plans` in `apps/web`) |
| N3 | `channel_type` required by API but create form doesn't send it | Channel create fails for real users |
| N4 | `contentType` vs `content_type` inconsistency across upload handlers | Latent 400s |
| Y1 | **NATS click-ledger publisher has NO consumer** | Dashboard polls 12 req/min/operator; events durable but unread |
| Y2 | `GET /admin/clicks` unrate-limited (`limit=1000`) | Heavy aggregate on every poll |
| Y3 | In-process limiters on `/api/auth/register` + `/api/auth/verify` | `services/auth/README` admits not Redis-backed |
| S1 | **2FA at login** | PIN is asked *after* login — password alone grants a session (architectural, HIGH) |
| S2 | **PII retention purge** | 30-day purges specified; verify which telemetry tables actually have a deleting worker |
| S3 | Postfix for production email | Gmail ~500/day cap, lockable |
| B2–B5 | **Branding Phase B** (current frontier) | B2 missing; B3 partially built but **functionally dead**; B4/B5 missing |
| B-blocker-1 | Branding source never registered in compositor `sources` map | `paintBranding` does `sources.get(clip.mediaId)` → undefined → silent no-op, **no logo in preview or export** |
| B-blocker-2 | `/api/channels` unreachable from video-editor | Routes exist only in `apps/web/src/app/api/channels/**` (list, `[id]`, cover, logo, setup — 20+ BFF routes); video-editor has no rewrite/middleware → 404, panel shows empty state |
| E1 | Editor records **no clicks** (0 of 533 rows from :3002) | Most complex surface is invisible to analytics |
| E2 | Real upload endpoint for editor (multipart, resumable, progress, auth) | Deliberately not faked — a project of its own |
| E3 | Untested at scale: 1000+ clips, very long timelines, 4K export | Virtualisation proven at ~20 clips only |
| T1 | Test grants left in DB (`starter`, 42-min `trial` on rajajobhikar@gmail.com) | Remove when ready |
| F1 | Auto-subtitles, stabilisation, chroma key, motion tracking, slow motion, speech-bubble callouts, drop-frame timecode | Each shows a disabled mode with the reason in its tooltip |

### 🟡 DOC DRIFT — doc says open, actually CLOSED (fix the docs, not the code)

| Doc claim | Reality |
|---|---|
| Session 26 O1: "`requirePermission`/`requireService` defined and unwired" | **CLOSED** — exported, wired, test-pinned (see RBAC row above). `THREAT-MODEL.md` §4.2 is stale |
| CI uses `npm ci`/`npm test` | **CLOSED** — `ci-cd.yaml` is pnpm/turbo with explanatory comments |
| MinIO root creds / no security headers / no `jti` denylist / in-memory rate limit / `VERIFICATION_BASE_URL` / `content_upload_enabled` not enforced | All **CLOSED** per Sessions 2/13/19 with live evidence |

---

## PART 2 — NEWTODO: what we will build (priority order)

### Tier 1 — before any real user (RED, all small except where noted)

- [ ] **T1.1 Rotate the 4 secrets** (R1–R3) + scrub git history (`git filter-repo`), then rotate again. Scrubbing ≠ rotating; anyone who cloned already has them.
- [ ] **T1.2 Fail-closed the 2 remaining compose `:-`** (dashboard-service, billing-service Go) — 10-minute change, matches every other service.
- [ ] **T1.3 Entitlement grants P0.1–P0.3** — superadmin-gated `POST /admin/entitlements`, trial grant on registration, grant on payment success. Unblocks every quota in the product.
- [ ] **T1.4 `/dashboard/plans` page** — the trial countdown already links to it; build the page (plan list, current grant, expiry, upgrade CTA).
- [ ] **T1.5 `channel_type` in the create form** — one hidden field or a default; API already requires it.
- [ ] **T1.6 Branding Phase B unblock** (the two hard blockers above): register branding media in the compositor `sources` map, and expose channel routes to the editor (BFF routes under `apps/video-editor/src/app/api/channels/` like `apps/web` has, or a `next.config.mjs` rewrite). **Then** B2 (logo auto-on-new-clip), B3 (dedicated Branding track that bakes into export), B4 (3 device presets: 16:9 top-right · 9:16 top-left · 1:1 top-right), B5 (sponsor slot bottom-right / second user logo).

### Tier 2 — security architecture (HIGH value)

- [ ] **T2.1 2FA at login** — move the challenge **before** session issuance. WebAuthn credentials are already enrolled in the gate; reuse them as a login factor, with TOTP (Go stdlib HMAC, zero deps) as fallback. This is the one architectural gap that makes every other control secondary.
- [ ] **T2.2 PII retention purge** — scheduled job that deletes telemetry rows >30 days, logs what it deleted, and is itself tested (assert a row older than 30 days is gone).
- [ ] **T2.3 NATS consumer for the click ledger** (Y1) + rate-limit `GET /admin/clicks` (Y2) + Redis for the two in-process limiters (Y3).
- [ ] **T2.4 Refresh-token machinery in `@wideo11/ui/gate`** (N1) — one fix, seven apps stop logging users out every 15 minutes.
- [ ] **T2.5 Editor click tracking** (E1) — the editor already has `/api/audit`; wire the same `audit-handler` flush the other apps use, with `SERVER_SURFACE=editor`.

### Tier 3 — operations (the "rumour" killers)

- [ ] **T3.1 Phase D3 backup service** — scheduled snapshot, **off-site** copy, and an automated **restore drill** that provisions a scratch DB and runs the migration replay against the restored dump. Monthly.
- [ ] **T3.2 Integration test suite** — 46 unit tests exist, **zero** end-to-end. The project's own lesson: *"a test you have never seen fail is not known to work."* Start with the register→verify→login→gate→dashboard journey as a CI job (`tools/e2e-user-journey.mjs` already exists).
- [ ] **T3.3 CI gates** — promote the existing `tools/check-*.mjs` (video-editor, dashboard, recorder, editor-hooks, audit-secrets) from manual runs to CI jobs; `audit-secrets.mjs` currently lives only in a husky hook.
- [ ] **T3.4 Scale tests** (E3) — 1000-clip project, 10k-tick ruler, 4K export render; record memory + frame time, fail the build on regression.
- [ ] **T3.5 Chaos test** — kill the container mid-export; assert the project survives in IndexedDB and autosave restores it.

### Tier 4 — product depth (post-launch)

- [ ] **T4.1 Real upload endpoint** (E2) — multipart, resumable chunks, progress, auth. The editor's blob URLs are session-scoped by design; this is the honest next step.
- [ ] **T4.2 Viewer subscription management** (Phase B6) + email templates for channel/subscription events (D10) + content retention jobs (D11).
- [ ] **T4.3 Help menu + modal + T&Cs + "Made with WideoCut Pro" watermark** (Phase C).
- [ ] **T4.4 Polish pass** (Phase D/E): ruler fit, sidebar symmetry, avatar size, icon de-duplication, global orange-red icons.
- [ ] **T4.5 Editor AI modes** (F1) — see unique ideas below; each must stay offline and free.

---

## PART 3 — Suggestions: secure, robust, safe, unique

### Security (secure + safe)

1. **Fail-closed everywhere, fail-open nowhere.** Today's `:-`→`:?` sweep is the pattern; add a **lint rule** (O2) that rejects `NEXT_PUBLIC_*` in compose `environment:` blocks and any `${VAR:-}` on a secret — the config lying about the code is the bug class that bit this repo 4 times.
2. **Tamper-evident audit chain.** Hash-chain the security-events table (`event_hash = H(prev_hash || row)`); a delete leaves a hole everyone can see. Cheap, self-hosted, and a genuine differentiator for a platform handling creator earnings.
3. **CSP with per-request nonce + `report-to` endpoint.** Headers exist today; nonces make them actually block inline-script injection, and reports turn XSS attempts into telemetry.
4. **Secret scanning in CI, not just pre-commit** — husky is bypassable; CI is not.
5. **`security.txt` + a written key-compromise runbook** (rotate → scrub → invalidate sessions → notify). The repo has needed it twice already.
6. **Device-bound offline license tokens** (Ed25519-signed JWT, no phone-home) for the trial system — extends the existing device cap into a real licensing primitive.

### Robustness

7. **Every gate gets a wiring test.** The RBAC story is the template: `rbac-wiring_test.go` strips comments and asserts the middleware is *registered*, because a comment claiming a control is wired is not the control. Apply the same to the new entitlement gates.
8. **Assertion hygiene** — the repo's own recorded failure mode: a check that verifies the wrong thing (scrollbar width vs rendered gutter; drag-left asserting growth). New checks should assert *observable state*, not *configuration*.
9. **`pnpm audit` + SBOM in CI**; pin base images by digest.
10. **Load test the ledger path** (20 operators × 12 req/min) before the NATS consumer lands, so the fix is measured, not guessed.

### Unique ideas (differentiators that fit the constraints: no paid third party, self-hosted, honest UI)

11. **WebCodecs export** — real H.264/MP4 in-browser via `EncodedVideoChunk` + hardware encoder where supported, with the MediaRecorder WebM path as fallback. Turns "export is real-time WebM only" into "faster-than-real-time MP4" — the single biggest editor upgrade available, and it is a free browser API.
12. **WebGL chroma key shader** — the doc says chroma key is unshippable because "the canvas filter API has no chroma operator and a per-pixel JavaScript pass is too slow". A **fragment shader** is exactly the missing operator: GPU per-pixel, offline, free. This turns a stated limitation into a shipped feature.
13. **Local auto-subtitles via whisper.cpp compiled to WebGPU/ONNX-web** — runs on the user's machine, no key, no quota, no upload. Consistent with the "AI that costs nothing" philosophy already established for silence removal.
14. **WASM optical-flow stabilization** — compile a small stabilizer to WASM; motion estimation between frames, the thing the doc says needs "a real analysis job". It does — but it can ship as an offline WASM module.
15. **CRDT collaborative editing** over WebRTC/NATS — multiplayer NLE on self-hosted infra; NATS JetStream is already running.
16. **Forensic watermarking at export** — visible "WideoCut Pro" mark (Phase C) *plus* a steganographic per-export fingerprint in the first 100 frames: leak tracing for creator content, computed locally.
17. **Signed effect-pack store** — self-hosted, Ed25519-signed `.mpack`-style packages; the bundled Movavi title themes point at `#DOWNLOADABLE_PATH#` today, so a working signed-pack format replaces dead buttons with a real ecosystem.
18. **Differential-privacy analytics export** — superadmin can export creator statistics with noise injection; privacy-preserving by construction, which no competitor in this space advertises.
19. **Screen-reader timeline narration** — the editor already asserts `aria-label`s; a spoken narration of the timeline ("3 clips, 12 seconds, marker at 0:04") makes an NLE accessible, which is genuinely rare.
20. **Time-travel snapshots** — autosave every 2 minutes as immutable IndexedDB snapshots with a diff viewer; combined with the persistent undo stack it becomes "rewind to any minute of the last hour".

---

## How to verify this file stays honest

- Every "CLOSED" above was checked against the repo on 2026-10-05. Re-run the same greps before trusting any row: `docker-compose.yml` `JWT_SECRET_KEY` lines, `RequirePermission(` in `main.go`, `dashboard/plans` in `apps/web`, `ci-cd.yaml` runner commands.
- When an item is closed, move it to Part 1 with the evidence — the same correction discipline `updatedtodo.md` uses (mark in place, never silently delete).
- **Do not trust this file either.** It is a snapshot; the repo is the truth.
