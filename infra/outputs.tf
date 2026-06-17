output "master_public_ip" {
  description = "Public IP for SSH access to Master Node"
  value       = var.enable_compute ? module.compute[0].master_public_ip : null
}

output "load_balancer_dns" {
  description = "Link to call the MLOps API"
  value       = local.enable_lb_stack ? module.load_balancer[0].lb_dns_name : null
}

output "s3_bucket_name" {
  description = "Model Storage Bucket"
  value       = module.storage.bucket_id
}

output "github_actions_role_arn" {
  description = "IAM Role ARN to configure in GitHub Variables"
  value       = local.enable_shared_iam ? module.iam[0].github_actions_role_arn : null
}

output "sagemaker_execution_role_arn" {
  description = "IAM Role ARN to configure in GitHub Variables for SageMaker"
  value       = local.enable_shared_iam ? module.iam[0].sagemaker_execution_role_arn : null
}

output "name_servers" {
  description = "Name Servers to configure in your domain registrar"
  value       = var.enable_dns ? module.dns[0].name_servers : null
}

output "batch_training_ecr_repository_url" {
  description = "ECR repository URL for the optional AWS Batch training runner"
  value       = var.enable_batch_training ? module.batch_training[0].ecr_repository_url : null
}

output "batch_training_job_queue_name" {
  description = "AWS Batch queue name for optional training backend"
  value       = var.enable_batch_training ? module.batch_training[0].batch_job_queue_name : null
}

output "batch_training_job_definition_name" {
  description = "AWS Batch job definition name for optional training backend"
  value       = var.enable_batch_training ? module.batch_training[0].batch_job_definition_name : null
}

output "batch_training_job_role_arn" {
  description = "IAM role ARN used by optional Batch training containers"
  value       = var.enable_batch_training ? module.batch_training[0].batch_job_role_arn : null
}
