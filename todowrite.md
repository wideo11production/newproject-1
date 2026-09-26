# Wideo11 / Paimana — Master Audit & Execution Roadmap

> **Ye document code padh kar, build chala kar likha gaya hai. Checklist repeat nahi ki gayi —
> har claim VERIFIED hai ya clearly "unknown" mark kiya gaya hai.**
>
> Reference docs: `TODO.md` (video-editor task list), `updatedtodo.md` (22-phase master plan).
> Ye dono files ke saath cross-check karke likha gaya hai.

---

## PART 0 — Pehle ek zaroori baat (jo aapko nahi pata hoga)

`TODO.md` aur `updatedtodo.md` me jo 22 phases "✅ Complete" mark karte hain,
wo **verified nahi hain**. Maine haath se count kiye:

| Claim (updatedtodo.md) | Asli reality |
|---|---|
| "Phase 3 - Auth Service ✅" | Service thi, par **kabhi compile nahi hui**. 8 bugs the. Maine theek kiye. |
| "Phase 7 - Billing System ✅" | `billing-service` **abhi bhi** ek package me fail tha ( mera apna regression ) |
| "Phase 6 - Video Editor ✅" | HLS pipeline likhi gayi thi par MinIO **deploy hi nahi hai** |
| "Phase 4 - Database ✅" | Sirf 4 services ke liye DB hai, baaki ke liye nahi |

**Mera suggestion**: `updatedtodo.md` ke "✅" marks abhi bharosemandar nahi hain.
Jab tak automated test nahi hota, koi bhi phase "complete" nahi maana jaana chahiye.
Isi liye **Phase A (tests)** sabse upar hai neeche.

---

## PART 1 — VERIFIED inventory (jo maine khud check kiya)

### 1.1 Git
- Branch: `main`

### 1.2 Services: 41 directories, sirf 4 deploy hui hain
**Deploy (docker-compose me):**
```
dashboard-service, auth-service, webhook-receiver, billing-service
```
**Banaye hue par deploy nahi (37):** including `transcoding-service`, `video`, `user-service`, `profile`, `email`, `bot-service`, `gateway`, `nats-client`, `targeting-service`, `normalnotification`, aur ~27 aur.

### 1.3 Go build health: 30 compile, 7 BROKEN
Ye maine `go build ./...` chala kar nikale, guess nahi kiye:

| Service | Error | Risk |
|---|---|---|
| `billing-service` | `undefined: unix` + `sync` missing | **DEPLOYED** — maine abhi fix kiya |
| `transcoding-service` | `src/` me legacy files, galat import paths (`newproject/services/...`) | Deploy nahi, par dead code |
| `gateway` | `go.sum` missing (gin) | Deploy nahi |
| `normalnotification` | `go.sum` missing (gin) | Deploy nahi |
| `nats-client` | unused import + undefined `time` | Deploy nahi |
| `bot-service` | unknown field + undefined `strings` | Deploy nahi |
| `targeting-service` | unused import + unused var | Deploy nahi |

**Maine is turn me `billing-service` fix kar diya** (build-tagged `diskusage_linux.go` /
`diskusage_other.go` split). Baaki 6 deploy nahi hote, to risk low hai — par clean nahi hain.

### 1.4 TESTS: ZERO (ye sabse bada risk hai)
```
Go test files      : 0
Frontend test files: 0
```
Poore platform me **ek bhi automated test nahi**. 4 deployed services, ~30 compiling
services, 7 frontends — kuch bhi verified nahi hai.

### 1.5 Multi-currency: ZERO
```
currency / exchange / forex files: 0
```
Ye bilkul naya banana hai. (PART 4 me spec hai)

### 1.6 MinIO: DEPLOY NAHI
`docker-compose.yml` me MinIO **0 references**. Par transcoding-service MinIO se
bucket me video daalta hai, aur HLS/CDN architecture ka poora vaada isi par tikka hai.
**Matlab: video upload → transcode → stream ka chain aadha hai.** Storage hi nahi hai.

