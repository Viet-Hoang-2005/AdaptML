# Khung Secrets cho AWS Credentials
resource "aws_secretsmanager_secret" "aws_secrets" {
  name        = "mlops/aws-secrets"
  description = "AWS Credentials"
}

# Khung Secrets cho Production
resource "aws_secretsmanager_secret" "production_secrets" {
  name        = "mlops/production-secrets"
  description = "Secrets for K3s Cluster (ArgoCD, Postgres, Redis, etc)"
}

# Khung Secrets cho GitHub Actions
resource "aws_secretsmanager_secret" "github_actions_secrets" {
  name        = "mlops/github-actions-secrets"
  description = "Secrets for GitHub Actions CI/CD pipeline (Harbor)"
}
