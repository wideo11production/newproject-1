# Wideo11 Project Documentation

# Overview

Wideo11 is a complete video editing and streaming platform with:
- Video editing capabilities (Movavi-style NLE)
- Video transcoding pipeline (FFmpeg-based)
- Authentication and authorization system
- Billing and subscription management
- Advertising platform
- Push notification system
- Analytics and monitoring
- Multi-tenant support

# Architecture

## Architecture Overview

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Web App   │──────┤ Auth Service│──────┤   Postgres  │
│   (3000)    │      │   (8085)    │      │   (5432)    │
└─────────────┘      └─────────────┘      └─────────────┘
         │                  │                  │
         │                  │                  │
         ▼                  ▼                  ▼
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │ Video Editor│  │   Redis     │  │   NATS      │
    │   (3002)    │  │   (6379)    │  │   (4222)    │
    └─────────────┘  └─────────────┘  └─────────────┘
         │
         │
         ▼
    ┌─────────────┐
    │  MinIO      │
    │   (9000)    │
    └─────────────┘
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Web App | 3000 | Main frontend application |
| Video Editor | 3002 | Video editing interface |
| Superadmin | 3008 | Superadmin dashboard |
| Monitor | 3001 | Monitoring dashboard |
| Analytics | 3005 | Analytics dashboard |
| Currency | 3007 | Currency converter |
| Admin | 3006 | Admin dashboard |
| Auth Service | 8085 | Authentication service |
| Billing Service | 8082 | Billing and payments |
| Transcoding Service | 8086 | Video transcoding |
| Push Service | 8084 | Push notifications |
| Ads Service | 8083 | Advertising platform |

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
   - Admin: http://3006

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

### Video Editor
- GET /api/video-editor/channels - List channels
- POST /api/video-editor/upload - Upload video

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