### 1.7 Frontends: 7 apps, sab build hote hain
`admin, monitor, analytics, billing, editor, video-editor, web` — sab individually compile hote hain.
`monitor` ka ek duplicate app dir pehle `.stale-backup/` me move kiya gaya tha.

### 1.8 Infra jo SAHI chal raha hai (ye mat chhedna)
- 17 containers healthy
- 76% ceiling (HPA/VPA) — `infrastructure/gke/`
- 1-min/IP rate limiter — live, 429 verify kiya
- Postfix (self-hosted mail) — koi paid provider nahi
- WebAuthn + signature model
- 30-min unverified-account purge
- 5% sister share + ₹2000 buffer masking (billing-service)

---

## PART 2 — Mera suggestion: STEP ORDER (ye important hai)

Aapne pucha "kaunsa pehle, kaunsa baad me". Mera order ye hai **har step ki wajah ke saath**:

### PHASE A — Safety net (PEHLE, kuch bhi aur karne se pehle) 🔴
**Kyun pehle:** 0 tests ke saath har refactor lottery hai. Ek galti = chupke se production me bug.

| # | Kaam | Time |
|---|------|------|
| A1 | `auth-service` ke liye integration tests (register→verify→login→purge) | 1 din |
| A2 | `billing-service` ke liye tests (5% sister share, ₹2000 mask) | 1 din |
| A3 | 6 broken services ya fix karo ya delete (PART 5) | 1 din |
| A4 | CI: `go build ./...` + `go test ./...` har push pe | 0.5 din |

**Rule: A complete na ho to B shuru mat karo.**

### PHASE B — Storage (video ka foundation) 🔴
**Kyun:** MinIO nahi hai to transcoding ka koi matlab nahi. Poora video product is par tikka hai.

| # | Kaam |
|---|------|
| B1 | MinIO container add karo (self-hosted, free) + `video` bucket |
| B2 | `transcoding-service` ko compose me add karo (abhi orphan hai) + uski legacy `src/` delete |
| B3 | End-to-end test: upload → HLS chunks → bucket me |

### PHASE C — Multi-currency microservice 🟡 (PART 4 me spec)
**Kyun ab:** Ye billing-service se pehle chahiye, kyunki har price/earning usi table se aayegi.

### PHASE D — Custom dashboard (Grafana replacement) 🟡
**Kyun:** Abhi `monitor` app random mock data dikhata hai (`generateMockMetrics()`).
Wo real nahi hai. Prometheus se wire karna padega.

### PHASE E — Cleanup (dead code + junk) 🟢
Safe hai, koi risk nahi. Details PART 5.

### PHASE F — GKE production readiness 🔴
Ingress/TLS, secrets, backups, resource limits. Details PART 6.

### PHASE G — updatedtodo.md ke bade features (Phase 9-22)
Marketplace, collaboration, AI, PWA. Ye PHASE A-F ke BAAD me karo — warna
unverified foundation pe 6 mahine ka kaam barbad ho jayega.

---

## PART 3 — Missing / skipped / galat jagah laga (verified list)

### 3.1 "Galat jagah laga hua" — jo aapne pucha
| Item | Problem |
|---|---|
| `monitor` app | `@metrics/page.tsx` me `generateMockMetrics()` — **random data**, real metrics nahi |
| `transcoding-service` | Deploy nahi, par `src/` me purana duplicate code hai |
| `video` service | Deploy nahi. HLS storage (MinIO) bhi nahi |
| `updatedtodo.md` | "✅" marks reality se match nahi karte (PART 0) |
| `services/auth`, `services/user`, `services/profile` | Purani duplicate services, `auth-service` ke saath overlap |

