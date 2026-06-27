# Yêu cầu chứng chỉ SSL wildcard cho toàn bộ hệ thống
resource "aws_acm_certificate" "mlops_cert" {
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  tags = { Name = "mlops-cert" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "mlops_cert_val" {
  certificate_arn = aws_acm_certificate.mlops_cert.arn
}
