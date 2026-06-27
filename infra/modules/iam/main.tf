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


# GITHUB ACTIONS OIDC
# Tạo OIDC Provider cho GitHub
resource "aws_iam_openid_connect_provider" "github_actions" {
  count           = var.enable_legacy_sagemaker_pipeline ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["1c58a3a8518e8759bf075b76b750d4f2df264fcd", "6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# Tạo IAM Role cho GitHub Actions
data "aws_iam_policy_document" "github_actions_assume_role" {
  count = var.enable_legacy_sagemaker_pipeline ? 1 : 0

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
  count              = var.enable_legacy_sagemaker_pipeline ? 1 : 0
  name               = "mlops-github-actions-role"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume_role[0].json
}

# Cấp quyền đọc Secret và S3 cho Role của GitHub Actions
data "aws_iam_policy_document" "github_actions_policy" {
  count = var.enable_legacy_sagemaker_pipeline ? 1 : 0

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
      aws_iam_role.sagemaker_execution_role[0].arn
    ]
  }
}

resource "aws_iam_role_policy" "github_actions_policy_attach" {
  count  = var.enable_legacy_sagemaker_pipeline ? 1 : 0
  name   = "mlops-github-actions-policy"
  role   = aws_iam_role.github_actions_role[0].id
  policy = data.aws_iam_policy_document.github_actions_policy[0].json
}

# AWS SAGEMAKER FOR TRAINING
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
  count              = var.enable_legacy_sagemaker_pipeline ? 1 : 0
  name               = "mlops-sagemaker-execution-role"
  assume_role_policy = data.aws_iam_policy_document.sagemaker_assume_role.json
}

# Gắn managed policy AmazonSageMakerFullAccess
resource "aws_iam_role_policy_attachment" "sagemaker_full_access" {
  count      = var.enable_legacy_sagemaker_pipeline ? 1 : 0
  role       = aws_iam_role.sagemaker_execution_role[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSageMakerFullAccess"
}

# Gắn policy đọc/ghi S3 (dùng lại policy của Worker)
resource "aws_iam_role_policy_attachment" "sagemaker_s3_attach" {
  count      = var.enable_legacy_sagemaker_pipeline ? 1 : 0
  role       = aws_iam_role.sagemaker_execution_role[0].name
  policy_arn = aws_iam_policy.worker_s3_policy.arn
}

# Gắn policy đọc Secrets Manager (dùng lại policy của Worker)
resource "aws_iam_role_policy_attachment" "sagemaker_secrets_attach" {
  count      = var.enable_legacy_sagemaker_pipeline ? 1 : 0
  role       = aws_iam_role.sagemaker_execution_role[0].name
  policy_arn = aws_iam_policy.worker_secrets_policy.arn
}
