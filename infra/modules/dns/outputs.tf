output "zone_id" {
  description = "The Hosted Zone ID"
  value       = aws_route53_zone.mlops_zone.zone_id
}

output "zone_name" {
  description = "The Hosted Zone Name"
  value       = aws_route53_zone.mlops_zone.name
}

output "certificate_arn" {
  description = "The ARN of the validated ACM certificate"
  value       = aws_acm_certificate_validation.mlops_cert_validation.certificate_arn
}

output "name_servers" {
  description = "The name servers of the Hosted Zone"
  value       = aws_route53_zone.mlops_zone.name_servers
}
