output "aws_secrets_arn" {
  value = aws_secretsmanager_secret.aws_secrets.arn
}

output "github_actions_secrets_arn" {
  value = aws_secretsmanager_secret.github_actions_secrets.arn
}

output "production_secrets_arn" {
  value = aws_secretsmanager_secret.production_secrets.arn
}
