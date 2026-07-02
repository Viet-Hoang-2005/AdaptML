# AWS IAM FOR K3S WORKERS
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
      "s3:DeleteObject",
      "s3:ListBucketMultipartUploads",
      "s3:ListMultipartUploadParts",
      "s3:AbortMultipartUpload",
      "s3:GetBucketLocation"
    ]
    resources = [
      var.artifacts_bucket_arn,
      "${var.artifacts_bucket_arn}/*"
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

# Cho phép Worker Node (control-plane pod dùng instance role này) submit/quản lý
# AWS Batch training jobs và đọc CloudWatch logs của job.
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_iam_policy_document" "worker_batch_policy_doc" {
  statement {
    sid    = "BatchSubmitAndManage"
    effect = "Allow"
    actions = [
      "batch:SubmitJob",
      "batch:DescribeJobs",
      "batch:TerminateJob",
      "batch:ListJobs",
      "batch:DescribeJobQueues",
      "batch:DescribeJobDefinitions",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "BatchTrainingLogsRead"
    effect = "Allow"
    actions = [
      "logs:GetLogEvents",
      "logs:DescribeLogStreams",
      "logs:DescribeLogGroups",
    ]
    resources = [
      "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/batch/mlops-training:*",
    ]
  }

  # AWS Batch cần PassRole để gán execution/job role vào container của job.
  statement {
    sid    = "BatchPassRole"
    effect = "Allow"
    actions = [
      "iam:PassRole",
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/mlops-paas-batch-task-execution-role",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/mlops-paas-batch-training-job-role",
    ]
  }
}

resource "aws_iam_policy" "worker_batch_policy" {
  name        = "mlops-worker-batch-policy"
  description = "Allow K3s worker nodes (control-plane) to submit and manage AWS Batch training jobs"
  policy      = data.aws_iam_policy_document.worker_batch_policy_doc.json
}

resource "aws_iam_role_policy_attachment" "worker_batch_attach" {
  role       = aws_iam_role.worker_role.name
  policy_arn = aws_iam_policy.worker_batch_policy.arn
}


# GITHUB ACTIONS OIDC
# Tạo OIDC Provider cho GitHub
resource "aws_iam_openid_connect_provider" "github_actions" {
  count           = var.enable_github_actions_iam ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["1c58a3a8518e8759bf075b76b750d4f2df264fcd", "6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# Tạo IAM Role cho GitHub Actions
data "aws_iam_policy_document" "github_actions_assume_role" {
  count = var.enable_github_actions_iam ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions[0].arn]
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
  count              = var.enable_github_actions_iam ? 1 : 0
  name               = "mlops-github-actions-role"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume_role[0].json
}

# Cấp quyền đọc Secret và S3 cho Role của GitHub Actions
data "aws_iam_policy_document" "github_actions_policy" {
  count = var.enable_github_actions_iam ? 1 : 0

  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue"
    ]
    resources = [
      var.github_actions_secrets_arn,
      var.mlflow_basic_auth_arn,
      var.github_secrets_arn,
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
      var.artifacts_bucket_arn,
      "${var.artifacts_bucket_arn}/*"
    ]
  }
}

resource "aws_iam_role_policy" "github_actions_policy_attach" {
  count  = var.enable_github_actions_iam ? 1 : 0
  name   = "mlops-github-actions-policy"
  role   = aws_iam_role.github_actions_role[0].id
  policy = data.aws_iam_policy_document.github_actions_policy[0].json
}
