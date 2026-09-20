resource "google_sql_database_instance" "primary" "postgres" {
  name             = "${var.environment}-postgres"
  project          = var.project_id
  region           = var.region

  database_version = var.database_version

  settings {
    tier                 = var.tier
    availability_type    = var.availability_type
    disk_type            = var.disk_type
    disk_size_gb         = var.disk_size_gb
    maintenance_window {
      day   = var.maintenance_window.day
      hour  = var.maintenance_window.hour
      update_track = "stable"
    }

    backup_configuration {
      enabled           = var.backup_enabled
      start_time        = "03:00"
      location          = var.region
      point_in_time_recovery_enabled = true
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.network
      require_ssl     = var.require_ssl
    }

    deletion_protection = var.deletion_protection
  }

  lifecycle {
    delete_before_destroy = true
  }
}

resource "google_sql_database" "wideo11" {
  name     = "wideo11"
  instance = google_sql_databaseprimary.postgres.name
  project  = var.project_id
}

resource "google_sql_user" "admin" {
  name     = "admin"
  instance = google_sql_databaseprimary.postgres.name
  project  = var.project_id
  password = random_password.admin.result
}

resource "random_password" "admin" {
  length  = 32
  special = true
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = var.network
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_service_networking_connection.private_vpc_range.name]
}

resource "google_service_networking_connection" "private_vpc_range" {
  network                 = var.network
  service                 = "servicenetworking.googleapis.com"
  address_prefix          = var.private_network_cidr
}

output "instance_name" {
  value = google_sql_databaseprimary.postgres.name
}

output "connection_name" {
  value = google_sql_databaseprimary.postgres.connection_name
}

output "private_ip" {
  value = google_sql_databaseprimary.postgres.private_ip_address
}

output "public_ip" {
  value = google_sql_databaseprimary.postgres.public_ip_address
}