### 3.2 Missing — kuch bhi nahi bana
- **Automated tests (0)** — PART 1.4
- **Multi-currency (0)** — PART 1.5
- **MinIO / video bucket** — PART 1.6
- **CI/CD pipeline** — `updatedtodo.md` Phase 8 me hai, repo me koi CI nahi
- **Ingress / TLS** — localhi localhost ports pe chal raha hai
- **Rate limiting on login** — frontend proxy pe hai, direct auth-service pe nahi
- **Email real delivery** — Postfix capture mode me hai (log), MX record chahiye

---

## PART 4 — MULTI-CURRENCY MICROSERVICE (naya, aapka naya requirement)

### 4.1 Aapki requirement (as maine samjha)
- Alag microservice banayega
- Alag app me use hoga
- **24 hours me ek FIXED time par** rates update honge (har request pe nahi)
- Apni table me store karega
- Baaki har jagah wahin se rates padhe — baar baar update nahi

### 4.2 Design (main suggest kar raha hoon)

**Service name:** `currency-service` (port 8086)

**Table (SSOT) — `exchange_rates`:**
```sql
CREATE TABLE exchange_rates (
  id            SERIAL PRIMARY KEY,
  base_currency CHAR(3) NOT NULL DEFAULT 'INR',
  quote_currency CHAR(3) NOT NULL,
  rate          NUMERIC(20,8) NOT NULL,
  source        VARCHAR(64) NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (base_currency, quote_currency)
);
```

**24-hour schedule — mera strong suggestion:**
Har 24 ghante me ek **fixed UTC time** par update (jaise 01:00 UTC).
**Kyun cron expression se better hai:** Cron ka "daily" hota hai, "24 hours
baad" nahi. Agar ek run 10 min late ho to agla 24 ghante baad hoga — gap badh
jata rahega. Fixed-time scheduler se gap hamesha exactly 24h rehta hai.

```
RATE_UPDATE_CRON=0 1 * * *     # daily 01:00 UTC
RATE_FETCH_TIMEOUT_SECONDS=30
```

### 4.3 "Koi teesra party ko paisa nahi" — ye important hai ⚠️

Aapne kaha kisi ko ek bhi penny nahi deni. **Rate feed iska sabse bada risk hai.**

| Source | Cost | Note |
|---|---|---|
| **Open Exchange Rates / Fixer / CurrencyLayer** | ❌ Paid tiers, API key | Inse bachein |
| **Google Finance scrape** | Free but ❌ **ToS violation + fragile** | **Mat karein** |
| **DBpedia / Wikidata** | Free | Weak data, real-time nahi |
| **Frankfurter.app** | Free, no key | ⚠️ ECB data — decent, no money |
| **Manual/DB seed rates** | Free, zero risk | ✅ Local dev ke liye best |

**Mera suggestion:**
1. **Abhi** — table ko seed data se bharo (INR base, common pairs). Zero network
   dependency, zero cost, fully deterministic. Local dev ke liye PERFECT.
2. **24h scheduler** — usi table ko update karta rahe, source pluggable.
3. **Free source add karo** (`RATE_SOURCE=manual|frankfurter`). Frankfurter
   free hai aur API key nahi maangta.
4. **KABHI paid tier subscribe mat karo** jab tak revenue na aaye.

Ye approach "no penny" rule ko **architecturally** enforce karti hai — kyunki
default path me koi network call hi nahi hai.

### 4.4 Files jo banenge
```
services/currency-service/
  cmd/currency-service/main.go
  internal/config/config.go       # SSOT env
  internal/model/rate.go          # exchange_rates model
  internal/repository/rate.go
  internal/service/rate.go         # convert, list, refresh
  internal/scheduler/scheduler.go # 24h fixed-time
  internal/fetcher/fetcher.go     # pluggable source (manual default)
  Dockerfile
apps/currency/                    # alag app (aapki requirement)
  src/app/page.tsx
```

---

## PART 5 — DELETE kya hai (aapne authorized kiya hai) ⚠️

Maine **abhi tak kuch nahi delete kiya** — confirmation ka wait kar raha hoon.
Ye safe-to-delete list hai, evidence-based:

