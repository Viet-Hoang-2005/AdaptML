output "certificate_arn" {
  description = "The ARN of the ACM certificate"
  value       = aws_acm_certificate_validation.mlops_cert_val.certificate_arn
}

output "acm_domain_validation_options" {
  description = "CNAME records to add to Cloudflare DNS for SSL certificate validation"
  value       = aws_acm_certificate.mlops_cert.domain_validation_options
}
