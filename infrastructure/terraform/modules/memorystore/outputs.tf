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