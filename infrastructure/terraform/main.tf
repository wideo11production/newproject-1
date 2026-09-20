terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.10"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }

  backend "gcs" {
    bucket = "wideo11-terraform-state"
    prefix = "infrastructure"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

provider "kubernetes" {
  host                   = module.gke_cluster.endpoint
  token                  = data.google_client_config.default.access_token
  cluster_ca_certificate = base64decode(module.gke_cluster.ca_certificate)
}

provider "helm" {
  kubernetes {
    host                   = module.gke_cluster.endpoint
    token                  = data.google_client_config.default.access_token
    cluster_ca_certificate = base64decode(module.gke_cluster.ca_certificate)
  }
}

data "google_client_config" "default" {}

module "vpc" {
  source = "./modules/vpc"

  project_id   = var.project_id
  region       = var.region
  network_name = "${var.environment}-vpc"
  subnets      = var.subnets
  secondary_ranges = var.secondary_ranges
}

module "gke_cluster" {
  source = "./modules/gke-cluster"

  project_id    = var.project_id
  region        = var.region
  zone          = var.zone
  environment   = var.environment
  cluster_name  = "${var.environment}-gke"
  network       = module.vpc.network_name
  subnetwork    = module.vpc.subnet_names[0]
  node_pools    = var.node_pools
  master_cidr   = var.master_cidr
  enable_autopilot = var.enable_autopilot
}

module "cloudsql" {
  source = "./modules/cloudsql"

  project_id    = var.project_id
  region        = var.region
  environment   = var.environment
  instance_name = "${var.environment}-postgres"
  network       = module.vpc.network_name
  database_version = "POSTGRES_15"
  tier          = var.cloudsql_tier
  disk_size_gb  = var.cloudsql_disk_size_gb
  backup_enabled = var.cloudsql_backup_enabled
  maintenance_window = var.cloudsql_maintenance_window
  deletion_protection = var.environment == "production"
}

module "memorystore" {
  source = "./modules/memorystore"

  project_id     = var.project_id
  region         = var.region
  environment    = var.environment
  instance_name  = "${var.environment}-redis"
  network        = module.vpc.network_name
  tier           = var.redis_tier
  memory_size_gb = var.redis_memory_size_gb
  redis_version  = "REDIS_7_2"
}

module "minio" {
  source = "./modules/minio"

  project_id    = var.project_id
  region        = var.region
  environment   = var.environment
  bucket_name   = "${var.environment}-wideo11"
  buckets       = var.minio_buckets
  versioning    = var.minio_versioning
  lifecycle_rules = var.minio_lifecycle_rules
}

module "nats_jetstream" {
  source = "./modules/nats-jetstream"

  project_id    = var.project_id
  region        = var.region
  environment   = var.environment
  cluster_name  = "${var.environment}-nats"
  network       = module.vpc.network_name
  subnetwork    = module.vpc.subnet_names[0]
  node_count    = var.nats_node_count
  machine_type  = var.nats_machine_type
  disk_size_gb  = var.nats_disk_size_gb
}

module "load_balancer" {
  source = "./modules/load-balancer"

  project_id    = var.project_id
  region        = var.region
  environment   = var.environment
  network       = module.vpc.network_name
  subnetwork    = module.vpc.subnet_names[0]
  managed_certs = var.managed_certs
}

module "cert_manager" {
  source = "./modules/cert-manager"

  project_id  = var.project_id
  region      = var.region
  environment = var.environment
  cluster_name = module.gke_cluster.name
  email       = var.cert_manager_email
}

module "vault" {
  source = "./modules/vault"

  project_id   = var.project_id
  region       = var.region
  environment  = var.environment
  cluster_name = module.gke_cluster.name
  gke_endpoint = module.gke_cluster.endpoint
  gke_ca_cert  = module.gke_cluster.ca_certificate
}