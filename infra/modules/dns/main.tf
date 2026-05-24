# Khởi tạo Hosted Zone cho tên miền
resource "aws_route53_zone" "mlops_zone" {
  name = var.domain_name
  tags = { Name = "mlops-api-subzone" }
}

# Yêu cầu chứng chỉ SSL
resource "aws_acm_certificate" "mlops_cert" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  tags = { Name = "mlops-api-cert" }

  lifecycle {
    create_before_destroy = true
  }
}

# Tạo bản ghi DNS để xác thực chứng chỉ (ACM Validation)
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.mlops_cert.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.mlops_zone.zone_id
}

# Chờ xác thực chứng chỉ hoàn tất
resource "aws_acm_certificate_validation" "mlops_cert_validation" {
  certificate_arn         = aws_acm_certificate.mlops_cert.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}
