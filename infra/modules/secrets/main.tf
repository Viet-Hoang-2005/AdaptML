# Khởi tạo các khung Secrets trên AWS Secrets Manager
resource "aws_secretsmanager_secret" "aws_secrets" {
  name        = "mlops/aws-secrets"
  description = "AWS Credentials for MLOps K3s"
}

resource "aws_secretsmanager_secret" "postgres_secrets" {
  name        = "mlops/postgres-secrets"
  description = "PostgreSQL Credentials"
}

resource "aws_secretsmanager_secret" "github_secrets" {
  name        = "mlops/github-secrets"
  description = "GitHub Webhook Token"
}

resource "aws_secretsmanager_secret" "mlflow_basic_auth" {
  name        = "mlops/mlflow-basic-auth"
  description = "MLflow Native Authentication"
}

resource "aws_secretsmanager_secret" "tunnel_token" {
  name        = "mlops/tunnel-token"
  description = "Cloudflare Tunnel Token"
}

# Khởi tạo khung Secret cho GitHub Actions
resource "aws_secretsmanager_secret" "github_actions_secrets" {
  name        = "mlops/github-actions-secrets"
  description = "Secrets for GitHub Actions CI/CD pipeline (DockerHub, Slack, ArgoCD)"
}
