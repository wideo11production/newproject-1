# Wideo11 - Complete Video Editing & Streaming Platform

![Wideo11 Logo](https://wideo11.com/logo.png)

[![CI/CD Pipeline](https://github.com/advchashampalup/newproject/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/advchashampalup/newproject/actions/workflows/ci-cd.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Go](https://img.shields.io/badge/Go-1.21-blue.svg)](https://golang.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-blue.svg)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

Wideo11 is a complete video editing and streaming platform that combines the power of a professional video editor (like Movavi) with a complete streaming platform.

## Features

### Video Editing
- **Movavi-style NLE** with dual ruler timeline
- **AI Features**: Chroma key, stabilization, motion tracking, slow motion, auto-subtitles
- **Frame-by-frame editing** with keyframe support
- **Multiple tracks** for video, audio, and effects
- **Real-time preview** with hover preview on timeline clips

### Authentication & Security
- **JWT-based authentication** with 7-day refresh tokens
- **Superadmin account** for system administration
- **Security setup** with PIN, security questions, and biometric options
- **Rate limiting** on authentication endpoints
- **Email verification** for new accounts

### Billing & Subscriptions
- **Multiple subscription plans** (free, monthly, yearly, lifetime)
- **Creator earnings** with 5% sister share
- **GST calculations** (CGST, SGST, IGST)
- **Invoice management** and payment processing
- **Payout system** with ₹2000 minimum buffer

### Advertising Platform
- **Campaign management** with budget and targeting
- **Ad placements** (pre-roll, mid-roll, post-roll)
- **AI-powered ad matching** based on content and user preferences
- **Real-time analytics** and revenue tracking

### Push Notifications
- **Web Push API** with VAPID keys
- **Subscription management** (subscribe/unsubscribe)
- **Encrypted payload delivery**
- **Retry logic** for failed deliveries

## Quick Start

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/advchashampalup/newproject.git
   cd newproject
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. Start all services:
   ```bash
   docker compose up -d
   ```

5. Access the applications:
   - Web App: http://localhost:3000
   - Video Editor: http://localhost:3002
   - Superadmin: http://localhost:3008
   - Monitor: http://localhost:3001
   - Analytics: http://localhost:3005
   - Currency: http://localhost:3007
   - Admin: http://localhost:3006

## Authentication

### Superadmin Login
- Email: advchashampalup@gmail.com
- Password: Rajaghenna123*#

### Regular User Login
- Register at: http://localhost:3000/auth/register
- Verify email
- Login at: http://localhost:3000/auth/login

## API Endpoints

### Authentication
- POST /api/auth/login - User login
- POST /api/auth/register - User registration
- GET /api/auth/me - Get current user
- POST /api/auth/security/pin/verify - Verify PIN

### Billing
- GET /api/auth/me/plan - Get user plan
- POST /api/auth/security/pin/verify - Verify PIN
- GET /api/billing/subscription - Get user subscription
- POST /api/billing/wallet - Get wallet info

### Video Editor
- GET /api/video-editor/channels - List channels
- POST /api/video-editor/upload - Upload video

### Ads
- POST /api/ads/campaigns - Create ad campaign
- GET /api/ads/campaigns - List campaigns
- GET /api/ads/active - Get active ads

### Analytics
- GET /api/analytics/stats - Get analytics statistics

## Development

### Running Tests
```bash
pnpm test
```

### Building for Production
```bash
pnpm run build
```

### Linting
```bash
pnpm run lint
```

## Deployment

### Docker Compose (Local)
```bash
docker compose up -d
```

### Kubernetes (GKE)
```bash
# Apply Kubernetes manifests
kubectl apply -f infrastructure/kubernetes/

# Check deployment status
kubectl get pods
kubectl get services
kubectl get ingress
```

### Docker Images
All services are built as Docker images and can be deployed anywhere Docker is supported.

## Security

- All secrets are stored in environment variables
- JWT tokens are used for authentication
- Passwords are hashed with bcrypt
- Rate limiting is applied to authentication endpoints
- CORS is configured for allowed origins

## Monitoring

- Prometheus metrics available at /metrics
- Health checks at /api/health
- Structured logging with structured logs

## Support

For issues and feature requests, please open an issue on GitHub.