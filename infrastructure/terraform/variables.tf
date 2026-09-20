variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "asia-south1"
}

variable "zone" {
  description = "GCP Zone"
  type        = string
  default     = "asia-south1-a"
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}

variable "subnets" {
  description = "Map of subnet names to CIDR ranges"
  type        = map(string)
  default = {
    "primary"   = "10.0.0.0/20"
    "secondary" = "10.0.16.0/20"
    "services"  = "10.0.32.0/20"
  }
}

variable "secondary_ranges" {
  description = "Secondary IP ranges for pods and services"
  type = map(map(string))
  default = {
    "primary" = {
      "pods"     = "10.10.0.0/14"
      "services" = "10.20.0.0/20"
    }
  }
}

variable "master_cidr" {
  description = "CIDR range for GKE master"
  type        = string
  default     = "172.16.0.0/28"
}

variable "enable_autopilot" {
  description = "Enable GKE Autopilot mode"
  type        = bool
  default     = false
}

variable "node_pools" {
  description = "GKE node pool configurations"
  type = list(object({
    name         = string
    machine_type = string
    disk_size_gb = number
    min_count    = number
    max_count    = number
    labels       = map(string)
    taints       = list(object({
      key    = string
      value  = string
      effect = string
    }))
  }))
  default = [
    {
      name         = "general"
      machine_type = "e2-standard-4"
      disk_size_gb = 100
      min_count    = 2
      max_count    = 10
      labels       = {}
      taints       = []
    },
    {
      name         = "video-processing"
      machine_type = "n2-standard-8"
      disk_size_gb = 500
      min_count    = 0
      max_count    = 20
      labels       = { workload = "video-processing" }
      taints       = [{ key = "workload", value = "video-processing", effect = "NO_SCHEDULE" }]
    },
    {
      name         = "ai-ml"
      machine_type = "g2-standard-24"
      disk_size_gb = 200
      min_count    = 0
      max_count    = 5
      labels       = { workload = "ai-ml" }
      taints       = [{ key = "workload", value = "ai-ml", effect = "NO_SCHEDULE" }]
    }
  ]
}

variable "cloudsql_tier" {
  description = "Cloud SQL instance tier"
  type        = string
  default     = "db-custom-4-16384"
}

variable "cloudsql_disk_size_gb" {
  description = "Cloud SQL disk size in GB"
  type        = number
  default     = 500
}

variable "cloudsql_backup_enabled" {
  description = "Enable automated backups for Cloud SQL"
  type        = bool
  default     = true
}

variable "cloudsql_maintenance_window" {
  description = "Cloud SQL maintenance window"
  type = object({
    day  = string
    hour = number
  })
  default = {
    day  = "SUN"
    hour = 3
  }
}

variable "redis_tier" {
  description = "Memorystore Redis tier"
  type        = string
  default     = "STANDARD_HA"
}

variable "redis_memory_size_gb" {
  description = "Memorystore Redis memory size in GB"
  type        = number
  default     = 13
}

variable "minio_buckets" {
  description = "MinIO bucket configurations"
  type = list(object({
    name          = string
    versioning    = bool
    lifecycle_rules = list(object({
      action = string
      age    = number
      prefix = optional(string)
    }))
  }))
  default = [
    {
      name       = "raw-uploads"
      versioning = true
      lifecycle_rules = [
        { action = "Delete", age = 7, prefix = "temp/" }
      ]
    },
    {
      name       = "processed-videos"
      versioning = true
      lifecycle_rules = []
    },
    {
      name       = "thumbnails"
      versioning = true
      lifecycle_rules = []
    },
    {
      name       = "subtitles"
      versioning = true
      lifecycle_rules = []
    },
    {
      name       = "editor-assets"
      versioning = true
      lifecycle_rules = []
    },
    {
      name       = "cdn-origin"
      versioning = true
      lifecycle_rules = []
    }
  ]
}

variable "minio_versioning" {
  description = "Enable versioning on MinIO buckets"
  type        = bool
  default     = true
}

variable "minio_lifecycle_rules" {
  description = "Default lifecycle rules for MinIO buckets"
  type = list(object({
    action = string
    age    = number
    prefix = optional(string)
  }))
  default = []
}

variable "nats_node_count" {
  description = "Number of NATS JetStream nodes"
  type        = number
  default     = 3
}

variable "nats_machine_type" {
  description = "Machine type for NATS nodes"
  type        = string
  default     = "n2-standard-4"
}

variable "nats_disk_size_gb" {
  description = "Disk size for NATS nodes in GB"
  type        = number
  default     = 200
}

variable "managed_certs" {
  description = "Managed SSL certificates for load balancer"
  type = list(object({
    name   = string
    domains = list(string)
  }))
  default = []
}

variable "cert_manager_email" {
  description = "Email for Let's Encrypt registration"
  type        = string
  default     = "admin@wideo11.com"
}