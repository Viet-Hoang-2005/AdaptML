# S3 BUCKET
resource "aws_s3_bucket" "artifacts_bucket" {
  bucket        = var.bucket_name
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
