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

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_1a_cidr" {
  description = "CIDR block for Public Subnet 1a"
  type        = string
  default     = "10.0.1.0/24"
}

variable "private_subnet_1a_cidr" {
  description = "CIDR block for Private Subnet 1a"
  type        = string
  default     = "10.0.2.0/24"
}

variable "public_subnet_1b_cidr" {
  description = "CIDR block for Public Subnet 1b"
  type        = string
  default     = "10.0.3.0/24"
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

variable "enable_github_actions_iam" {
  description = "Enable GitHub Actions OIDC and IAM resources"
  type        = bool
  default     = true
}

variable "enable_secrets_manager" {
  description = "Enable AWS Secrets Manager resources consumed by External Secrets and CI/CD"
  type        = bool
  default     = true
}

variable "enable_karpenter" {
  description = "Enable IAM and discovery tags required by Karpenter on the K3s cluster"
  type        = bool
  default     = true
}

variable "karpenter_cluster_name" {
  description = "Logical cluster name used by Karpenter discovery tags and IAM conditions"
  type        = string
  default     = "mlops-paas-cluster"
}

variable "enable_nat_gateway" {
  description = "Enable NAT Gateway for private subnet outbound access"
  type        = bool
  default     = true
}

variable "enable_compute" {
  description = "Enable legacy K3s EC2 master/worker compute"
  type        = bool
  default     = true
}

variable "key_name" {
  description = "EC2 Key Pair name for Master and Worker nodes SSH access"
  type        = string
  default     = "mlops-keypair"
}

variable "master_instance_type" {
  description = "EC2 instance type for K3s Master node"
  type        = string
  default     = "t3.medium"
}

variable "worker_instance_type" {
  description = "EC2 instance type for K3s Worker nodes"
  type        = string
  default     = "t3.large"
}

variable "master_volume_size" {
  description = "Root EBS volume size in GB for K3s Master node"
  type        = number
  default     = 40
}

variable "worker_instance_count" {
  description = "Number of EC2 Worker nodes for K3s cluster"
  type        = number
  default     = 2
}

variable "worker_volume_size" {
  description = "Root EBS volume size in GB for K3s Worker nodes"
  type        = number
  default     = 40
}
