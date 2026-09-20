variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
}

variable "zone" {
  description = "GCP Zone for cluster"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "cluster_name" {
  description = "Name of the GKE cluster"
  type        = string
}

variable "network" {
  description = "VPC network name"
  type        = string
}

variable "subnetwork" {
  description = "VPC subnetwork name"
  type        = string
}

variable "master_cidr" {
  description = "CIDR range for GKE master"
  type        = string
  default     = "172.16.0.0/28"
}

variable "pod_ipv4_cidr_size" {
  description = "Size of pod IP CIDR range"
  type        = number
  default     = 14
}

variable "enable_private_endpoint" {
  description = "Enable private endpoint for GKE cluster"
  type        = bool
  default     = true
}

variable "node_machine_type" {
  description = "Machine type for primary node pool"
  type        = string
  default     = "e2-standard-4"
}

variable "node_disk_size_gb" {
  description = "Disk size for primary node pool in GB"
  type        = number
  default     = 100
}

variable "node_labels" {
  description = "Labels for primary node pool"
  type        = map(string)
  default     = {}
}

variable "node_tags" {
  description = "Tags for primary node pool"
  type        = list(string)
  default     = []
}

variable "initial_node_count" {
  description = "Initial number of nodes in primary node pool"
  type        = number
  default     = 1
}

variable "enable_autopilot" {
  description = "Enable GKE Autopilot mode"
  type        = bool
  default     = false
}

variable "autopilot_min_nodes" {
  description = "Minimum nodes for autopilot pool"
  type        = number
  default     = 0
}

variable "autopilot_max_nodes" {
  description = "Maximum nodes for autopilot pool"
  type        = number
  default     = 5
}

variable "node_pools" {
  description = "Additional node pool configurations"
  type = list(object({
    name         = string
    machine_type = string
    disk_size_gb = number
    min_count    = number
    max_count    = number
    labels       = map(string)
    tags         = list(string)
    taints = list(object({
      key    = string
      value  = string
      effect = string
    }))
  }))
  default = []
}