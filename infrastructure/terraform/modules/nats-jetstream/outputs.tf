output "cluster_name" {
  value = "${var.environment}-nats"
}

output "endpoints" {
  value = [
    "${kubernetes_service.nats_client.spec[0].load_balancer_ingress[0].ip}:4222",
    "${kubernetes_service.nats_monitor.spec[0].load_balancer_ingress[0].ip}:8222"
  ]
}

output "client_port" {
  value = 4222
}

output "monitor_port" {
  value = 8222
}