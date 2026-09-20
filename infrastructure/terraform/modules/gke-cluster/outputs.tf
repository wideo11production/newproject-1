output "name" {
  value = google_container_cluster.primary.name
}

output "endpoint" {
  value = google_container_cluster.primary.endpoint
}

output "location" {
  value = google_container_cluster.primary.location
}

output "ca_certificate" {
  value     = google_container_cluster.primary.master_auth[0].cluster_ca_certificate
  sensitive = true
}

output "internal_ip" {
  value = google_container_cluster.primary.private_cluster_config[0].private_endpoint
}