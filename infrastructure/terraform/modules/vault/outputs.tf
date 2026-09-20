output "address" {
  value = "http://${kubernetes_service.vault_external.spec[0].load_balancer_ingress[0].ip}:8200"
}

output "internal_address" {
  value = "http://${kubernetes_service.vault_internal.spec[0].cluster_ip}:8200"
}

output "ui_endpoint" {
  value = "http://${kubernetes_service.vault_external.spec[0].load_balancer_ingress[0].ip}:8200/ui"
}