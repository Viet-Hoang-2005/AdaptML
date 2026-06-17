variable "vpc_id" {
  description = "VPC ID where security groups will be created"
  type        = string
}

variable "enable_legacy_security_groups" {
  description = "Whether to create security groups for legacy K3s and ALB resources"
  type        = bool
  default     = false
}
