output "master_public_ip" {
  description = "Public IP for SSH access to Master Node"
  value       = module.compute.master_public_ip
}

output "alb_dns" {
  description = "Link to call the MLOps API"
  value       = module.alb.lb_dns_name
}

output "s3_bucket_name" {
  description = "Model Storage Bucket"
  value       = module.storage.bucket_id
}

output "github_actions_role_arn" {
  description = "IAM Role ARN to configure in GitHub Variables"
  value       = module.iam.github_actions_role_arn
}

output "sagemaker_execution_role_arn" {
  description = "IAM Role ARN to configure in GitHub Variables for SageMaker"
  value       = module.iam.sagemaker_execution_role_arn
}

output "name_servers" {
  description = "Name Servers to configure in your domain registrar"
  value       = module.dns.name_servers
}
