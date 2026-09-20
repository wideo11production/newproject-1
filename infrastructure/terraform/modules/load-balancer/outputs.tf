output "static_ip" {
  value = google_compute_global_address.static_ip.address
}

output "http_endpoint" {
  value = "http://${google_compute_global_address.static_ip.address}"
}

output "https_endpoint" {
  value = "https://${google_compute_global_address.static_ip.address}"
}