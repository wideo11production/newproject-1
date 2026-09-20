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

variable "network" {
  description = "VPC network name for Redis instance"
  type        = string
}

variable "instance_name" {
  description = "Redis instance name"
  type        = string
}

variable "tier" {
  description = "Redis tier (STANDARD_HA or BASIC)"
  type        = string
  default     = "STANDARD_HA"
}

variable "memory_size_gb" {
  description = "Redis memory size in GB"
  type        = number
  default     = 13
}

variable "redis_version" {
  description = "Redis version (REDIS_7_0, REDIS_7_2, etc.)"
  type        = string
  default     = "REDIS_7_2"
}