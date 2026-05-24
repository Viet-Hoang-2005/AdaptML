output "github_secrets_arn" {
  value = aws_secretsmanager_secret.github_secrets.arn
}

output "github_actions_secrets_arn" {
  value = aws_secretsmanager_secret.github_actions_secrets.arn
}

output "mlflow_basic_auth_arn" {
  value = aws_secretsmanager_secret.mlflow_basic_auth.arn
}
