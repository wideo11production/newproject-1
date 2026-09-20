resource "google_redis_instance" "primary" {
  provider         = google-beta
  name             = "${var.environment}-redis"
  project          = var.project_id
  region           = var.region
  authorized_network = var.network
  tier             = var.tier
  memory_size_gb   = var.memory_size_gb
  redis_version    = var.redis_version
  display_name     = "${var.environment} Redis Instance"
  labels = {
    environment = var.environment
  }
}

output "instance_name" {
  value = google_redis_instance.primary.name
}

output "host" {
  value = google_redis_instance.primary.host
}

output "port" {
  value = google_redis_instance.primary.port
}

output "connection_name" {
  value = google_redis_instance.primary.connection_name
}