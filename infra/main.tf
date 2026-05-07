terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Region AWS
provider "aws" {
  region = "ap-southeast-1"
}

# 1. NETWORKING (VPC, Subnets, IGW, NAT GW)
# VPC
resource "aws_vpc" "mlops_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = "mlops-vpc" }
}

# Subnet Public
resource "aws_subnet" "public_1a" {
  vpc_id                  = aws_vpc.mlops_vpc.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "ap-southeast-1a"
  map_public_ip_on_launch = true
  tags                    = { Name = "mlops-subnet-public" }
}

# Subnet Public Backup
resource "aws_subnet" "public_1b" {
  vpc_id                  = aws_vpc.mlops_vpc.id
  cidr_block              = "10.0.3.0/24"
  availability_zone       = "ap-southeast-1b"
  map_public_ip_on_launch = true
  tags                    = { Name = "mlops-subnet-public-backup" }
}

# Subnet Private
resource "aws_subnet" "private_1a" {
  vpc_id            = aws_vpc.mlops_vpc.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "ap-southeast-1a"
  tags              = { Name = "mlops-subnet-private" }
}

# Internet Gateway
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.mlops_vpc.id
  tags   = { Name = "mlops-igw" }
}

# Elastic IP cho NAT Gateway
resource "aws_eip" "nat_eip" {
  domain = "vpc"
  tags   = { Name = "mlops-nat-eip" }
}

# Elastic IP cố định cho Master Node
resource "aws_eip" "master_eip" {
  domain   = "vpc"
  instance = aws_instance.master_node.id
  tags     = { Name = "mlops-master-eip" }
}

# NAT Gateway
resource "aws_nat_gateway" "nat_gw" {
  allocation_id = aws_eip.nat_eip.id
  subnet_id     = aws_subnet.public_1a.id
  tags          = { Name = "mlops-nat-gw" }
  depends_on    = [aws_internet_gateway.igw]
}

# Route Table Public
resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.mlops_vpc.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
  tags = { Name = "mlops-public-rt" }
}

# Route Table Association Public
resource "aws_route_table_association" "pub_1a_assoc" {
  subnet_id      = aws_subnet.public_1a.id
  route_table_id = aws_route_table.public_rt.id
}

# Route Table Association Public Backup
resource "aws_route_table_association" "pub_1b_assoc" {
  subnet_id      = aws_subnet.public_1b.id
  route_table_id = aws_route_table.public_rt.id
}

# Route Table Private
resource "aws_route_table" "private_rt" {
  vpc_id = aws_vpc.mlops_vpc.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat_gw.id
  }
  tags = { Name = "mlops-private-rt" }
}

# Route Table Association Private
resource "aws_route_table_association" "priv_1a_assoc" {
  subnet_id      = aws_subnet.private_1a.id
  route_table_id = aws_route_table.private_rt.id
}

# 2. SECURITY GROUPS
# Security Group cho Load Balancer
resource "aws_security_group" "lb_sg" {
  name        = "mlops-lb-sg"
  description = "Security group for Application Load Balancer"
  vpc_id      = aws_vpc.mlops_vpc.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "mlops-lb-sg" }
}

# Security Group cho Master Node
resource "aws_security_group" "master_sg" {
  name        = "mlops-master-sg"
  description = "Security group for K3s Master Node"
  vpc_id      = aws_vpc.mlops_vpc.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 6443
    to_port     = 6443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/16"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "mlops-master-sg" }
}

# Security Group cho Worker Node
resource "aws_security_group" "worker_sg" {
  name        = "mlops-worker-sg"
  description = "Security group for K3s Worker Node"
  vpc_id      = aws_vpc.mlops_vpc.id

  ingress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.lb_sg.id]
  }
  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/16"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "mlops-worker-sg" }
}

