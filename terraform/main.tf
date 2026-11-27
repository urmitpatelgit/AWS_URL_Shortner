locals {
  name = var.project_name
}

resource "aws_dynamodb_table" "urls" {
  name                        = "${local.name}-urls"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "shortCode"
  deletion_protection_enabled = true

  attribute {
    name = "shortCode"
    type = "S"
  }

  attribute {
    name = "longUrl"
    type = "S"
  }

  global_secondary_index {
    name            = "byLongUrl"
    hash_key        = "longUrl"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_cloudwatch_log_group" "shorten" {
  name              = "/aws/lambda/${local.name}-shorten"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "resolve" {
  name              = "/aws/lambda/${local.name}-resolve"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_s3_bucket" "site" {
  bucket_prefix = "${local.name}-site-"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
