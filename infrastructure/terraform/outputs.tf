output "project_id" {
  value = var.project_id
}

output "region" {
  value = var.region
}

output "environment" {
  value = var.environment
}

output "vpc_id" {
  value = module.vpc.network_id
}

output "vpc_name" {
  value = module.vpc.network_name
}

output "subnet_ids" {
  value = module.vpc.subnet_ids
}

output "subnet_names" {
  value = module.vpc.subnet_names
}

output "gke_cluster_name" {
  value = module.gke_cluster.name
}

output "gke_cluster_endpoint" {
  value = module.gke_cluster.endpoint
}

output "gke_cluster_ca_certificate" {
  value     = module.gke_cluster.ca_certificate
  sensitive = true
}

output "gke_cluster_location" {
  value = module.gke_cluster.location
}

output "cloudsql_instance_name" {
  value = module.cloudsql.instance_name
}

output "cloudsql_connection_name" {
  value = module.cloudsql.connection_name
}

output "cloudsql_private_ip" {
  value = module.cloudsql.private_ip
}

output "cloudsql_public_ip" {
  value = module.cloudsql.public_ip
}

output "memorystore_instance_name" {
  value = module.memorystore.instance_name
}

output "memorystore_host" {
  value = module.memorystore.host
}

output "memorystore_port" {
  value = module.memorystore.port
}

output "minio_buckets" {
  value = module.minio.bucket_names
}

output "nats_cluster_name" {
  value = module.nats_jetstream.cluster_name
}

output "nats_endpoints" {
  value = module.nats_jetstream.endpoints
}

output "load_balancer_ip" {
  value = module.load_balancer.static_ip
}

output "cert_manager_issuers" {
  value = module.cert_manager.issuer_names
}

output "vault_address" {
  value = module.vault.address
}