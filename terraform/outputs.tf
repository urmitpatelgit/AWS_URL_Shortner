output "cloudfront_domain_name" {
  value = var.create_distribution ? aws_cloudfront_distribution.site[0].domain_name : null
}

output "cloudfront_hosted_zone_id" {
  value = var.create_distribution ? aws_cloudfront_distribution.site[0].hosted_zone_id : null
}

output "certificate_dns_validation_records" {
  value = aws_acm_certificate.site.domain_validation_options
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "site_bucket_name" {
  value = aws_s3_bucket.site.bucket
}

output "cloudfront_distribution_id" {
  value = var.create_distribution ? aws_cloudfront_distribution.site[0].id : null
}
