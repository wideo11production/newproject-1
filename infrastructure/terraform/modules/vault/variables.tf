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

variable "gke_endpoint" {
  description = "GKE cluster endpoint"
  type        = string
}

variable "gke_ca_cert" {
  description = "GKE cluster CA certificate"
  type        = string
  sensitive   = true
}