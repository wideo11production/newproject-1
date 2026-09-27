# ⚠️ PROGRESS LEDGER — Wideo11 / Paimana

> **Ye file `updatedtodo.md` ka companion hai.**(updatedtodo.md me 22 phases hain -
> wo product roadmap hai, isme "kaam hua kya" ka verified record hai.)
>
> **IMPORTANT:** Purane checkmarks `[x]` VERIFIED NAHI hain. Maine code chala kar
> dekha hai - kai "complete" phase us service par the jisne kabhi compile bhi
> nahi hua tha (jaise auth-service, jisme 8 bugs the). Isliye neeche **sirf
> verified-by-execution** status likha hai.
>
> Verification ka tareeka: `docker compose build` + `go build ./...` + `go test ./...`
> + live container/script probes.

---

## ✅ VERIFIED WORKING (evidence-based)

### Infrastructure & Core
| Item | Evidence |
|---|---|
| 23 containers healthy | `docker compose ps` → 23/23 healthy |
| pnpm monorepo build | 19 images, `docker compose build` exit 0 |
| Native-module build fix | `python3/make/g++` + `PYTHON` + `build_from_source` inline in all 9 app Dockerfiles (bcrypt was a latent CI breaker) |
| Grafana enterprise theme | 9/9 apps import `enterpriseTheme` (`packages/ui/src/enterprise-theme.ts`) |
| Design tokens | `packages/ui/src/design-system.ts` (44px inputs, palette, buttons, badges, alerts) |
| Activity telemetry | `click_events` table, 30-day auto-purge worker, all 8 apps report |

### Auth & Security
| Item | Evidence |
|---|---|
| auth-service compiles + runs | port 8085 healthy, login 200 |
| **JWT empty-secret patch** | `mapstructure:"secret_key"` tag added - pehle service EMPTY secret se sign kar rahi thi (forge-able tokens). Fixed + verified cross-service |
| bcrypt cost 12 | `internal/password` → 8 tests pass |
| Session tokens hashed | SHA-256 in `sessions` (raw JWT DB leak = session hijack; fixed) |
| WebAuthn signature model | registration + assertion verified, 2 recovery accounts |
| 3-strike lockout | attempt 3 → 423 `pin_required` |
| Wrong-PIN 3-min block | 423 + exact spec message + `seconds_remaining: 179` |
| Payout auth gap CLOSED | unauthed `/payouts` → 401; user ID from token not URL |
| Payout identity dedup | 4th account on same UPI → 409 (UNIQUE index, DB-enforced) |
| Automated KYC | `local` provider, auto `pending`→`verified`, IFSC reserved-char rule |
| 30-min unverified purge | hard delete + tokens + purge email (exact spec wording) |

### Billing Laws (46 tests green)
| Rule | Test |
|---|---|
| 5% sister share | `TestSisterShareIsExactlyFivePercent` |
| INR 2000 buffer mask | `TestMaintenanceBufferIsExactly2000`, `TestTransferableExcludesBuffer` |
| 2-decimal half-up rounding | `TestRevenueSplitRoundingConserves` |
| Device cap ₹5000 / review ₹1500 | `TestMaxPayoutIdentitiesPerUser` + live |
| Ad split 60/20/20 | `TestRevenueSplitSubscribedCreator` |

### Media Pipeline
| Item | Evidence |
|---|---|
| MinIO self-hosted | **built from source** (DockerHub + quay both blocked) |
| Transcoder → MinIO | job COMPLETE 852ms, 2 files uploaded, valid HLS playlist + .ts |
| Real MinIO metrics | `minio-exporter` → 1,451,984 bytes / 10 objects, `scrape_error=0` |
| dataEgress badge | **amber SEEDED → green LIVE** (no longer seeded) |

### Superadmin (port 3008)
| Item | Evidence |
|---|---|
| Awareness grid + red-flash critical alerts | `/superadmin` 200 |
| **Registration Date column** | `users.created_at` hook added; all 4 users populate |
| **Per-Device Ad Earnings column** | `device_ad_revenue` hook; cap ₹5000/review ₹1500 shown |
| Cross-DB merge | `api/ledger` merges auth DB + billing DB (SQL JOIN impossible across DBs) |
| Staff/recovery role flags | `is_superadmin`, `is_recovery` |
| ListAllActivity fix | now bases on `users` (was session-only → showed 0 users) |

### Apps
| Item | Evidence |
|---|---|
| 8 frontends | all 200 (3000-3005, 3007, 3008). **3006 removed** |
| Tab metadata | `icon.svg` + `apple-icon.svg` + `manifest.ts` — icon HTTP 200 (pehle koi icon hi nahi tha) |
| `apps/editor` merged | deleted; content → `video-editor/src/app/components/script-engine/`, fully interactive |
| Script engine responsive | `lg:420px` / `md:340px` / `<md hidden` - timeline protected |
| Wino / Mino / Rino | inline SVG mascots (`components/brand/mascots.tsx`) + empty-state |
| In-house ad engine | `/ads` 200, MRC 2s + 50% pixels, tab-pause, randomized 5-20s |

---

## 🔴 KNOWN GAPS (not fake-complete)

| Gap | Why |
|---|---|
| **0 integration tests** | 46 unit tests only; no end-to-end API/flow tests |
| 32 services not deployed | Built but not in compose (intentional, roadmap) |
| No CI pipeline | Builds verified manually only |
| No ingress/TLS | Local only |
| `device_ad_revenue` table empty | Flow exists; no ad revenue recorded in dev |
| Landing deep telemetry | Click capture done; **section-duration/scroll-depth NOT built** |
| Phase 0/1 roadmap in updatedtodo | Needs re-verification (same drift that hid auth bugs) |

---

## 🚫 TRAPS TO AVOID (cost + reliability)

1. **Never trust a `[x]` in updatedtodo.md without running the build.** Auth-service was "complete" and had never compiled.
2. **Docker Hub / quay.io are blocked here** - MinIO had to be built from source. Same may apply to other images.
3. **Caching hides build breaks.** Changing `packages/*` busts the cache and can surface latent Dockerfile failures (bcrypt was one).
4. **Do not duplicate money math in the client.** 60/20/20, 5%, ₹2000 live ONLY in billing-service + tests. React must never calculate payout.
5. **Local config ≠ production.** `JWT_SECRET_KEY`, `MINIO_ROOT_PASSWORD`, recovery passwords are all sandbox values.

---

## 📋 NEXT EXECUTION ORDER

Superadmin stays LAST (per director). Order:

1. **Integration tests** (auth + billing flows) - closes the biggest gap
2. **Landing deep telemetry** - section-duration + scroll-depth → security_events
3. **Ad revenue recording flow** - populate `device_ad_revenue` so caps are demonstrable
4. **CI pipeline** - build + test gate on push
5. **Ingress/TLS** - GKE readiness
6. **Re-verify updatedtodo Phases 0-7** - then Phase 8+
7. **Superadmin alerts + awareness grid final pass** - LAST
