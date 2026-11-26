resource "aws_acm_certificate" "site" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "site" {
  count = length(var.acm_validation_record_fqdns) > 0 ? 1 : 0

  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = var.acm_validation_record_fqdns

  timeouts {
    create = "45m"
  }
}