# 3. EC2 INSTANCES (Master & Workers)
# Data AMI Ubuntu
data "aws_ami" "ubuntu_22_04" {
  most_recent = true
  owners      = ["099720109477"]
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

# EC2 Master Node
resource "aws_instance" "master_node" {
  ami                    = data.aws_ami.ubuntu_22_04.id
  instance_type          = "t3.small"
  subnet_id              = aws_subnet.public_1a.id
  vpc_security_group_ids = [aws_security_group.master_sg.id]
  key_name               = "mlops-keypair"

  root_block_device {
    volume_size = 40
    volume_type = "gp3"
  }
  tags = { Name = "mlops-master-node" }
}

# EC2 Worker Node
resource "aws_instance" "worker_nodes" {
  count                  = 2
  ami                    = data.aws_ami.ubuntu_22_04.id
  instance_type          = "t3.large"
  subnet_id              = aws_subnet.private_1a.id
  vpc_security_group_ids = [aws_security_group.worker_sg.id]
  key_name               = "mlops-keypair"

  root_block_device {
    volume_size = 40
    volume_type = "gp3"
  }
  iam_instance_profile = aws_iam_instance_profile.worker_profile.name
  tags                 = { Name = "mlops-worker-${count.index + 1}" }
}

# 4. LOAD BALANCER & TARGET GROUP
# Target Group cho Worker Node
resource "aws_lb_target_group" "worker_tg" {
  name     = "mlops-worker-tg"
  port     = 80
  protocol = "HTTP"
  vpc_id   = aws_vpc.mlops_vpc.id

  # Cấu hình health check trỏ vào Traefik Ping Endpoint
  health_check {
    path                = "/ping"
    protocol            = "HTTP"
    port                = "traffic-port"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 15
    matcher             = "200"
  }
}

# Gắn Target Group với Worker Node
resource "aws_lb_target_group_attachment" "worker_attach" {
  count            = 2
  target_group_arn = aws_lb_target_group.worker_tg.arn
  target_id        = aws_instance.worker_nodes[count.index].id
  port             = 80
}

# Load Balancer
resource "aws_lb" "api_alb" {
  name               = "mlops-api-lb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.lb_sg.id]
  subnets            = [aws_subnet.public_1a.id, aws_subnet.public_1b.id]
}

# Listener HTTPS (Cổng 443)
resource "aws_lb_listener" "https_listener" {
  load_balancer_arn = aws_lb.api_alb.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = aws_acm_certificate_validation.mlops_cert_validation.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.worker_tg.arn
  }
}

# Listener HTTP (Cổng 80) - Tự động chuyển hướng sang HTTPS
resource "aws_lb_listener" "http_listener" {
  load_balancer_arn = aws_lb.api_alb.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# 5. S3 BUCKET
resource "aws_s3_bucket" "artifacts_bucket" {
  bucket        = "mlops-nids-artifacts"
  force_destroy = true
}

# Thiết lập quyền truy cập và versioning cho S3 bucket
resource "aws_s3_bucket_ownership_controls" "artifacts_acl_ownership" {
  bucket = aws_s3_bucket.artifacts_bucket.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Chặn truy cập công khai vào S3 bucket
resource "aws_s3_bucket_public_access_block" "artifacts_public_block" {
  bucket                  = aws_s3_bucket.artifacts_bucket.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Kích hoạt versioning cho S3 bucket
resource "aws_s3_bucket_versioning" "artifacts_versioning" {
  bucket = aws_s3_bucket.artifacts_bucket.id
  versioning_configuration {
    status = "Enabled"
  }
}

# 6. AWS LAMBDA & S3 EVENT NOTIFICATION
# IAM Rule cho Lambda
data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "lambda_exec_role" {
  name               = "mlops-lambda-github-webhook-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

# Gán quyền IAM Rule cho Lambda thực thi
resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# IAM Policy cho Lambda đọc Secrets Manager
data "aws_iam_policy_document" "lambda_secrets_policy" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue"
    ]
    resources = [
      aws_secretsmanager_secret.github_secrets.arn
    ]
  }
}

resource "aws_iam_role_policy" "lambda_secrets_policy_attach" {
  name   = "mlops-lambda-secrets-policy"
  role   = aws_iam_role.lambda_exec_role.id
  policy = data.aws_iam_policy_document.lambda_secrets_policy.json
}

# Nén code Lambda thành file zip
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/lambda/s3_webhook_trigger.py"
  output_path = "${path.module}/lambda/s3_webhook_trigger.zip"
}

# Lambda Function
resource "aws_lambda_function" "github_webhook_lambda" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = "mlops-trigger-github-webhook"
  role             = aws_iam_role.lambda_exec_role.arn
  handler          = "s3_webhook_trigger.lambda_handler"
  runtime          = "python3.10"
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

}

# Cho phép S3 invoke Lambda
resource "aws_lambda_permission" "allow_s3_invocation" {
  statement_id  = "AllowExecutionFromS3Bucket"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.github_webhook_lambda.arn
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.artifacts_bucket.arn
}

