output "issuer_names" {
  value = [
    "letsencrypt-prod",
    "letsencrypt-staging"
  ]
}

output "issuer_resources" {
  value = {
    prod   = kubernetes_manifest.letsencrypt_prod
    staging = kubernetes_manifest.letsencrypt_staging
  }
}