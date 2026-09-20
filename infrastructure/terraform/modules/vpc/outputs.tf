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