### 5.1 Root junk (100% safe)
| File | Kyun |
|---|---|
| `test_import.go` | 202 bytes, random import experiment, `package main` — kuch nahi karta |
| `audit.txt` | Purana audit output |
| `migration_report.txt` | Purana migration log |
| `yaml_updates.txt` | Scratch notes |
| `TODO.md.bak` | Backup — `TODO.md` maujood hai |

### 5.2 Dead Go code (pehle confirm karo)
| Item | Kyun |
|---|---|
| `transcoding-service/src/` | Legacy duplicate, galat import paths, `./cmd` se replace ho chuka hai |
| `services/auth/` vs `auth-service/` | Purana `auth` duplicate hai |
| `services/user/` vs `user-service/` | Same duplication |

### 5.3 Broken services — 3 options (aapka faisla)
`gateway`, `nats-client`, `normalnotification`, `bot-service`, `targeting-service`
— 5 broken, 0 deploy, 0 test.

- **Option A**: Fix karke deploy karo (agar roadmap me chahiye)
- **Option B**: `.md` me "planned" mark karo, repo se delete (recommended abhi)
- **Option C**: Chhodo rahe ho

**Mera suggestion: Option B.** 5 services jo compile nahi hote, deploy nahi hote,
aur test nahi hote — wo sirf confusion create karte hain. Roadmap me likh do,
jab zaroorat ho tab banayein.

---

## PART 6 — GKE production readiness (PRICE-TRAP warnings)

**Ye wahi jagah hai jahan galti se paisa chala jaata hai.** 7 galtiyan jo log karte hain:

| # | Trap | Fix |
|---|---|---|
| 1 | Cloudflare **CDN** free nahi hai (bandwidth charge) | Apna CDN ya direct bucket + signed URLs. **Aapne kaha CDN banao — sahi decision** |
| 2 | GKE **Always Free** sirf `e2-small` 1 node, limited | Budget alert lagao. Node pool `e2-standard-4` pehle se bada hai |
| 3 | **Cloud NAT** egress ke liye charge | Free tier me limited hai |
| 4 | **In-cluster load balancer** bill hota hai | Ingress + Cloudflare Tunnel (free) socho |
| 5 | Prometheus/Grafana cloud free tier | Aapne sahi kaha — **self-hosted Prometheus already chal raha hai** |
| 6 | **Backblaze/Bunny CDN** paid | Apna MinIO + egress track karo |
| 7 | **SendGrid/Mailgun** mail ke liye paid | ✅ Aapne sahi kaha — **Postfix self-hosted** |

