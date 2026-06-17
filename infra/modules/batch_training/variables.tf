variable "project_name" {
  description = "Project name used for resource names and tags"
  type        = string
}

variable "aws_region" {
  description = "AWS region for Batch logs and image defaults"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where Batch compute runs"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for the Batch compute environment"
  type        = list(string)
}

variable "security_group_ids" {
  description = "Security group IDs attached to Batch compute"
  type        = list(string)
}

variable "artifacts_bucket_name" {
  description = "S3 bucket name for training source, data, and model artifacts"
  type        = string
}

variable "training_runner_image" {
  description = "Container image used by the Batch training job definition. If empty, uses this module's ECR repository with the latest tag."
  type        = string
  default     = ""
}

variable "vcpu" {
  description = "vCPU assigned to each training job"
  type        = number
  default     = 2
}

variable "memory" {
  description = "Memory in MiB assigned to each training job"
  type        = number
  default     = 4096
}

variable "job_timeout" {
  description = "Training job timeout in seconds"
  type        = number
  default     = 3600
}

variable "compute_environment_type" {
  description = "Batch compute type: FARGATE, FARGATE_SPOT, or EC2_SPOT"
  type        = string
  default     = "FARGATE"

  validation {
    condition     = contains(["FARGATE", "FARGATE_SPOT", "EC2_SPOT"], var.compute_environment_type)
    error_message = "compute_environment_type must be one of FARGATE, FARGATE_SPOT, or EC2_SPOT."
  }
}

variable "max_vcpus" {
  description = "Maximum vCPUs that AWS Batch can scale to"
  type        = number
  default     = 16
}

variable "assign_public_ip" {
  description = "Whether Fargate jobs should receive a public IP. Use false with private subnets that have NAT or VPC endpoints."
  type        = bool
  default     = false
}

variable "ec2_spot_instance_types" {
  description = "Allowed EC2 instance types when compute_environment_type is EC2_SPOT"
  type        = list(string)
  default     = ["m5.large", "m5.xlarge", "c5.xlarge"]
}
