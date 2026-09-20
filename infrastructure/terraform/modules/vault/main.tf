resource "helm_release" "vault" {
  name       = "${var.environment}-vault"
  repository = "https://helm.releases.hashicore.com"
  chart      = "hashicorp/vault"
  version    = "0.23.0"
  namespace  = "vault"
  create_namespace = true

  set {
    name  = "server.replicas"
    value = "3"
  }

  set {
    name  = "server.ha.enabled"
    value = "true"
  }

  set {
    name  = "server.ha.raft.enabled"
    value = "true"
  }

  set {
    name  = "server.extraEnvironmentVars"
    value = <<EOF
VAULT_LOCAL_CONFIG={
  "listener": [
    {
      "tcp": {
        "address": "0.0.0.0:8200",
        "tls_disable": 1
      }
    }
  ],
  "storage": {
    "raft": {
      "path": "/vault/data"
    }
  },
  "ui": true
}
EOF
  }

  set {
    name  = "server.extraVolumes"
    value = <<EOF
[
  {
    name: "storage"
    emptyDir: {}
  }
]
EOF
  }

  set {
    name  = "server.extraVolumeMounts"
    value = <<EOF
[
  {
    name: "storage"
    mountPath: "/vault/data"
  }
]
EOF
  }

  set {
    name  = "server.service.type"
    value = "LoadBalancer"
  }

  set {
    name  = "server.service.port"
    value = "8200"
  }

  depends_on = [
    google_container_cluster.primary
  ]
}

resource "kubernetes_service" "vault_internal" {
  metadata {
    name      = "${var.environment}-vault-internal"
    namespace = helm_release.vault.namespace
    labels = {
      app = "vault"
    }
  }

  spec {
    selector = {
      app = "vault"
    }
    port {
      port        = 8200
      target_port = 8200
    }
    type = "ClusterIP"
  }
}

resource "kubernetes_service" "vault_external" {
  metadata {
    name      = "${var.environment}-vault-external"
    namespace = helm_release.vault.namespace
    labels = {
      app = "vault"
    }
  }

  spec {
    selector = {
      app = "vault"
    }
    port {
      port        = 8200
      target_port = 8200
    }
    type = "LoadBalancer"
  }
}

output "address" {
  value = "http://${kubernetes_service.vault_external.spec[0].load_balancer_ingress[0].ip}:8200"
}

output "internal_address" {
  value = "http://${kubernetes_service.vault_internal.spec[0].cluster_ip}:8200"
}

output "ui_endpoint" {
  value = "http://${kubernetes_service.vault_external.spec[0].load_balancer_ingress[0].ip}:8200/ui"
}