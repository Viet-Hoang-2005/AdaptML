output "worker_profile_name" {
  description = "IAM instance profile name for worker nodes"
  value       = aws_iam_instance_profile.worker_profile.name
}

output "lambda_exec_role_arn" {
  description = "ARN of the Lambda execution role"
  value       = try(aws_iam_role.lambda_exec_role[0].arn, null)
}

output "github_actions_role_arn" {
  description = "IAM Role ARN to configure in GitHub Variables"
  value       = try(aws_iam_role.github_actions_role[0].arn, null)
}

output "sagemaker_execution_role_arn" {
  description = "IAM Role ARN to configure in GitHub Variables for SageMaker"
  value       = try(aws_iam_role.sagemaker_execution_role[0].arn, null)
}
