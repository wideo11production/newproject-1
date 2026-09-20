variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
}

variable "network_name" {
  description = "Name of the VPC network"
  type        = string
}

variable "subnets" {
  description = "Map of subnet names to CIDR ranges"
  type        = map(string)
}

variable "secondary_ranges" {
  description = "Secondary IP ranges for pods and services"
  type        = map(map(string))
  default     = {}
}

variable "master_cidr" {
  description = "CIDR range for GKE master"
  type        = string
  default     = "172.16.0.0/28"
}

variable "environment" {
  description = "Environment name"
  type        = string
}