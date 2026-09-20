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

variable "instance_name" {
  description = "Cloud SQL instance name"
  type        = string
}

variable "database_version" {
  description = "Database version (POSTGRES_15, MYSQL_8_0, etc.)"
  type        = string
  default     = "POSTGRES_15"
}

variable "tier" {
  description = "Machine type for Cloud SQL instance"
  type        = string
  default     = "db-custom-4-16384"
}

variable "availability_type" {
  description = "Availability type (REGIONAL or ZONAL)"
  type        = string
  default     = "REGIONAL"
}

variable "disk_type" {
  description = "Disk type (PD_SSD or PD_HDD)"
  type        = string
  default     = "PD_SSD"
}

variable "disk_size_gb" {
  description = "Disk size in GB"
  type        = number
  default     = 500
}

variable "backup_enabled" {
  description = "Enable automated backups"
  type        = bool
  default     = true
}

variable "maintenance_window" {
  description = "Maintenance window settings"
  type = object({
    day  = string
    hour = number
  })
  default = {
    day  = "SUN"
    hour = 3
  }
}

variable "require_ssl" {
  description = "Require SSL for connections"
  type        = bool
  default     = true
}

variable "deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = true
}

variable "network" {
  description = "VPC network name for private IP"
  type        = string
}

variable "private_network_cidr" {
  description = "Private network CIDR for service networking"
  type        = string
  default     = "10.20.0.0/20"
}