import os
import json
import urllib.request

def lambda_handler(event, context):
    # Nạp biến môi trường cấu hình GitHub từ Lambda
    github_repo = os.environ.get("GITHUB_REPO")
    github_token = os.environ.get("GITHUB_TOKEN")

    if not github_repo or not github_token:
        print("Missing GITHUB_REPO or GITHUB_TOKEN environment variables")
        return {"statusCode": 500, "body": "Configuration error"}

    # Trích xuất thông tin từ S3 event
    try:
        bucket_name = event['Records'][0]['s3']['bucket']['name']
        object_key = event['Records'][0]['s3']['object']['key']
        print(f"Triggered by S3 object: s3://{bucket_name}/{object_key}")
    except Exception as e:
        print(f"Could not parse S3 event: {e}")
        object_key = "unknown"

    url = f"https://api.github.com/repos/{github_repo}/dispatches"

    # Headers yêu cầu xác thực GitHub API
    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "AWS-Lambda-S3-Trigger"
    }
    
    # Payload báo cho GitHub Actions biết là data_manifest.json đã cập nhật
    payload = {
        "event_type": "data_manifest_updated",
        "client_payload": {
            "trigger_source": "s3_lambda",
            "file_updated": object_key
        }
    }

    req = urllib.request.Request(
        url, 
        data=json.dumps(payload).encode('utf-8'), 
        headers=headers, 
        method='POST'
    )

    try:
        with urllib.request.urlopen(req) as response:
            print(f"GitHub API Response: {response.status}")
            return {
                "statusCode": 200,
                "body": json.dumps("Webhook sent successfully!")
            }
    except urllib.error.URLError as e:
        print(f"Error calling GitHub API: {e}")
        return {
            "statusCode": 500,
            "body": json.dumps(f"Failed to send webhook: {e}")
        }
