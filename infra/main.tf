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
resource "aws_vpc" "mlops_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = "mlops-vpc" }
}

resource "aws_subnet" "public_1a" {
  vpc_id                  = aws_vpc.mlops_vpc.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "ap-southeast-1a"
  map_public_ip_on_launch = true
  tags = { Name = "mlops-subnet-public" }
}

resource "aws_subnet" "public_1b" {
  vpc_id                  = aws_vpc.mlops_vpc.id
  cidr_block              = "10.0.3.0/24"
  availability_zone       = "ap-southeast-1b"
  map_public_ip_on_launch = true
  tags = { Name = "mlops-subnet-public-backup" }
}

resource "aws_subnet" "private_1a" {
  vpc_id            = aws_vpc.mlops_vpc.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "ap-southeast-1a"
  tags = { Name = "mlops-subnet-private" }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.mlops_vpc.id
  tags = { Name = "mlops-igw" }
}

resource "aws_eip" "nat_eip" {
  domain = "vpc"
}

resource "aws_nat_gateway" "nat_gw" {
  allocation_id = aws_eip.nat_eip.id
  subnet_id     = aws_subnet.public_1a.id
  tags = { Name = "mlops-nat-gw" }
  depends_on    = [aws_internet_gateway.igw]
}

resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.mlops_vpc.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
  tags = { Name = "mlops-public-rt" }
}

resource "aws_route_table_association" "pub_1a_assoc" {
  subnet_id      = aws_subnet.public_1a.id
  route_table_id = aws_route_table.public_rt.id
}

resource "aws_route_table_association" "pub_1b_assoc" {
  subnet_id      = aws_subnet.public_1b.id
  route_table_id = aws_route_table.public_rt.id
}

resource "aws_route_table" "private_rt" {
  vpc_id = aws_vpc.mlops_vpc.id
  route {
    cidr_block = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat_gw.id
  }
  tags = { Name = "mlops-private-rt" }
}

resource "aws_route_table_association" "priv_1a_assoc" {
  subnet_id      = aws_subnet.private_1a.id
  route_table_id = aws_route_table.private_rt.id
}

# 2. SECURITY GROUPS
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
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "mlops-lb-sg" }
}

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
  # GitHub Actions gọi lệnh Deploy
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

resource "aws_security_group" "worker_sg" {
  name        = "mlops-worker-sg"
  description = "Security group for K3s Worker Node"
  vpc_id      = aws_vpc.mlops_vpc.id

  # Chỉ nhận Port 80 từ ALB
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
data "aws_ami" "ubuntu_22_04" {
  most_recent = true
  owners      = ["099720109477"]
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

resource "aws_instance" "master_node" {
  ami                    = data.aws_ami.ubuntu_22_04.id
  instance_type          = "t3.small"
  subnet_id              = aws_subnet.public_1a.id
  vpc_security_group_ids = [aws_security_group.master_sg.id]
  key_name               = "mlops-keypair"

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }
  tags = { Name = "mlops-master-node" }
}

resource "aws_instance" "worker_nodes" {
  count                  = 2
  ami                    = data.aws_ami.ubuntu_22_04.id
  instance_type          = "t3.medium"
  subnet_id              = aws_subnet.private_1a.id
  vpc_security_group_ids = [aws_security_group.worker_sg.id]
  key_name               = "mlops-keypair"

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }
  tags = { Name = "mlops-worker-${count.index + 1}" }
}

# 4. LOAD BALANCER & TARGET GROUP
resource "aws_lb_target_group" "worker_tg" {
  name     = "mlops-worker-tg"
  port     = 80
  protocol = "HTTP"
  vpc_id   = aws_vpc.mlops_vpc.id

  health_check {
    path                = "/"
    protocol            = "HTTP"
    port                = "traffic-port"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 15
  }
}

resource "aws_lb_target_group_attachment" "worker_attach" {
  count            = 2
  target_group_arn = aws_lb_target_group.worker_tg.arn
  target_id        = aws_instance.worker_nodes[count.index].id
  port             = 80
}

resource "aws_lb" "api_alb" {
  name               = "mlops-api-lb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.lb_sg.id]
  subnets            = [aws_subnet.public_1a.id, aws_subnet.public_1b.id]
}

resource "aws_lb_listener" "http_listener" {
  load_balancer_arn = aws_lb.api_alb.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.worker_tg.arn
  }
}

# 5. S3 BUCKET
resource "aws_s3_bucket" "artifacts_bucket" {
  bucket        = "mlops-nids-artifacts-${random_id.bucket_id.hex}"
  force_destroy = true
}

resource "random_id" "bucket_id" {
  byte_length = 4
}

resource "aws_s3_bucket_ownership_controls" "artifacts_acl_ownership" {
  bucket = aws_s3_bucket.artifacts_bucket.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts_public_block" {
  bucket                  = aws_s3_bucket.artifacts_bucket.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts_versioning" {
  bucket = aws_s3_bucket.artifacts_bucket.id
  versioning_configuration {
    status = "Enabled"
  }
}