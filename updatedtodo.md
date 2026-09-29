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

- **Nothing is committed.** Migrations 003–010 are applied to the database but
  the working tree has ~30 modified files unreviewed.
- **Test accounts were promoted to `superadmin`** during verification. They are
  now purged, but check for any others before deploying.
- **`packages/common/public/` is untouched** and clean.
- **Headless testing cannot do real WebAuthn** — biometric enrollment was
  verified via the skip path. The Windows Hello face flow needs one run in your
  own browser to confirm end-to-end.
