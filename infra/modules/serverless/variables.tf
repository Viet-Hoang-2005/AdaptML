variable "lambda_exec_role_arn" {
  description = "ARN of the IAM role for Lambda execution"
  type        = string
}

variable "artifacts_bucket_id" {
  description = "ID of the S3 bucket for artifacts"
  type        = string
}

variable "artifacts_bucket_arn" {
  description = "ARN of the S3 bucket for artifacts"
  type        = string
}
