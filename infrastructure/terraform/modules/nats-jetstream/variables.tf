variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "cluster_name" {
  description = "GKE cluster name"
  type        = string
}

variable "cluster_domain" {
  description = "Cluster domain for NATS advertisement"
  type        = string
  default     = "cluster.local"
}

variable "replica_count" {
  description = "Number of NATS server replicas"
  type        = number
  default     = 3
}

variable "machine_type" {
  description = "Machine type for NATS nodes"
  type        = string
  default     = "n2-standard-4"
}

variable "disk_size_gb" {
  description = "Disk size for NATS persistence in GB"
  type        = number
  default     = 200
}