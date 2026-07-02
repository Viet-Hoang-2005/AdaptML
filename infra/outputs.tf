output "master_public_ip" {
  description = "Public IP for SSH access to Master Node"
  value       = var.enable_compute ? module.compute[0].master_public_ip : null
}

output "master_private_ip" {
  description = "Private IP of Master Node inside VPC"
  value       = var.enable_compute ? module.compute[0].master_private_ip : null
}

output "worker_private_ips" {
  description = "List of Private IPs of Worker Nodes inside VPC"
  value       = var.enable_compute ? module.compute[0].worker_private_ips : []
}

output "alb_dns" {
  description = "Application Load Balancer AWS Domain"
  value       = local.enable_lb_stack ? module.alb[0].lb_dns_name : null
}

output "frontend_url" {
  description = "Public URL for ReactJS Dashboard"
  value       = local.enable_lb_stack ? "https://${var.domain_name}" : null
}

output "api_url" {
  description = "Public URL for Django Control Plane API"
  value       = local.enable_lb_stack ? "https://api.${var.domain_name}" : null
}

output "s3_bucket_name" {
  description = "Model Storage Bucket"
  value       = module.storage.bucket_id
}

output "github_actions_role_arn" {
  description = "IAM Role ARN to configure in GitHub Variables"
  value       = local.enable_shared_iam ? module.iam[0].github_actions_role_arn : null
}


output "acm_ssl_validation_records" {
  description = "CNAME records to copy to Cloudflare DNS table to validate ACM SSL Certificate"
  value       = var.enable_dns ? module.dns[0].acm_domain_validation_options : null
}