# S3 Event Notification
resource "aws_s3_bucket_notification" "bucket_notification" {
  bucket = aws_s3_bucket.artifacts_bucket.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.github_webhook_lambda.arn
    events              = ["s3:ObjectCreated:*"]
    filter_suffix       = "data_manifest.json"
  }

  depends_on = [aws_lambda_permission.allow_s3_invocation]
}

# 7. AWS SECRETS MANAGER & IAM FOR K3S WORKERS
# Tạo IAM Role cho Worker Nodes
data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "worker_role" {
  name               = "mlops-worker-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

# Policy cho phép Worker Node đọc/ghi vào S3 Bucket của dự án
data "aws_iam_policy_document" "worker_s3_policy_doc" {
  statement {
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:DeleteObject"
    ]
    resources = [
      aws_s3_bucket.artifacts_bucket.arn,
      "${aws_s3_bucket.artifacts_bucket.arn}/*"
    ]
  }
}

resource "aws_iam_policy" "worker_s3_policy" {
  name        = "mlops-worker-s3-policy"
  description = "Allow K3s worker nodes to read/write artifacts in project bucket"
  policy      = data.aws_iam_policy_document.worker_s3_policy_doc.json
}

# Gắn policy đọc/ghi S3 vào Worker Role
resource "aws_iam_role_policy_attachment" "worker_s3_attach" {
  role       = aws_iam_role.worker_role.name
  policy_arn = aws_iam_policy.worker_s3_policy.arn
}

# Tạo Policy cho phép Worker Node đọc Secrets Manager
data "aws_iam_policy_document" "secrets_read_policy" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "worker_secrets_policy" {
  name        = "mlops-worker-secrets-policy"
  description = "Allow K3s worker nodes to read secrets from AWS Secrets Manager"
  policy      = data.aws_iam_policy_document.secrets_read_policy.json
}

# Gắn quyền đọc secrets cho Worker Nodes
resource "aws_iam_role_policy_attachment" "worker_secrets_attach" {
  role       = aws_iam_role.worker_role.name
  policy_arn = aws_iam_policy.worker_secrets_policy.arn
}

# Gắn quyền cho EBS CSI Driver để tự động cấp phát ổ cứng AWS EBS
resource "aws_iam_role_policy_attachment" "worker_ebs_csi_attach" {
  role       = aws_iam_role.worker_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

# Tạo Instance Profile để gắn vào EC2
resource "aws_iam_instance_profile" "worker_profile" {
  name = "mlops-worker-profile"
  role = aws_iam_role.worker_role.name
}

# Khởi tạo các khung Secrets trên AWS Secrets Manager
resource "aws_secretsmanager_secret" "aws_secrets" {
  name        = "mlops/aws-secrets"
  description = "AWS Credentials for MLOps K3s"
}

resource "aws_secretsmanager_secret" "postgres_secrets" {
  name        = "mlops/postgres-secrets"
  description = "PostgreSQL Credentials"
}

resource "aws_secretsmanager_secret" "github_secrets" {
  name        = "mlops/github-secrets"
  description = "GitHub Webhook Token"
}

resource "aws_secretsmanager_secret" "mlflow_basic_auth" {
  name        = "mlops/mlflow-basic-auth"
  description = "MLflow Native Authentication"
}

resource "aws_secretsmanager_secret" "tunnel_token" {
  name        = "mlops/tunnel-token"
  description = "Cloudflare Tunnel Token"
}

# 8. GITHUB ACTIONS OIDC
# Khởi tạo khung Secret cho GitHub Actions
resource "aws_secretsmanager_secret" "github_actions_secrets" {
  name        = "mlops/github-actions-secrets"
  description = "Secrets for GitHub Actions CI/CD pipeline (DockerHub, Slack, Kubeconfig)"
}

# Tạo OIDC Provider cho GitHub
resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["1c58a3a8518e8759bf075b76b750d4f2df264fcd", "6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# Tạo IAM Role cho GitHub Actions
data "aws_iam_policy_document" "github_actions_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      # Giới hạn chỉ Repository này mới được quyền dùng Role
      values = ["repo:Viet-Hoang-2005/MLOps-nids-system:*"]
    }
  }
}

resource "aws_iam_role" "github_actions_role" {
  name               = "mlops-github-actions-role"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume_role.json
}

