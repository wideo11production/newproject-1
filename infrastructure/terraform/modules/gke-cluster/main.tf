resource "google_container_cluster" "primary" {
  name     = var.cluster_name
  location = var.zone
  project  = var.project_id

  network     = var.network
  subnetwork  = var.subnetwork

  remove_default_node_pool = true
  initial_node_count       = 1

  workload_identity_config {
    identity_namespace = var.project_id
  }

  networking_config {
    service_ipv4_cidr  = "/20"
    pod_ipv4_cidr_size = var.pod_ipv4_cidr_size
  }

  maintenance_policy {
    daily_maintenance_window {
      start_time = "03:00"
    }
  }

  release_channel {
    channel = "REGULAR"
  }

  enable_shielded_nodes = true
  enable_binary_authorization = true

  private_cluster_config {
    enable_private_nodes   = true
    enable_private_endpoint = var.enable_private_endpoint
    master_ipv4_cidr_block = var.master_cidr
  }

  lifecycle {
    ignore_changes = [
      release_channel
    ]
  }
}

resource "google_container_node_pool" "primary_nodes" {
  name       = "${var.cluster_name}-primary"
  location   = var.zone
  cluster    = google_container_cluster.primary.name
  node_count = var.initial_node_count

  node_config {
    machine_type = var.node_machine_type
    disk_size_gb = var.node_disk_size_gb
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]

    labels = var.node_labels
    tags   = var.node_tags

    shielded_instance_config {
      enable_secure_boot = true
    }

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  lifecycle {
    ignore_changes = [
      node_count
    ]
  }
}

resource "google_container_node_pool" "autopilot" {
  count        = var.enable_autopilot ? 1 : 0
  name         = "${var.cluster_name}-autopilot"
  location     = var.zone
  cluster      = google_container_cluster.primary.name
  node_count   = 0

  autoscaling {
    location_policy = "BALANCED"
    min_node_count  = var.autopilot_min_nodes
    max_node_count  = var.autopilot_max_nodes
  }

  management {
    auto_repair  = false
    auto_upgrade = false
  }

  node_config {
    machine_type = "e2-medium"
    disk_size_gb = 32
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]

    labels = {
      purpose   = "autopilot"
      workload  = "general"
    }

    shielded_instance_config {
      enable_secure_boot = true
    }

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}

# Node pool for general purpose workloads
resource "google_container_node_pool" "general" {
  for_each = { for i, np in var.node_pools : np.name => np if np.name != "" }

  name       = "${var.cluster_name}-${each.key}"
  location   = var.zone
  cluster    = google_container_cluster.primary.name
  initial_node_count = each.value.min_count

  node_config {
    machine_type = each.value.machine_type
    disk_size_gb = each.value.disk_size_gb
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]

    labels = merge(each.value.labels, {
      workload = each.key
    })
    tags   = each.value.tags

    shielding_instance_config {
      enable_secure_boot = true
    }

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }

  autoscaling {
    min_node_count = each.value.min_count
    max_node_count = each.value.max_count
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  lifecycle {
    ignore_changes = [
      initial_node_count
    ]
  }

  depends_on = [
    google_container_cluster.primary
  ]
}

# Taints for specialized node pools
resource "google_container_node_pool" "tainted" {
  for_each = { for i, np in var.node_pools : np.name => np if length(np.taints) > 0 }

  name       = "${var.cluster_name}-${each.key}-tainted"
  location   = var.zone
  cluster    = google_container_cluster.primary.name
  initial_node_count = 0

  node_config {
    machine_type = each.value.machine_type
    disk_size_gb = each.value.disk_size_gb
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]

    labels = merge(each.value.labels, {
      workload = each.key
    })
    tags   = each.value.tags

    shielding_instance_config {
      enable_secure_boot = true
    }

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }

  node_taints {
    for_each = {
      for taint in each.value.taints :
      taint.key => {
        key   = taint.key
        value = taint.value
        effect = taint.effect
      }
    }
    value = each.value.value
    effect = each.value.effect
  }

  autoscaling {
    min_node_count = 0
    max_node_count = each.value.max_count
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  lifecycle {
    ignore_changes = [
      initial_node_count
    ]
  }

  depends_on = [
    google_container_cluster.primary
  ]
}

output "name" {
  value = google_container_cluster.primary.name
}

output "endpoint" {
  value = google_container_cluster.primary.endpoint
}

output "location" {
  value = google_container_cluster.primary.location
}

output "ca_certificate" {
  value     = google_container_cluster.primary.master_auth[0].cluster_ca_certificate
  sensitive = true
}

output "internal_ip" {
  value = google_container_cluster.primary.private_cluster_config[0].private_endpoint
}