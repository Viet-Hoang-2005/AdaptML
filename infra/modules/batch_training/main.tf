locals {
  is_ec2_spot      = var.compute_environment_type == "EC2_SPOT"
  is_fargate       = !local.is_ec2_spot
  artifacts_bucket = "arn:aws:s3:::${var.artifacts_bucket_name}"
  training_image   = var.training_runner_image != "" ? var.training_runner_image : "${aws_ecr_repository.training_runner.repository_url}:latest"
}

resource "aws_ecr_repository" "training_runner" {
  name                 = "mlops-training-runner"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name    = "mlops-training-runner"
    Project = var.project_name
  }
}

resource "aws_cloudwatch_log_group" "batch_training" {
  name              = "/aws/batch/mlops-training"
  retention_in_days = 14

  tags = {
    Name    = "/aws/batch/mlops-training"
    Project = var.project_name
  }
}

data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "task_execution_role" {
  name               = "${var.project_name}-batch-task-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json

  tags = {
    Project = var.project_name
  }
}

resource "aws_iam_role_policy_attachment" "task_execution_role_policy" {
  role       = aws_iam_role.task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_logs" {
  name = "${var.project_name}-batch-task-execution-logs"
  role = aws_iam_role.task_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.batch_training.arn}:*"
      }
    ]
  })
}

resource "aws_iam_role" "job_role" {
  name               = "${var.project_name}-batch-training-job-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json

  tags = {
    Project = var.project_name
  }
}

resource "aws_iam_role_policy" "job_s3_artifacts" {
  name = "${var.project_name}-batch-training-s3-artifacts"
  role = aws_iam_role.job_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = local.artifacts_bucket
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "${local.artifacts_bucket}/*"
      }
    ]
  })
}

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

resource "aws_iam_role" "ecs_instance_role" {
  count              = local.is_ec2_spot ? 1 : 0
  name               = "${var.project_name}-batch-ecs-instance-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json

  tags = {
    Project = var.project_name
  }
}

resource "aws_iam_role_policy_attachment" "ecs_instance_role_policy" {
  count      = local.is_ec2_spot ? 1 : 0
  role       = aws_iam_role.ecs_instance_role[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

resource "aws_iam_instance_profile" "ecs_instance_profile" {
  count = local.is_ec2_spot ? 1 : 0
  name  = "${var.project_name}-batch-ecs-instance-profile"
  role  = aws_iam_role.ecs_instance_role[0].name
}

resource "aws_batch_compute_environment" "training" {
  compute_environment_name = "${var.project_name}-training-compute"
  type                     = "MANAGED"
  state                    = "ENABLED"

  dynamic "compute_resources" {
    for_each = local.is_fargate ? [1] : []

    content {
      type               = var.compute_environment_type
      max_vcpus          = var.max_vcpus
      subnets            = var.subnet_ids
      security_group_ids = var.security_group_ids
    }
  }

  dynamic "compute_resources" {
    for_each = local.is_ec2_spot ? [1] : []

    content {
      type                = "SPOT"
      min_vcpus           = 0
      max_vcpus           = var.max_vcpus
      desired_vcpus       = 0
      instance_role       = aws_iam_instance_profile.ecs_instance_profile[0].arn
      instance_type       = var.ec2_spot_instance_types
      allocation_strategy = "SPOT_CAPACITY_OPTIMIZED"
      subnets             = var.subnet_ids
      security_group_ids  = var.security_group_ids
    }
  }

  tags = {
    Name    = "${var.project_name}-training-compute"
    Project = var.project_name
  }
}

resource "aws_batch_job_queue" "training" {
  name     = "mlops-paas-training-queue"
  state    = "ENABLED"
  priority = 1

  compute_environment_order {
    order               = 1
    compute_environment = aws_batch_compute_environment.training.arn
  }

  tags = {
    Name    = "mlops-paas-training-queue"
    Project = var.project_name
  }
}

resource "aws_batch_job_definition" "training" {
  name                  = "mlops-paas-training-job"
  type                  = "container"
  platform_capabilities = local.is_fargate ? ["FARGATE"] : ["EC2"]

  container_properties = jsonencode({
    image            = local.training_image
    executionRoleArn = aws_iam_role.task_execution_role.arn
    jobRoleArn       = aws_iam_role.job_role.arn
    command          = ["python", "/app/train_runner.py"]
    resourceRequirements = [
      {
        type  = "VCPU"
        value = tostring(var.vcpu)
      },
      {
        type  = "MEMORY"
        value = tostring(var.memory)
      }
    ]
    environment = [
      {
        name  = "AWS_DEFAULT_REGION"
        value = var.aws_region
      },
      {
        name  = "AWS_BUCKET_NAME"
        value = var.artifacts_bucket_name
      }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.batch_training.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "training"
      }
    }
    networkConfiguration = local.is_fargate ? {
      assignPublicIp = var.assign_public_ip ? "ENABLED" : "DISABLED"
    } : null
  })

  timeout {
    attempt_duration_seconds = var.job_timeout
  }

  tags = {
    Name    = "mlops-paas-training-job"
    Project = var.project_name
  }
}
