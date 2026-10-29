terraform {
  required_version = ">= 1.5"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 7.18" }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" { type = string }
variable "region" {
  type    = string
  default = "us-west1"
}
variable "image" {
  type = string
  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Deploy a reviewed immutable image digest."
  }
}
variable "worker_count" {
  type    = number
  default = 1
  validation {
    condition     = var.worker_count >= 0 && var.worker_count <= 20 && floor(var.worker_count) == var.worker_count
    error_message = "Use 0-20 workers; zero stops the fleet."
  }
}
variable "invokers" {
  type = set(string)
  validation {
    condition     = length(var.invokers) > 0 && alltrue([for member in var.invokers : can(regex("^(user|group|serviceAccount):[^ ]+$", member))])
    error_message = "Name explicit IAM invokers; public access is forbidden."
  }
}
variable "runtime_secrets" {
  description = "Existing DEV Secret Manager names and numeric versions only; never pass secret payloads to Terraform."
  type        = map(object({ secret = string, version = string }))
  validation {
    condition = alltrue([for name in ["PIPELINE_DATABASE_URL", "TYPESAFE_API_KEY"] : contains(keys(var.runtime_secrets), name)]) && alltrue([
      for name, ref in var.runtime_secrets : contains(["PIPELINE_DATABASE_URL", "TYPESAFE_API_KEY", "UE_LOC_COOKIE", "AXIOM_TOKEN"], name)
      && can(regex("^[a-zA-Z0-9_-]+$", ref.secret)) && can(regex("^[1-9][0-9]*$", ref.version))
    ])
    error_message = "Reference versioned worker secrets, including PIPELINE_DATABASE_URL and TYPESAFE_API_KEY."
  }
}

# This rollout is DEV-only. Production identity/grant approval is deliberately not created here.
resource "google_service_account" "worker" {
  account_id   = "pipeline-worker-dev"
  display_name = "Fitsy DEV pipeline worker"
}
resource "google_secret_manager_secret_iam_member" "worker" {
  for_each  = toset([for ref in values(var.runtime_secrets) : ref.secret])
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}
resource "google_cloud_run_v2_service" "worker" {
  name                = "fitsy-pipeline-dev"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  scaling {
    scaling_mode          = "MANUAL"
    manual_instance_count = var.worker_count
  }
  template {
    service_account = google_service_account.worker.email
    timeout         = "30s"
    containers {
      image = var.image
      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        cpu_idle          = false
        startup_cpu_boost = true
      }
      ports { container_port = 8080 }
      dynamic "env" {
        for_each = var.runtime_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret
              version = env.value.version
            }
          }
        }
      }
      startup_probe {
        http_get { path = "/readyz" }
        period_seconds    = 5
        timeout_seconds   = 4
        failure_threshold = 12
      }
      liveness_probe {
        http_get { path = "/healthz" }
        period_seconds    = 30
        timeout_seconds   = 4
        failure_threshold = 3
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.worker]
}
resource "google_cloud_run_v2_service_iam_binding" "invokers" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  members  = var.invokers
}
output "worker_url" { value = google_cloud_run_v2_service.worker.uri }
