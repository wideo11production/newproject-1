# Wideo11 Monorepo

## Structure
```
apps/           # Next.js applications
packages/       # Shared packages (UI, utils, constants, etc.)
services/       # Go microservices
infrastructure/ # Terraform, Helm, ArgoCD configs
```

## Getting Started

### Prerequisites
- Node.js 20+
- pnpm 9+
- Go 1.22+
- Docker
- Kubernetes (kind/minikube for local)

### Install Dependencies
```bash
pnpm install
```

### Development
```bash
# Run all apps in development mode
pnpm dev

# Run specific app
pnpm --filter @wideo11/web dev
pnpm --filter @wideo11/auth dev
pnpm --filter @wideo11/editor dev
```

### Build
```bash
pnpm build
```

### Lint & Typecheck
```bash
pnpm lint
pnpm typecheck
```

### Test
```bash
pnpm test
```

## Apps

| App | Domain | Description |
|-----|--------|-------------|
| web | app.wideo11.com | Main video platform |
| auth | auth.wideo11.com | Authentication flows |
| editor | editor.wideo11.com | Video editor |
| admin | admin.wideo11.com | Admin panel |
| ads | ads.wideo11.com | Advertiser portal |
| monitor | monitor.wideo11.com | Custom observability dashboard |

## Packages

| Package | Description |
|---------|-------------|
| @wideo11/ui | Shadcn/UI component library |
| @wideo11/utils | Shared utilities |
| @wideo11/constants | SSOT constants |
| @wideo11/api-client | Typed API client with React Query |
| @wideo11/auth | Auth hooks, guards, provider |
| @wideo11/video-player | Custom HLS/DASH player |
| @wideo11/editor-core | Editor engines |
| @wideo11/charts | ECharts wrappers |
| @wideo11/dnd-dashboard | Drag-drop dashboard grid |
| @wideo11/forms | React Hook Form + Zod |
| @wideo11/i18n | Multi-language support |
| @wideo11/push-client | Web Push subscription UI |

## Services (Go)

| Service | Description |
|---------|-------------|
| config-service | SSOT configuration |
| auth-service | JWT, token rotation |
| pin-service | 6-digit PIN |
| session-service | Session management |
| device-service | Device fingerprinting |
| biometric-service | WebAuthn/FIDO2 |
| user-service | User CRUD |
| profile-service | Profile data |
| settings-service | User settings |
| notification-service | Notifications (email, push, in-app) |
| push-service | Native Web Push (RFC 8030) |
| upload-service | Chunked upload, virus scan |
| video-service | Video metadata |
| transcoding-service | FFmpeg workers |
| thumbnail-service | Thumbnails, sprites |
| streaming-service | HLS/DASH delivery |
| subtitle-service | Subtitles, auto-caption |
| wallet-service | Balance management |
| accounting-service | Double-entry ledger |
| ledger-service | Audit trail |
| withdrawal-service | KYC, withdrawals |
| royalty-service | SSOT-driven royalties |
| billing-service | Invoicing, subscriptions |
| ads-service | Ad inventory, delivery |
| campaign-service | Advertiser campaigns |
| targeting-service | Geo, language, category targeting |
| analytics-service | Ads analytics |
| help-service | Ticket system |
| faq-service | Dynamic FAQ |
| bot-service | AI chatbot |
| webhook-receiver | AlertManager webhooks |
| dashboard-service | Custom dashboard backend |
| nats-client | Shared NATS client |

## Infrastructure

- **Orchestration**: Kubernetes (GKE)
- **IaC**: Terraform + Helm + ArgoCD (GitOps)
- **Database**: PostgreSQL (partitioned) + Redis Cluster + MinIO
- **Event Backbone**: NATS JetStream (replaces Kafka)
- **Observability**: Prometheus + OpenTelemetry + Custom Dashboard (NO Grafana)
- **Security**: HashiCorp Vault + mTLS + WAF + Rate Limiting
- **CI/CD**: GitHub Actions + ArgoCD

## Key Principles

1. **No `any`** - Strict TypeScript everywhere
2. **No Hardcode** - All config from config-service
3. **No Duplicate Logic** - Shared packages for all common code
4. **SSOT Everywhere** - Single Source of Truth
5. **Cloud Agnostic** - Terraform + Helm + GitOps portable
6. **Zero Third-Party Cost** - Self-host everything (NATS, Push, Email, Search)
7. **Functional & Logically Working** - No stubs, no TODOs in code

## Deployment

```bash
# Build Docker images
pnpm docker:build

# Deploy to Kubernetes (via ArgoCD)
kubectl apply -f infrastructure/argocd/
```

## License

Proprietary - All rights reserved