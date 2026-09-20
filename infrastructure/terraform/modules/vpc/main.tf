resource "google_compute_network" "vpc" {
  name                    = var.network_name
  auto_create_subnetworks = false
  routing_mode            = "GLOBAL"
  description             = "VPC network for ${var.environment} environment"

  delete_default_routes_on_creation = true
}

resource "google_compute_subnetwork" "subnets" {
  for_each = var.subnets

  name          = each.key
  ip_cidr_range = each.value
  region        = var.region
  network       = google_compute_network.vpc.id
  private_ip_google_access = true

  secondary_ip_range = var.secondary_ranges[each.key] != null ? [
    for range_name, range_cidr in var.secondary_ranges[each.key] : {
      range_name    = range_name
      ip_cidr_range = range_cidr
    }
  ] : []

  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_firewall" "allow_internal" {
  name    = "${var.network_name}-allow-internal"
  network = google_compute_network.vpc.name
  direction = "INGRESS"
  priority  = 1000

  allow {
    protocol = "tcp"
    ports    = ["0-65535"]
  }
  allow {
    protocol = "udp"
    ports    = ["0-65535"]
  }
  allow {
    protocol = "icmp"
  }

  source_ranges = [var.subnets["primary"]]
  target_tags   = ["internal"]
}

resource "google_compute_firewall" "allow_health_checks" {
  name    = "${var.network_name}-allow-health-checks"
  network = google_compute_network.vpc.name
  direction = "INGRESS"
  priority  = 1000

  allow {
    protocol = "tcp"
    ports    = ["80", "443", "8080", "8443"]
  }

  source_ranges = ["130.211.0.0/22", "35.191.0.0/16"]
  target_tags   = ["health-check"]
}

resource "google_compute_firewall" "allow_gke_master" {
  name    = "${var.network_name}-allow-gke-master"
  network = google_compute_network.vpc.name
  direction = "INGRESS"
  priority  = 1000

  allow {
    protocol = "tcp"
    ports    = ["443", "10250"]
  }

  source_ranges = [var.master_cidr]
  target_tags   = ["gke-node"]
}

resource "google_compute_router" "nat_router" {
  name    = "${var.network_name}-nat-router"
  network = google_compute_network.vpc.name
  region  = var.region
  bgp {
    asn = 64514
  }
}

resource "google_compute_router_nat" "nat" {
  name                               = "${var.network_name}-nat"
  router                             = google_compute_router.nat_router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

resource "google_compute_global_address" "private_services_access" {
  name          = "${var.network_name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services_access.name]
}

output "network_id" {
  value = google_compute_network.vpc.id
}

output "network_name" {
  value = google_compute_network.vpc.name
}

output "subnet_ids" {
  value = { for k, v in google_compute_subnetwork.subnets : k => v.id }
}

output "subnet_names" {
  value = { for k, v in google_compute_subnetwork.subnets : k => v.name }
}

output "nat_router_name" {
  value = google_compute_router.nat_router.name
}