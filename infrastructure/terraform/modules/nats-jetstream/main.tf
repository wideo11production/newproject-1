resource "helm_release" "nats" {
  name       = "${var.environment}-nats"
  repository = "https://nats-io.github.io/k8s/helm/charts/"
  chart      = "nats"
  version    = "0.12.0"
  namespace  = "nats"
  create_namespace = true

  set {
    name  = "jetstream.enabled"
    value = "true"
  }

  set {
    name  = "replicas"
    value = var.replica_count
  }

  set {
    name  = "config"
    value = <<EOF
listen: 0.0.0.0:4222
http: 0.0.0.0:8222
leafnodes {
  listen: 0.0.0.0:7422
  advertise: ${var.cluster_domain}:7422
}
jetstream {
  store_dir: /data/js
  max_mem_store: 4GiB
  max_file_store: 8GiB
  store_dir: /data/js
}
EOF
  }

  set {
    name  = "persistence.enabled"
    value = "true"
  }

  set {
    name  = "persistence.size"
    value = "${var.disk_size_gb}Gi"
  }

  set {
    name  = "resources.requests.memory"
    value = "512Mi"
  }

  set {
    name  = "resources.requests.cpu"
    value = "250m"
  }

  set {
    name  = "resources.limits.memory"
    value = "1Gi"
  }

  set {
    name  = "resources.limits.cpu"
    value = "500m"
  }

  depends_on = [
    google_container_cluster.primary
  ]
}

resource "kubernetes_service" "nats_client" {
  metadata {
    name      = "${var.environment}-nats-client"
    namespace = helm_release.nats.namespace
    labels = {
      app = "nats"
    }
  }

  spec {
    selector = {
      app = "nats"
    }
    port {
      port        = 4222
      target_port = 4222
    }
    type = "LoadBalancer"
  }
}

resource "kubernetes_service" "nats_monitor" {
  metadata {
    name      = "${var.environment}-nats-monitor"
    namespace = helm_release.nats.namespace
    labels = {
      app = "nats"
    }
  }

  spec {
    selector = {
      app = "nats"
    }
    port {
      port        = 8222
      target_port = 8222
    }
    type = "LoadBalancer"
  }
}

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