variable "artifacts_bucket_arn" {
  description = "ARN of the S3 bucket for artifacts"
  type        = string
}

variable "github_secrets_arn" {
  description = "ARN of the github secrets"
  type        = string
}

variable "github_actions_secrets_arn" {
  description = "ARN of the github actions secrets"
  type        = string
}

variable "mlflow_basic_auth_arn" {
  description = "ARN of the MLflow basic auth secrets"
  type        = string
}


variable "enable_github_actions_iam" {
  description = "Whether to create GitHub Actions OIDC and IAM resources"
  type        = bool
  default     = false
}
