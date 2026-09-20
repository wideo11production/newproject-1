# Wideo11 Infrastructure as Code (Terraform)

This Terraform configuration provisions the complete infrastructure for the Wideo11 platform on Google Cloud Platform (GCP).

## Infrastructure Components

The deployment includes:

1. **VPC Network** - Custom VPC with subnets for different workloads
2. **GKE Cluster** - Google Kubernetes Engine cluster with multiple node pools
3. **Cloud SQL** - PostgreSQL database instance
4. **Memorystore (Redis)** - Redis instance for caching and session storage
5. **MinIO** - Self-hosted S3-compatible object storage
6. **NATS JetStream** - Cloud-native messaging system (Kafka replacement)
7. **HTTP(S) Load Balancer** - Global external load balancer
8. **Cert-Manager** - Automatic SSL certificate management
9. **HashiCorp Vault** - Secrets management

## Prerequisites

- Terraform >= 1.6.0
- Google Cloud Platform account
- gcloud CLI authenticated
- kubectl configured for the GKE cluster (after creation)

## Usage

1. Copy `terraform.tfvars.example` to `terraform.tfvars`
2. Update the values in `terraform.tfvars` with your GCP project details
3. Initialize Terraform:
   ```bash
   terraform init
   ```
4. Review the planned changes:
   ```bash
   terraform plan
   ```
5. Apply the infrastructure:
   ```bash
   terraform apply
   ```

## Modules

Each component is implemented as a reusable Terraform module:

- `modules/vpc` - VPC network and subnets
- `modules/gke-cluster` - GKE cluster with node pools
- `modules/cloudsql` - PostgreSQL database instance
- `modules/memorystore` - Redis instance
- `modules/minio` - Self-hosted MinIO object storage
- `modules/nats-jetstream` - NATS JetStream messaging system
- `modules/load-balancer` - Global HTTP(S) load balancer
- `modules/cert-manager` - SSL certificate management
- `modules/vault` - HashiCorp Vault secrets management

## Outputs

After deployment, Terraform outputs connection details for all services:
- Database connection strings
- Redis endpoint
- MinIO access credentials
- NATS JetStream endpoints
- Load balancer IP addresses
- Vault server address
- Certificate issuer information

## Security Features

- Private GKE cluster endpoint
- Private IP for Cloud SQL and Redis
- Workload Identity enabled on GKE
- Binary Authorization enabled
- Shielded Nodes enabled
- Automated backups for databases
- Deletion protection on critical resources
- Private service access for managed services
- Vault for secrets management
- Cert-Manager for automated TLS certificates

## Cost Optimization

- Preemptible VMs can be enabled in node pools
- Autoscaling configured for all workloads
- Resource limits and requests set appropriately
- Storage lifecycle policies for MinIO buckets
- Regional services where appropriate

## Next Steps

After infrastructure deployment:
1. Deploy applications using Helm charts (see `infrastructure/helm/`)
2. Configure ArgoCD for GitOps
3. Set up monitoring and alerting
4. Configure DNS records pointing to the load balancer