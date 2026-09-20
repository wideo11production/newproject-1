resource "google_compute_global_address" "static_ip" {
  name   = "${var.environment}-lb-ip"
  purpose = "GCE_ENDPOINT"
  address_type = "EXTERNAL"
  ip_version = "IPV4"
}

resource "google_compute_ssl_certificate" "certs" {
  for_each = toset([for cert in var.managed_certs : cert.name])
  name     = each.key
  managed {
    domains = each.value.domains
  }
}

resource "google_compute_backend_service" "backend" {
  name           = "${var.environment}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol       = "HTTP"
  health_checks  = [google_compute_health_check.hc.self_link]
  timeout_sec    = 30
  port_name      = "http"

  backend {
    group     = var.instance_group
    balancing_mode = "UTILIZATION"
    max_utilization = 0.8
  }
}

resource "google_compute_health_check" "hc" {
  name               = "${var.environment}-hc"
  check_interval_sec = 10
  timeout_sec        = 5
  healthy_threshold  = 2
  unhealthy_threshold = 2

  http_health_check {
    port        = var.health_check_port
    request_path = var.health_check_path
    request_method = "GET"
  }
}

resource "google_compute_url_map" "map" {
  name            = "${var.environment}-url-map"
  default_service = google_compute_backend_service.backend.self_link
}

resource "google_compute_target_http_proxy" "proxy" {
  name    = "${var.environment}-http-proxy"
  url_map = google_compute_url_map.map.self_link
}

resource "google_compute_global_forwarding_rule" "http_rule" {
  name       = "${var.environment}-http-forwarding-rule"
  target     = google_compute_target_http_proxy.proxy.self_link
  port_range = "80"
  ip_address = google_compute_global_address.static_ip.address
}

resource "google_compute_global_forwarding_rule" "https_rule" {
  name       = "${var.environment}-https-forwarding-rule"
  target     = google_compute_target_https_proxy.proxy.self_link
  port_range = "443"
  ip_address = google_compute_global_address.static_ip.address
}

resource "google_compute_target_https_proxy" "proxy" {
  name = "${var.environment}-https-proxy"
  ssl_certificates = [for cert in google_compute_ssl_certificate.certs : cert.self_link]
  url_map          = google_compute_url_map.map.self_link
}

output "static_ip" {
  value = google_compute_global_address.static_ip.address
}

output "http_endpoint" {
  value = "http://${google_compute_global_address.static_ip.address}"
}

output "https_endpoint" {
  value = "https://${google_compute_global_address.static_ip.address}"
}