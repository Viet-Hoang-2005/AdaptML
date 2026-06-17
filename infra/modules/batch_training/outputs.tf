output "ecr_repository_url" {
  description = "ECR repository URL for the training runner image"
  value       = aws_ecr_repository.training_runner.repository_url
}

output "batch_job_queue_name" {
  description = "AWS Batch job queue name for training jobs"
  value       = aws_batch_job_queue.training.name
}

output "batch_job_definition_name" {
  description = "AWS Batch job definition name for training jobs"
  value       = aws_batch_job_definition.training.name
}

output "batch_job_role_arn" {
  description = "IAM role ARN used by training containers"
  value       = aws_iam_role.job_role.arn
}
