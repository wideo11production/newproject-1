# Wideo11 Deployment Guide

## Overview

Wideo11 can be deployed in multiple environments:

1. **Local Development** - Docker Compose
2. **Production (GKE)** - Google Kubernetes Engine
3. **Hostinger** - Shared hosting/VPS

---

## 1. Local Development (Docker Compose)

### Prerequisites
- Docker Desktop or Docker Engine
- Docker Compose

### Start All Services

```bash
cd /path/to/newproject
docker compose up -d
```

### Access Applications

| Service | URL |
|---------|-----|
| Web App | http://localhost:3000 |
| Video Editor | http://localhost:3002 |
| Superadmin | http://localhost:3008 |
| Monitor | http://localhost:3001 |
| Analytics | http://localhost:3005 |
| Currency | http://localhost:3007 |
| Admin | http://localhost:3006 |
| Billing | http://localhost:3003 |

### Superadmin Login
- Email: advchashampalup@gmail.com
- Password: Rajaghenna123*#

### Stop All Services
```bash
docker compose down
```

---

## 2. GKE Deployment (Google Kubernetes Engine)

### Prerequisites
- Google Cloud account with billing enabled
- gcloud CLI installed
- kubectl installed
- Helm installed
- Terraform installed

### Step 1: Provision GKE Cluster

```bash
cd infrastructure/terraform
terraform init
terraform plan -var project_id="YOUR_PROJECT_ID" -var region="us-central1"
terraform apply -auto-approve
```

### Step 2: Get Cluster Credentials

```bash
gcloud container clusters get-credentials wideo11-cluster --region us-central1 --project YOUR_PROJECT_ID
```

### Step 3: Install Dependencies

```bash
# Install NGINX Ingress Controller
helm install ingress-nginx ingress-nginx/ingress-nginx --namespace ingress-nginx --create-namespace

# Install Cert-Manager for SSL
helm install cert-manager jetstack/cert-manager --namespace cert-manager --create-namespace --set installCRDs=true
```

### Step 4: Deploy All Services

```bash
# Deploy all Helm charts
helm install auth-service infrastructure/helm/auth-service --namespace wideo11 --create-namespace
helm install video-editor infrastructure/helm/video-editor --namespace wideo11
helm install web infrastructure/helm/web --namespace wideo11
helm install superadmin infrastructure/helm/superadmin --namespace wideo11
helm install billing-service infrastructure/helm/billing-service --namespace wideo11
helm install push-service infrastructure/helm/push-service --namespace wideo11
helm install ads-service infrastructure/helm/ads-service --namespace wideo11
helm install analytics-service infrastructure/helm/analytics-service --namespace wideo11
helm install monitor infrastructure/helm/monitor --namespace wideo11
helm install currency infrastructure/helm/currency --namespace wideo11
helm install admin infrastructure/helm/admin --namespace wideo11
helm install postgres infrastructure/helm/postgres --namespace wideo11
helm install redis infrastructure/helm/redis --namespace wideo11
helm install minio infrastructure/helm/minio --namespace wideo11
helm install nats infrastructure/helm/nats --namespace wideo11
```

### Step 3: Verify Deployment

```bash
kubectl get pods -n wideo11
kubectl get services -n wideo11
kubectl get ingress -n wideo11
```

---

## 3. Hostinger Deployment

### Option A: Hostinger VPS

1. Create a VPS on Hostinger (recommend 4GB RAM, 2 CPU, 50GB SSD)
2. Connect via SSH
3. Install Docker and Docker Compose
4. Clone the repository
5. Configure environment variables
6. Run `docker compose up -d`

### Option B: Hostinger Shared Hosting

Not recommended for this application as it requires Docker and multiple services.

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Application
NODE_ENV=production
PORT=3000

# Auth Service
AUTH_SERVICE_URL=http://auth-service:8085
JWT_SECRET_KEY=your-super-secret-jwt-key-change-in-production
SUPERADMIN_EMAIL=advchashampalup@gmail.com
SUPERADMIN_PASSWORD=Rajaghenna123*#

# Database
DATABASE_URL=postgresql://wideo11:wideo11_password@postgres:5432/wideo11

# Redis
REDIS_URL=redis://redis:6379

# NATS
NATS_URL=nats://nats:4222

# MinIO
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=video

# VAPID Keys (for push notifications)
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUBJECT=mailto:admin@wideo11.com
```

---

## Monitoring

All services expose `/metrics` endpoints for Prometheus metrics and `/health` for health checks.

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001
- Alertmanager: http://localhost:9093

## Backup & Recovery

### Database Backup
```bash
docker exec wideo11-postgres pg_dump -U wideo11 wideo11 > backup_$(date +%Y%m%d).sql
```

### Database Restore
```bash
docker exec -i wideo11-postgres psql -U wideo11 -d wideo11 < backup_20240101.sql
```

## Support

For issues and feature requests, please open an issue on GitHub.