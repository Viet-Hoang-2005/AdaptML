# Nén code Lambda thành file zip
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_file = "${path.root}/lambda/s3_webhook_trigger.py"
  output_path = "${path.root}/lambda/s3_webhook_trigger.zip"
}

# Lambda Function
resource "aws_lambda_function" "github_webhook_lambda" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = "mlops-trigger-github-webhook"
  role             = var.lambda_exec_role_arn
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
  source_arn    = var.artifacts_bucket_arn
}

# S3 Event Notification
resource "aws_s3_bucket_notification" "bucket_notification" {
  bucket = var.artifacts_bucket_id

  lambda_function {
    lambda_function_arn = aws_lambda_function.github_webhook_lambda.arn
    events              = ["s3:ObjectCreated:*"]
    filter_suffix       = "data_manifest.json"
  }

  depends_on = [aws_lambda_permission.allow_s3_invocation]
}
