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