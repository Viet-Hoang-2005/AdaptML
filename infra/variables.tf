variable "domain_name" {
  description = "Base domain name for AI PaaS system"
  type        = string
  default     = "mlops-nids-nt114.id.vn"
}

variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "ap-southeast-1"
}

variable "project_name" {
  description = "Project name used for optional shared resources"
  type        = string
  default     = "mlops-paas"
}

variable "enable_batch_training" {
  description = "Enable AWS Batch resources for external training backend"
  type        = bool
  default     = true
}

variable "enable_compute" {
  description = "Enable legacy K3s EC2 master/worker compute"
  type        = bool
  default     = true
}

variable "enable_alb" {
  description = "Enable legacy Application Load Balancer and DNS alias"
  type        = bool
  default     = true
}

variable "enable_dns" {
  description = "Enable Route53 hosted zone and ACM certificate"
  type        = bool
  default     = true
}

variable "enable_legacy_sagemaker_pipeline" {
  description = "Enable legacy GitHub Actions and SageMaker IAM resources"
  type        = bool
  default     = true
}

variable "enable_nat_gateway" {
  description = "Enable NAT Gateway for private subnet outbound access"
  type        = bool
  default     = true
}

variable "batch_training_runner_image" {
  description = "Container image for the AWS Batch training runner. Leave empty to use the module-created ECR repository with the latest tag."
  type        = string
  default     = ""
}

variable "batch_training_vcpu" {
  description = "vCPU assigned to each Batch training job"
  type        = number
  default     = 2
}

variable "batch_training_memory" {
  description = "Memory in MiB assigned to each Batch training job"
  type        = number
  default     = 4096
}

variable "batch_training_job_timeout" {
  description = "Batch training job timeout in seconds"
  type        = number
  default     = 3600
}

variable "batch_training_compute_environment_type" {
  description = "AWS Batch compute type: FARGATE, FARGATE_SPOT, or EC2_SPOT"
  type        = string
  default     = "FARGATE"

  validation {
    condition     = contains(["FARGATE", "FARGATE_SPOT", "EC2_SPOT"], var.batch_training_compute_environment_type)
    error_message = "batch_training_compute_environment_type must be one of FARGATE, FARGATE_SPOT, or EC2_SPOT."
  }
}

variable "batch_training_max_vcpus" {
  description = "Maximum vCPUs AWS Batch can scale to for training jobs"
  type        = number
  default     = 16
}

variable "batch_training_assign_public_ip" {
  description = "Whether Fargate training jobs should receive a public IP"
  type        = bool
  default     = true
}
