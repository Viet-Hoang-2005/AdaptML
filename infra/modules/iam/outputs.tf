output "worker_profile_name" {
  description = "IAM instance profile name for worker nodes"
  value       = aws_iam_instance_profile.worker_profile.name
}


output "github_actions_role_arn" {
  description = "IAM Role ARN to configure in GitHub Variables"
  value       = try(aws_iam_role.github_actions_role[0].arn, null)
}