# Cấp quyền đọc Secret và S3 cho Role của GitHub Actions
data "aws_iam_policy_document" "github_actions_policy" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue"
    ]
    resources = [
      aws_secretsmanager_secret.github_actions_secrets.arn,
      aws_secretsmanager_secret.mlflow_basic_auth.arn
    ]
  }

  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject"
    ]
    resources = [
      aws_s3_bucket.artifacts_bucket.arn,
      "${aws_s3_bucket.artifacts_bucket.arn}/*"
    ]
  }

  statement {
    effect = "Allow"
    actions = [
      "sagemaker:CreateTrainingJob",
      "sagemaker:DescribeTrainingJob"
    ]
    resources = ["*"]
  }

  statement {
    effect = "Allow"
    actions = [
      "iam:PassRole"
    ]
    resources = [
      aws_iam_role.sagemaker_execution_role.arn
    ]
  }
}

resource "aws_iam_role_policy" "github_actions_policy_attach" {
  name   = "mlops-github-actions-policy"
  role   = aws_iam_role.github_actions_role.id
  policy = data.aws_iam_policy_document.github_actions_policy.json
}

# 9. DNS (Route 53)
# Khởi tạo Hosted Zone cho tên miền
resource "aws_route53_zone" "mlops_zone" {
  name = "api.mlops-nids-nt114.id.vn"
  tags = { Name = "mlops-api-subzone" }
}

# Tạo bản ghi A (Alias) tại gốc của subdomain zone trỏ về Load Balancer
resource "aws_route53_record" "api_dns" {
  zone_id = aws_route53_zone.mlops_zone.zone_id
  name    = aws_route53_zone.mlops_zone.name
  type    = "A"

  alias {
    name                   = aws_lb.api_alb.dns_name
    zone_id                = aws_lb.api_alb.zone_id
    evaluate_target_health = true
  }
}

# 10. SSL/TLS Certificate (ACM)
# Yêu cầu chứng chỉ SSL
resource "aws_acm_certificate" "mlops_cert" {
  domain_name       = "api.mlops-nids-nt114.id.vn"
  validation_method = "DNS"

  tags = { Name = "mlops-api-cert" }

  lifecycle {
    create_before_destroy = true
  }
}

# Tạo bản ghi DNS để xác thực chứng chỉ (ACM Validation)
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.mlops_cert.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.mlops_zone.zone_id
}

# Chờ xác thực chứng chỉ hoàn tất
resource "aws_acm_certificate_validation" "mlops_cert_validation" {
  certificate_arn         = aws_acm_certificate.mlops_cert.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# 11. AWS SAGEMAKER FOR TRAINING
# Tạo IAM Role cho SageMaker
data "aws_iam_policy_document" "sagemaker_assume_role" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["sagemaker.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "sagemaker_execution_role" {
  name               = "mlops-sagemaker-execution-role"
  assume_role_policy = data.aws_iam_policy_document.sagemaker_assume_role.json
}

# Gắn managed policy AmazonSageMakerFullAccess
resource "aws_iam_role_policy_attachment" "sagemaker_full_access" {
  role       = aws_iam_role.sagemaker_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSageMakerFullAccess"
}

# Gắn policy đọc/ghi S3 (dùng lại policy của Worker)
resource "aws_iam_role_policy_attachment" "sagemaker_s3_attach" {
  role       = aws_iam_role.sagemaker_execution_role.name
  policy_arn = aws_iam_policy.worker_s3_policy.arn
}

# Gắn policy đọc Secrets Manager (dùng lại policy của Worker)
resource "aws_iam_role_policy_attachment" "sagemaker_secrets_attach" {
  role       = aws_iam_role.sagemaker_execution_role.name
  policy_arn = aws_iam_policy.worker_secrets_policy.arn
}

# 12. OUTPUTS
output "master_public_ip" {
  description = "Public IP for SSH access to Master Node"
  value       = aws_eip.master_eip.public_ip
}

output "load_balancer_dns" {
  description = "Link to call the MLOps API"
  value       = aws_lb.api_alb.dns_name
}

output "s3_bucket_name" {
  description = "Model Storage Bucket"
  value       = aws_s3_bucket.artifacts_bucket.id
}

output "github_actions_role_arn" {
  description = "IAM Role ARN to configure in GitHub Variables"
  value       = aws_iam_role.github_actions_role.arn
}

output "sagemaker_execution_role_arn" {
  description = "IAM Role ARN to configure in GitHub Variables for SageMaker"
  value       = aws_iam_role.sagemaker_execution_role.arn
}

output "name_servers" {
  description = "Name Servers to configure in your domain registrar"
  value       = aws_route53_zone.mlops_zone.name_servers
}
