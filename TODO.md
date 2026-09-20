# Wideo11 - Complete Implementation TODO

## Phase 0: Foundation Setup

### 0.1 Monorepo Initialization
- [ ] Initialize pnpm workspace with turbo
- [ ] Create directory structure: `apps/`, `packages/`, `services/`, `infrastructure/`
- [ ] Configure turbo.json for build pipeline
- [ ] Set up TypeScript strict config (shared)
- [ ] Configure ESLint + Prettier (shared)
- [ ] Set up Husky + lint-staged
- [ ] Create .gitignore, .npmrc, pnpm-workspace.yaml

### 0.2 Domain & DNS Structure
- [ ] Document domain mapping (wideo11.com, app.*, api.*, auth.*, editor.*, admin.*, ads.*, monitor.*, cdn.*)
- [ ] Set up Cloudflare/Terraform DNS records
- [ ] Configure SSL certificates (Let's Encrypt / Cloudflare)

### 0.3 Shared Tooling
- [ ] Create `packages/eslint-config` - shared ESLint config
- [ ] Create `packages/tsconfig` - shared TypeScript configs
- [ ] Create `packages/tailwind-config` - shared Tailwind config
- [ ] Create `packages/ui` - Shadcn/UI component library
- [ ] Create `packages/utils` - shared utilities (date, validation, formatting)
- [ ] Create `packages/constants` - SSOT constants (app name, limits, themes)

---

## Phase 1: SSOT Config Service (Go)

### 1.1 Config Service Core
- [x] Initialize Go module: `services/config-service`
- [x] Set up GORM with PostgreSQL
- [ ] Create config schema (key, value, type, description, is_secret, environment)
- [ ] Implement CRUD API for configs
- [ ] Add caching layer (Redis)
- [ ] Implement config watcher/pub-sub for live updates (NATS JetStream)
- [ ] Add validation & versioning
- [ ] Health check endpoint

### 1.2 Config Service Deployment
- [ ] Dockerfile for config-service
- [ ] Helm chart for K8s deployment
- [ ] ArgoCD application manifest
- [ ] Environment-specific values (dev/staging/prod)

---

## Phase 2: Infrastructure as Code

### 2.1 Terraform Modules
- [ ] GKE cluster module (primary region)
- [ ] VPC, subnets, NAT, firewall rules
- [ ] Cloud SQL (PostgreSQL) - primary + replicas
- [ ] Memorystore (Redis) - master + replicas + sentinel
- [ ] MinIO / GCS bucket setup
- [ ] **NATS JetStream cluster** (replace Kafka - self-hosted, no license cost)
- [ ] Load balancers & ingress controllers
- [ ] Cert-manager for SSL
- [ ] HashiCorp Vault setup

### 2.2 Helm Charts (Per Service)
- [ ] Base chart template (deployment, service, hpa, pdb, servicemonitor)
- [ ] Config-service chart
- [ ] Auth-service chart
- [ ] User-service chart
- [ ] Video-service chart
- [ ] Wallet-service chart
- [ ] Ads-service chart
- [ ] Monitoring chart (Prometheus, AlertManager, custom dashboard)
- [ ] NATS JetStream chart (cluster, streams, consumers)

### 2.3 GitOps (ArgoCD)
- [ ] ArgoCD installation & configuration
- [ ] Application manifests for each service
- [ ] App-of-apps pattern
- [ ] Sync windows & automation

---

## Phase 3: Core Microservices (Go + GORM)

### 3.1 Authentication Services
- [x] `auth-service`: JWT issuance/validation, token rotation
- [ ] `pin-service`: 6-digit PIN management, hashing (bcrypt/argon2)
- [ ] `session-service`: Session creation, validation, revocation, device tracking
- [ ] `device-service`: Device fingerprinting, trust scoring, known devices
- [x] `biometric-service`: WebAuthn/FIDO2 integration

### 3.2 User Services
- [x] `user-service`: User CRUD, email/password auth (no social login)
- [x] `profile-service`: Profile data, avatar, bio, preferences
- [x] `settings-service`: User settings (theme, notifications, privacy)
- [ ] `notification-service`: **Native push notification engine** (see Phase 3.7)

### 3.3 Video Services
- [x] `upload-service`: Chunked upload, virus scan (ClamAV), MinIO staging
- [x] `video-service`: Video metadata, processing status, quality variants
- [x] `transcoding-service`: FFmpeg workers, HLS/DASH generation (144p-8K)
- [x] `thumbnail-service`: Auto-gen + custom thumbnails, sprite sheets
- [x] `streaming-service`: HLS/DASH delivery, adaptive bitrate, signed URLs
- [x] `subtitle-service`: SRT/VTT upload, multi-language, auto-caption (Whisper)

### 3.4 Finance Services
- [x] `wallet-service`: Balance types (available, pending, held, withdrawable)
- [x] `accounting-service`: Double-entry ledger (journals, transactions, accounts)
- [x] `ledger-service`: Immutable audit trail, reconciliation
- [x] `withdrawal-service`: KYC, approval workflow, bank integration
- [x] `royalty-service`: SSOT-driven rates (INR/USD tiers), calculation engine
- [x] `billing-service`: Invoicing, tax, subscription management

### 3.5 Advertisement Services
- [x] `ads-service`: Ad inventory, placement, delivery (no Google AdSense)
- [x] `campaign-service`: Advertiser campaigns, budget, scheduling
- [x] `targeting-service`: Geo (country/state/city/locality), language, channel, category
- [ ] `analytics-service`: Views, clicks, CTR, reach, revenue aggregation

### 3.6 Support Services
- [ ] `help-service`: Ticket system, categories, SLA
- [ ] `faq-service`: Dynamic FAQ, versioning, search
- [ ] `bot-service`: AI chatbot (RAG over docs), escalation

### 3.7 **Push Notification Service (Native - Zero Cost)**
- [x] `push-service`: **Core push notification engine**
  - [x] VAPID key generation & management (self-hosted, no Firebase/OneSignal)
  - [x] Web Push Protocol (RFC 8030) implementation
  - [x] Subscription management (endpoint, p256dh, auth keys)
  - [x] Payload encryption (AES-GCM)
  - [x] TTL, urgency, topic support
  - [x] Batch sending with rate limiting
  - [x] Delivery receipts & retry logic (exponential backoff)
  - [x] Subscription cleanup (expired, 410/404 handling)
- [ ] `push-gateway`: **Multi-platform gateway**
  - [x] Web Push (browsers - Chrome, Firefox, Safari, Edge)
  - [x] FCM/APNs **optional fallback only** (config-driven, not default)
  - [x] Unified API for all platforms
  - [x] Template engine (localization, variables)
  - [x] Scheduling & delayed delivery
  - [x] Analytics: sent, delivered, clicked, dismissed, failed
- [x] `push-preferences`: User notification preferences
  - [x] Granular opt-in/out per category (video, comments, live, ads, system)
  - [x] Quiet hours, timezone awareness
  - [x] Frequency capping
  - [x] Device-level preferences

### 3.8 **NATS JetStream Event Backbone**
- [x] `services/nats-client` - Shared Go client (connection pool, codec, retry)
- [ ] Stream definitions (per domain):
  - [ ] `VIDEO` stream: upload, processing, completed, failed, thumbnail, subtitle
  - [ ] `WALLET` stream: transaction, balance_change, withdrawal, royalty
  - [ ] `ADS` stream: impression, click, conversion, revenue
  - [ ] `NOTIFICATION` stream: push, email, in_app, sms
  - [ ] `AUDIT` stream: auth, admin, security, compliance
  - [ ] `USER` stream: created, updated, deleted, device, session
  - [ ] `EDITOR` stream: project, asset, render, export, autosave
- [ ] Consumer patterns:
  - [ ] Durable consumers (per service, per stream)
  - [ ] Ephemeral consumers (for scaling workers)
  - [ ] Pull-based (controlled throughput) + Push-based (real-time)
  - [ ] Ack policies: explicit, all, none
  - [ ] Replay & catch-up (new consumer starts from beginning or last delivered)
  - [ ] Dead letter handling (max deliveries → DLQ stream)
- [ ] JetStream features:
  - [ ] Message mirroring (cross-cluster replication for DR)
  - [ ] Stream partitioning (by user_id, video_id for ordering)
  - [ ] Consumer scaling (multiple consumers per stream)
  - [ ] Message headers (tracing, correlation_id, causation_id)
  - [ ] Schema validation (JSON Schema per subject)

---

## Phase 4: Database Layer

### 4.1 PostgreSQL Schema (GORM Migrations)
- [ ] Users, devices, sessions, auth tables
- [ ] Videos, qualities, thumbnails, subtitles
- [ ] Wallets, ledger, journals, transactions, accounts
- [ ] Ads, campaigns, targeting rules, analytics
- [ ] Notifications, tickets, FAQs
- [ ] **Push subscriptions** (endpoint, keys, user_id, device_id, created_at, last_used)
- [ ] **Push messages** (id, subscription_id, payload, status, attempts, sent_at, delivered_at)
- [ ] Partition tables: users, videos, transactions, royalties, ads, logs, analytics, push_messages
- [ ] Indexes, constraints, foreign keys
- [ ] Row-level security policies

### 4.2 Redis Structure
- [ ] Session store (TTL)
- [ ] Config cache
- [ ] Rate limiting counters
- [ ] Video processing queues
- [ ] Real-time metrics buffers
- [ ] Push notification rate limits (per user, per IP)
- [ ] Push message deduplication cache

### 4.3 MinIO Buckets
- [ ] Raw uploads (temp)
- [ ] Processed videos (HLS/DASH segments)
- [ ] Thumbnails & sprites
- [ ] Subtitles
- [ ] Editor assets
- [ ] CDN origin

### 4.4 NATS JetStream Streams (Replaces Kafka Topics)
- [ ] `VIDEO.uploaded`, `VIDEO.processing`, `VIDEO.completed`, `VIDEO.failed`
- [ ] `VIDEO.thumbnail`, `VIDEO.subtitle`
- [ ] `WALLET.transaction`, `WALLET.balance`, `WALLET.withdrawal`, `WALLET.royalty`
- [ ] `ADS.impression`, `ADS.click`, `ADS.conversion`, `ADS.revenue`
- [ ] `NOTIFICATION.push`, `NOTIFICATION.email`, `NOTIFICATION.in_app`
- [ ] `AUDIT.auth`, `AUDIT.admin`, `AUDIT.security`
- [ ] `USER.created`, `USER.updated`, `USER.device`, `USER.session`
- [ ] `EDITOR.project`, `EDITOR.asset`, `EDITOR.render`, `EDITOR.export`, `EDITOR.autosave`

---

## Phase 5: Frontend Apps (Next.js)

### 5.1 Shared Packages
- [ ] `packages/api-client` - Typed API client (React Query + Zod)
- [ ] `packages/auth` - Auth hooks, guards, token management
- [ ] `packages/video-player` - Custom HLS/DASH player (hls.js/dash.js)
- [ ] `packages/editor-core` - Timeline, playback, render engines (shared)
- [ ] `packages/charts` - ECharts wrapper components (Grafana-like)
- [ ] `packages/dnd-dashboard` - Drag-drop dashboard grid system
- [ ] `packages/forms` - React Hook Form + Zod schemas
- [ ] `packages/i18n` - Multi-language support
- [ ] `packages/push-client` - **Web Push subscription UI, permission handling, VAPID public key**

### 5.2 Apps
- [ ] `apps/web` (app.wideo11.com) - Main video platform
  - [ ] Home, browse, search (Meilisearch)
  - [ ] Video watch page (player, comments, related)
  - [ ] Channel pages
  - [ ] Creator studio (analytics, videos, monetization)
  - [ ] Wallet & earnings
  - [ ] Settings, security center
  - [ ] **Push notification settings UI** (categories, quiet hours, devices)
  - [ ] PWA manifest, service worker (push event handler)

- [ ] `apps/auth` (auth.wideo11.com) - Auth flows
  - [ ] Login, register, password reset
  - [ ] PIN setup/verify
  - [ ] WebAuthn registration/authentication
  - [ ] Device management
  - [ ] Session management

- [ ] `apps/editor` (editor.wideo11.com) - Video Editor
  - [ ] Timeline engine (tracks, clips, keyframes)
  - [ ] Playback engine (frame-accurate seeking)
  - [ ] Render engine (WebCodecs / FFmpeg.wasm)
  - [ ] Export engine (H.264/HEVC, multiple qualities)
  - [ ] Autosave + recovery (IndexedDB + backend sync via NATS)
  - [ ] Editing tools: split, trim, cut, crop, rotate, resize, speed, reverse, freeze
  - [ ] PIP, green screen, motion tracking, masking
  - [ ] Audio studio: mixer, EQ, boost, volume curves, noise reduction, fade, voice recorder
  - [ ] Subtitle studio: SRT import, multi-language, animations
  - [ ] Screen recorder (screen/window/tab + mic/system/webcam)
  - [ ] Asset library: transitions, effects, fonts, templates, icons, overlays
  - [ ] Project backup/versioning (v1, v2, v3 + rollback)

- [ ] `apps/admin` (admin.wideo11.com) - Admin Panel
  - [ ] User management, moderation
  - [ ] Video moderation, copyright claims
  - [ ] Ads management, advertiser portal
  - [ ] Financial reports, royalty payouts
  - [ ] System health, feature flags
  - [ ] Audit logs, security center
  - [ ] **Push notification admin** (broadcast, test, stats, templates)

- [ ] `apps/ads` (ads.wideo11.com) - Advertiser Portal
  - [ ] Campaign builder (targeting, creative, budget)
  - [ ] Real-time analytics dashboard
  - [ ] Billing & invoices

- [ ] `apps/monitor` (monitor.wideo11.com) - Custom Observability Dashboard
  - [ ] **Grafana-like UI/UX** (dark theme, panels, grid)
  - [ ] Drag-drop dashboard builder (gridstack/react-grid-layout)
  - [ ] Panel types: Time series, Stat, Table, Bar, Pie, Heatmap, Map, Logs, Alerts
  - [ ] Prometheus query builder (PromQL helper)
  - [ ] Dashboard save/load/share (JSON model)
  - [ ] Variables, templating, annotations
  - [ ] Alert rules UI (create, test, silence)
  - [ ] Real-time WebSocket updates
  - [ ] **NATS JetStream monitoring panels** (stream lag, consumer lag, message rates)

---

## Phase 6: Custom Observability Dashboard (Replace Grafana)

### 6.1 Prometheus Integration
- [ ] ServiceMonitor CRDs for all Go services
- [ ] Custom metrics exposition (/metrics endpoint per service)
- [ ] PrometheusRule for alerting
- [ ] AlertManager config (routes, receivers, inhibition)

### 6.2 Webhook Receiver
- [ ] `services/webhook-receiver` (Go)
- [ ] Receive AlertManager webhooks
- [ ] Transform & forward to custom dashboard API
- [ ] Deduplication, grouping, routing
- [ ] Persistent alert history (PostgreSQL)

### 6.3 Custom Dashboard Backend
- [ ] `services/dashboard-service` (Go)
- [ ] Dashboard CRUD (JSON model: panels, layout, variables, queries)
- [ ] Panel data API (proxy to Prometheus /direct query)
- [ ] Real-time WebSocket for live updates
- [ ] Dashboard versioning, fork, import/export (Grafana JSON compatible)
- [ ] User preferences, favorites, teams

### 6.4 Dashboard Frontend (apps/monitor)
- [ ] Dark theme matching Grafana aesthetic
- [ ] Left nav: Home, Dashboards, Alerts, Explore
- [ ] Top bar: Time picker, refresh, variables
- [ ] Panel editor: Query tab (PromQL), Visualization tab, General tab
- [ ] Visualization types:
  - [ ] Time series (lines, bars, points, stacking, thresholds)
  - [ ] Stat (value, sparkline, color thresholds)
  - [ ] Table (sorting, filtering, pagination, coloring)
  - [ ] Bar gauge, Pie chart
  - [ ] Heatmap (bucketed time series)
  - [ ] Geomap (Prometheus geo labels)
  - [ ] Logs (Loki-compatible API)
  - [ ] Alert list, Alert history
- [ ] Drag-drop grid (resizable, movable, snap to grid)
- [ ] Dashboard settings: timezone, auto-refresh, links, annotations
- [ ] Keyboard shortcuts (Grafana-like)

---

## Phase 7: Video Editor Deep Dive

### 7.1 Core Engines
- [ ] Timeline Engine: Multi-track, snap, zoom, keyboard shortcuts
- [ ] Playback Engine: Frame-accurate, variable speed, loop regions
- [ ] Render Engine: WebCodecs API (fallback FFmpeg.wasm)
- [ ] Export Engine: Queue, progress, cancel, multiple formats
- [ ] Autosave Engine: Debounced, IndexedDB + backend sync (NATS)
- [ ] Recovery Engine: Crash detection, project restore UI

### 7.2 Editing Features
- [ ] Split/Trim/Cut (ripple/roll edit modes)
- [ ] Crop/Rotate/Resize (keyframeable)
- [ ] Speed ramping (curve editor)
- [ ] Reverse, Freeze frame
- [ ] Picture-in-Picture (position, scale, border)
- [ ] Green screen (chroma key, spill suppression)
- [ ] Motion tracking (point, planar - WASM/OpenCV)
- [ ] Masking (bezier, feather, animate)

### 7.3 Audio Studio
- [ ] Multi-track mixer (gain, pan, mute, solo)
- [ ] Parametric EQ (visual curve editor)
- [ ] Audio boost (loudness normalization)
- [ ] Volume curves (keyframe automation)
- [ ] Noise reduction (RNNoise WASM)
- [ ] Fade in/out (crossfade)
- [ ] Voice recorder (Web Audio API)

### 7.4 Subtitle Studio
- [ ] SRT/VTT import/export
- [ ] Multi-language tracks
- [ ] Style editor (font, size, color, outline, shadow, position)
- [ ] Animation presets (karaoke, typewriter, fade)
- [ ] Timeline sync (waveform overlay)

### 7.5 Asset Library
- [ ] Transitions (dip, slide, push, wipe, 3D)
- [ ] Effects (color, blur, glow, distortion, stylize)
- [ ] Fonts (Google Fonts + custom upload)
- [ ] Templates (pre-built compositions)
- [ ] Icons (SVG library)
- [ ] Overlays (lower thirds, social, branding)

---

## Phase 8: Security & Anti-Fraud

### 8.1 Security Layer (Infrastructure)
- [ ] WAF rules (Cloudflare/ModSecurity)
- [ ] Rate limiter (Redis sliding window, per IP/user/endpoint)
- [ ] Anti-bot (behavioral analysis, challenge pages)
- [ ] Fail2Ban (SSH, API abuse)
- [ ] mTLS (service-to-service, Istio/Linkerd)
- [ ] JWT rotation (short access, long refresh, revocation list)
- [ ] HashiCorp Vault (secrets, dynamic DB creds, PKI)

### 8.2 Anti-Fraud Service
- [ ] Event collector (focus, mouse, touch, keyboard)
- [ ] Device fingerprint (Canvas, WebGL, AudioContext, fonts, battery)
- [ ] Detection engines:
  - [ ] Bot detection (behavioral + ML)
  - [ ] VM/Emulator detection
  - [ ] Macro/Auto-clicker detection
- [ ] Risk scoring (0-100, weighted factors)
- [ ] Actions: Verify (40), Challenge (60), Lock (80), Ban (100)
- [ ] Admin review queue

### 8.3 Security Center (User-facing)
- [ ] Current device/browser/IP/network/location
- [ ] Login history (device, location, time, success/failed)
- [ ] Session management (revoke all, revoke one)
- [ ] Known devices (trust, rename, remove)
- [ ] 2FA methods: Email, PIN, WebAuthn, Biometric, OTP

---

## Phase 9: Creator Studio & Analytics

### 9.1 Creator Dashboard
- [ ] Overview: Views, Watch time, Revenue, Subscribers, CTR
- [ ] Top countries map (choropleth)
- [ ] Real-time viewer count
- [ ] Revenue breakdown (ads, memberships, super chats)

### 9.2 Channel Features
- [ ] Community posts (text, image, poll, video)
- [ ] Polls (multiple choice, results)
- [ ] Playlists (auto, manual, series)
- [ ] Scheduled videos (timezone aware)
- [ ] Premieres (live chat, countdown)
- [ ] Memberships (tiers, perks, badges)

---

## Phase 10: Testing & Quality

### 10.1 Test Infrastructure
- [ ] Unit tests (Go: testify, Frontend: Vitest + React Testing Library)
- [ ] Integration tests (Testcontainers: Postgres, Redis, NATS, MinIO)
- [ ] Contract tests (Pact)
- [ ] E2E tests (Playwright)
- [ ] Load tests (k6)
- [ ] Chaos engineering (LitmusChaos)

### 10.2 Sandbox Environment
- [ ] Separate namespace/cluster
- [ ] Separate DB, Redis, MinIO, **NATS JetStream**
- [ ] Dummy wallet (₹20,00,000)
- [ ] Test ads, test analytics
- [ ] Data seeding scripts

---

## Phase 11: Production Launch Automation

### 11.1 One-Click Production Tool
- [ ] Go CLI: `go-production`
- [ ] Actions:
  - [ ] Delete dummy money
  - [ ] Delete test users
  - [ ] Delete test transactions
  - [ ] Recreate super admins
  - [ ] Reset analytics
  - [ ] Enable production mode (feature flag)
- [ ] Dry-run mode
- [ ] Audit log of all actions

---

## Phase 12: Advanced Patterns (Cross-cutting)

### 12.1 Architecture Patterns
- [ ] CQRS (Command Query Responsibility Segregation)
- [ ] Event Sourcing (event store → NATS JetStream as event log)
- [ ] Saga Pattern (distributed transactions via NATS)
- [ ] Outbox Pattern (reliable event publishing → NATS)
- [ ] Blue/Green Deployment
- [ ] Canary Deployment (Istio/Argo Rollouts)
- [ ] Rollback Deployment (one-click)

### 12.2 Data & Compliance
- [ ] Backup verification (automated restore test)
- [ ] Restore verification (checksum, row counts)
- [ ] API Versioning (URL + Header)
- [ ] Legal hold policies
- [ ] GDPR privacy controls (export, delete, consent)
- [ ] Data retention policies (automated cleanup)
- [ ] Audit trail (immutable, tamper-evident)

### 12.3 Observability (Beyond Dashboard)
- [ ] Distributed tracing (OpenTelemetry, Jaeger/Tempo)
- [ ] Log aggregation (Loki/Grafana Loki compatible)
- [ ] Continuous profiling (Pyroscope)
- [ ] Synthetic monitoring (uptime, API health)
- [ ] Business metrics (custom Prometheus metrics)

---

## Phase 13: Multi-Region & Disaster Recovery

### 13.1 Plan A/B/C
- [ ] Plan A: Primary (GKE Region A)
- [ ] Plan B: Standby (GKE Region B - warm)
- [ ] Plan C: Disaster Recovery (Own Datacenter - cold)
- [ ] Automated failover (health checks, DNS switch)
- [ ] Delta sync (Postgres logical replication, MinIO sync, Redis sync, **NATS JetStream mirroring**)
- [ ] Runbook documentation

### 13.2 Datacenter Migration
- [ ] Terraform for bare-metal/on-prem
- [ ] GitOps sync (ArgoCD multi-cluster)
- [ ] Data migration validation
- [ ] Traffic shadowing
- [ ] Cutover procedure

---

## Phase 14: Missing Features (From README + New)

- [ ] Meilisearch / OpenSearch (video, user, content search)
- [ ] Recommendation Engine (collaborative + content-based)
- [ ] Copyright Claim System (Content ID-like)
- [ ] Video Watermarking (visible + invisible/forensic)
- [ ] DRM Protection (Widevine/PlayReady/FairPlay)
- [ ] Data Export Center (user data, GDPR)
- [ ] Privacy Center (consent, cookies, tracking)
- [ ] Feature Flags (LaunchDarkly-style, self-hosted)
- [ ] Device Trust Engine (risk-based auth)
- [ ] Security Operations Center (SIEM integration)
- [ ] **Push Notification Service (native, zero cost)**
- [ ] **NATS JetStream (replaces Kafka, self-hosted)**
- [ ] **PWA Push Notifications (service worker, background sync)**
- [ ] **Email Service (self-hosted: Postal/Postfix + templates)**
- [ ] **SMS Service (provider-agnostic gateway, pluggable)**
- [ ] **In-App Notification Center (real-time, websocket/NATS)**

---

## Development Guidelines (Rules from README)

- [ ] **No `any`** - Strict TypeScript everywhere
- [ ] **No Hardcode** - All config from config-service
- [ ] **No Duplicate Logic** - Shared packages for all common code
- [ ] **SSOT Everywhere** - Single Source of Truth for config, rates, schemas
- [ ] **Cloud Agnostic** - Terraform + Helm + GitOps portable
- [ ] **No Empty Folders/Files** - Every file functional
- [ ] **Functional & Logically Working** - No stubs, no TODOs in code
- [ ] **Zero Third-Party Cost** - Self-host everything (NATS, Push, Email, Search, Analytics)

---

## Priority Order (Build Sequence)

1. **Auth + RBAC + Users** (Phase 3.1, 3.2)
2. **NATS JetStream Cluster** (Phase 2.1, 3.8) - **Event backbone first**
3. **Push Notification Service** (Phase 3.7) - **Native, zero cost**
4. **Video Upload + Streaming** (Phase 3.3, 4, 5.1)
5. **Creator Studio** (Phase 9)
6. **Wallet + Accounting** (Phase 3.4, 4)
7. **Advertiser System** (Phase 3.5)
8. **Video Editor** (Phase 7)
9. **Monitoring Dashboard** (Phase 6, 14)
10. **Multi Region** (Phase 13)
11. **Datacenter Migration** (Phase 13)
12. **Global Scale** (Phase 12, 14)

---

## Notes

- Each service: Go + GORM + gRPC + REST (gRPC for inter-service, REST for external)
- All frontend: Next.js 14+ App Router, TypeScript strict, Shadcn/UI, Tailwind, Zustand, React Query
- Database: PostgreSQL (partitioned) + Redis (cluster) + MinIO (distributed) + **NATS JetStream (event backbone)**
- Observability: Prometheus + OpenTelemetry + AlertManager + **Custom Dashboard (NO Grafana)**
- Security: Vault + mTLS + WAF + Rate Limit + Anti-Bot + JWT Rotation
- Deployment: Terraform + Helm + ArgoCD (GitOps)
- No social login, No Google AdSense, No Firebase/OneSignal, **Everything custom-built, zero recurring cost**
- **NATS JetStream** replaces Kafka: lighter, embedded, no JVM, better for cloud-native, built-in streaming + KV + Object Store
- **Web Push (RFC 8030)** replaces Firebase/OneSignal: VAPID keys, standard protocol, works everywhere