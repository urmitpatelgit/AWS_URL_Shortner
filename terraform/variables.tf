variable "aws_region" {
  description = "AWS region used for the application and ACM certificate."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  type    = string
  default = "urmit-url-shortener"
}

variable "domain_name" {
  description = "Public hostname served by CloudFront."
  type        = string
  default     = "links.example.com"
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "lambda_zip_path" {
  description = "Path to the built Lambda ZIP, relative to the Terraform directory."
  type        = string
  default     = "lambda.zip"
}

variable "create_distribution" {
  description = "Set true after the ACM certificate has been DNS validated."
  type        = bool
  default     = false
}

variable "acm_validation_record_fqdns" {
  description = "ACM DNS validation record FQDNs, after publishing them at the DNS provider."
  type        = list(string)
  default     = []
}
