output "lambda_arn" {
  description = "ARN of the webhook lambda function"
  value       = aws_lambda_function.github_webhook_lambda.arn
}