**Production checklist:**
- [ ] Secrets `.env` me (git me NAHI) — `.gitignore` me hai ✅ verify karo
- [ ] Ingress + TLS (Let's Encrypt free)
- [ ] `resources.limits` har container pe (CPU/memory) — abhi compose me nahi hai
- [ ] Postgres backup cron (local storage pe, external nahi)
- [ ] Budget alert GCP me
- [ ] `min-h[600px]` etc. verified ✅

---

## PART 7 — Is turn me kya COMPLETE hua (evidence-based)

Ye sab VERIFIED hai - live commands se check kiya, guess nahi.

### 7.1 Cleanup (DONE)
| Item | Status |
|------|--------|
| `test_import.go`, `audit.txt`, `migration_report.txt`, `yaml_updates.txt`, `TODO.md.bak` | ✅ Deleted |
| `gateway`, `nats-client`, `normalnotification`, `bot-service`, `targeting-service` | ✅ Deleted (5 broken, 0 deployed) |
| `transcoding-service/src/` legacy duplicate | ✅ Deleted (galat import paths) |
| `billing-service` broken package | ✅ Fixed (build-tagged diskusage split) |
| Services count | 41 → **36** |

### 7.2 MinIO DEPLOYED (DONE) ✅
- **Registry trap avoid kiya**: `minio/minio` Docker Hub par BLOCKED tha
  ("pull access denied"), quay.io bhi (401 UNAUTHORIZED). **Source se build kiya**
  - Go binary compile karke minimal Alpine image. Zero registry dependency.
- Buckets: `video` + `thumbnails` ✅
- Verified: object write + read (16B) ✅
- Console: http://localhost:9001
- `mc` (client) bhi source se build kiya kyunki `minio/mc` bhi blocked tha

### 7.3 TESTS — 17 PASSING (pehle ZERO the) ✅
| Suite | Tests | Covers |
|-------|-------|--------|
| `auth-service/internal/password` | **8 PASS** | bcrypt cost 12, no plaintext, salt, 72-byte limit, SHA-256 token hashing |
| `billing-service/src/service` | **9 PASS** | 5% sister share, INR 2000 buffer mask, transfer limits, law independence |

Ye tests **deliberately FAIL** karenge agar koi future change 5% share ya INR 2000
mask tod de. Ye pehle ZERO safety net thi.

### 7.4 MULTI-CURRENCY SERVICE (DONE) ✅
- `services/currency-service/` port **8086**, healthy
- Tables: `exchange_rates` (SSOT) + `conversion_history` (audit)
- 12 currencies seeded, verified conversion: 1000 INR → 12 USD ✅
- **Inverse pairs work** (USD→INR auto-inverts) ✅
- **24h FIXED interval** (cron nahi - drift nahi hoga)
- **Default source = `manual`** = koi network call NAHI = **zero-cost guarantee**
- Paid sources (Open Exchange/Fixer/CurrencyLayer) jaan-boojh kar nahi diye

### 7.5 REAL PROMETHEUS (DONE) ✅
- `generateMockMetrics()` **DELETED** (fake `Math.random()` data)
- Real metrics flowing: `cpuCores=1.51`, `memoryGB=3.42`, `networkRxGB=12.64`, `containersUp=4`
- **cAdvisor ADDED** (bina iske container metrics exist hi nahi karti thi)
- Prometheus config bug fix: duplicate `cadvisor` job (container crash kar raha tha)
- `dataEgress` honestly **"SEEDED"** marked - fake ko real jaisa NAHI dikhaya

### 7.6 FONT STACK (DONE) ✅
- `next/font/google` se Inter **hataya** 4 apps se (build crash karta tha)
- Grafana system stack, 7 apps me, shared constant se
- `monitor` ka missing `<html>`/`<body>` bhi fix kiya

---

## PART 7B — Ab bhi BAQI hai (honest list)

Ye maine is turn me NAHI kiya, aur wajah saaf hai:

| Item | Kyu nahi hua | Kya chahiye |
|------|---------------|-------------|
| **36 me se 32 services deploy nahi** | Wo roadmap ke future phases hain, broken bhi nahi | Phase-wise deploy |
| **transcoding-service deploy nahi** | Rebuild karna hai MinIO se wire karke | MinIO ab ready hai |
| **Data egress REAL nahi** | MinIO Prometheus export nahi karta | MinIO exporter ya custom collector |
| **CI/CD nahi** | Time nahi mila | GitHub Actions |
| **Ingress/TLS nahi** | GKE infra chahiye | Let's Encrypt (free) |
| **Currency frontend app nahi** | Backend ready hai, `apps/currency` banana bacha | 1-2 ghante |
| **Auth integration tests nahi** | Sirf password unit tests hue | DB-backed integration tests |

**Recommended next step:** transcoding-service ko MinIO se wire karke deploy
karna - kyunki ab storage ready hai aur HLS pipeline ka foundation pura hai.

## PART 9 — Latest turn: currency + transcoding + CRITICAL static-asset fix

### 9.1 Currency: rounding + dual-source (DONE) ✅
- **2-decimal rounding** applied (aapne confirm kiya). Rule: round-half-up.
  Verified: `333.33 INR → USD = 3.48` (raw = 3.48036)
- **Dual-source failover** live:
  - Primary: **Frankfurter** (free, no key) — currently serving ✅
  - Secondary: **exchangerate-api** (free tier, key in `.env`)
  - Agar primary fail ho → secondary automatically pick hota hai
  - Dono fail → rates UNCHANGED (stale ho jayenge par system TOOTEGA nahi)
- API key `.env` me (SSOT), code me **kabhi nahi**
- 12 currencies, live, source tracked per-rate

### 9.2 FFmpeg transcoder REAL + deployed (DONE) ✅
Pehle sirf log karta tha. Ab **asli pipeline**:
- FFmpeg **actually chalta hai** → `.m3u8` + `.ts` chunks
- Chunks **MinIO `video` bucket me upload** hote hain
- Playlist URL client ko milta hai
- **Verified end-to-end**: 852ms me transcode, 2 files uploaded,
  valid playlist (`#EXTM3U`, VOD, `#EXT-X-ENDLIST`), 264KiB segment
- 2 fixed bugs: Go `:=` shadowing (nil pointer crash) + doubled
  `video/video/` prefix + malformed public URL

### 9.3 Currency dashboard app (DONE) ✅
- `apps/currency` — port **3007**, healthy
- Live rates table + converter (2dp)
- Rate age / stale detection
- 100% air-gapped fonts

### 9.4 ⚠️ CRITICAL BUG FOUND & FIXED: JS bundles 404
**Ye bahut serious tha aur mujhe batana zaroori hai.**

SABHI 8 frontends ka JavaScript **404** ho raha tha. HTML 200 aata tha
(isliye mere pichhle checks pass ho gaye), lekin page ka JS load nahi hota
tha — matlab browser me page dikhta par **interactive nahi hota**.

**Root cause:** Dockerfile me maine static assets `/app/.next/static` me
copy kiye the, lekin standalone server `apps/<app>/server.js` se CHALTA
hai aur apne `__dirname` se static dhundhta hai = `apps/<app>/.next/static`.
Mismatch → 404.

**Fix:** static ab `apps/<app>/.next/static` me jaata hai (monitor ke liye
`apps/monitor/.next-monitor/static`, kyunki uska custom distDir hai).

**Verified:** saare 8 ports par JS bundle ab **200**.

**Mera galti:** maine sirf HTML status check kiya tha. JS bundle verify
nahi kiya tha. Isliye bug itne der se chala gaya.

---

## PART 10 — FINAL STATE (22 containers, sab healthy)

| Layer | Services |
|-------|----------|
| **Frontend (8)** | web:3000, monitor:3001, video-editor:3002, billing:3003, admin:3004, analytics:3005, editor:3006, **currency:3007** (NEW) |
| **Backend (6)** | dashboard:8080, webhook:8081, billing:8082, **transcoding:8083** (NEW), auth:8085, currency:8086 |
| **Infra (8)** | postgres, redis, nats, minio, mail, prometheus, alertmanager, cadvisor |

**Tests:** 17 passing (auth 8, billing 9)

---

## PART 8 — Ek saaf summary

**Jo kaam kar raha hai (17 containers healthy):**
Auth (real, tested), registration + email verification + 30-min purge, WebAuthn
signature model, self-hosted Postfix, rate limiter, 5% sister share, ₹2000 mask,
6 frontend apps build hote hain.

**Jo nahi chal raha:**
0 tests, 0 currency code, MinIO nahi, 6 services broken, 37 services deploy nahi,
monitor dashboard me fake data, CI nahi, ingress/TLS nahi.

**Mera suggestion — seedha baat:**
Aapka instinct sahi tha ki pehle study karo. Result ye aaya ki **foundation
(theek hai) par safety net (tests) aur storage (MinIO) missing hai.**
Multi-currency specs bilkul taiyaar hain. Agla step: **PHASE A (tests)** ya
**PHASE C (currency)** — aap kya karna chahte hain, wo bataiye.
