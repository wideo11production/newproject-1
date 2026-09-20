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
  description = "VPC network name"
  type        = string
}

variable "subnetwork" {
  description = "VPC subnetwork name"
  type        = string
}

variable "instance_group" {
  description = "Instance group for backend (from GKE node pools)"
  type        = string
}

variable "managed_certs" {
  description = "Managed SSL certificates"
  type = list(object({
    name   = string
    domains = list(string)
  }))
  default = []
}

variable "health_check_port" {
  description = "Port for health check"
  type        = number
  default     = 80
}

variable "health_check_path" {
  description = "Path for health check"
  type        = string
  default     = "/health"
}