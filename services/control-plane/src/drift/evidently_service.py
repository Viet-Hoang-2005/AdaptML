import os
import docker
import logging
import threading
from django.conf import settings
from authentication.models import DriftMonitoringJob

logger = logging.getLogger(__name__)

def run_evidently_job_async(job_id: int):
    try:
        job = DriftMonitoringJob.objects.get(id=job_id)
        client = docker.from_env()
        
        db_host = os.environ.get("DB_HOST_RO", os.environ.get("DB_HOST_RW", "postgres"))
        db_user = os.environ.get("DB_USER", "postgres")
        db_password = os.environ.get("DB_PASSWORD", "postgres")
        db_name = os.environ.get("DB_NAME", "mlops_paas_db")
        db_port = os.environ.get("DB_PORT", "5432")
        
        aws_access_key = os.environ.get("AWS_ACCESS_KEY_ID", "")
        aws_secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
        aws_region = getattr(settings, "AWS_S3_REGION_NAME", "ap-southeast-1")
        bucket_name = getattr(settings, "AWS_STORAGE_BUCKET_NAME", "mlops-paas-artifacts")
        
        internal_base_url = getattr(settings, "CONTROL_PLANE_INTERNAL_URL", "http://control-plane:8000").rstrip("/")
        
        import boto3
        s3_client = boto3.client('s3', region_name=aws_region)
        
        ref_path = job.reference_data_s3_path
        ref_url = ""
        user_name = job.tenant.email.split('@')[0] if getattr(job.tenant, 'email', None) else job.tenant.tenant_id
        model_name = job.model_api.name.replace(' ', '') if job.model_api.name else 'UnnamedModel'
        version = job.model_api.version.replace(' ', '') if job.model_api.version else 'v1'
        s3_key = f"{user_name}/models/{model_name}/{version}/references/{ref_path}"
        try:
            ref_url = s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': bucket_name, 'Key': s3_key},
                ExpiresIn=3600
            )
        except Exception as e:
            logger.error(f"Could not generate presigned URL for {s3_key}: {e}")

        from datetime import datetime, timezone
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        reports_prefix = getattr(settings, 'DRIFT_REPORTS_S3_PREFIX', 'drift-reports')
        tenant_id_str = getattr(job.tenant, "tenant_id", "T-LOCALDEV")
        base_report_key = f"{reports_prefix}/{tenant_id_str}/{job.model_api.name}/{run_id}"

        html_upload_url = ""
        report_json_upload_url = ""
        summary_json_upload_url = ""

        try:
            html_upload_url = s3_client.generate_presigned_url(
                'put_object',
                Params={'Bucket': bucket_name, 'Key': f"{base_report_key}/report.html", 'ContentType': 'text/html'},
                ExpiresIn=3600
            )
            report_json_upload_url = s3_client.generate_presigned_url(
                'put_object',
                Params={'Bucket': bucket_name, 'Key': f"{base_report_key}/report.json", 'ContentType': 'application/json'},
                ExpiresIn=3600
            )
            summary_json_upload_url = s3_client.generate_presigned_url(
                'put_object',
                Params={'Bucket': bucket_name, 'Key': f"{base_report_key}/summary.json", 'ContentType': 'application/json'},
                ExpiresIn=3600
            )
        except Exception as e:
            logger.error(f"Could not generate presigned PUT URLs for reports: {e}")

        # Construct public URLs and URIs for webhook payload
        html_s3_uri = f"s3://{bucket_name}/{base_report_key}/report.html"
        report_json_s3_uri = f"s3://{bucket_name}/{base_report_key}/report.json"
        summary_json_s3_uri = f"s3://{bucket_name}/{base_report_key}/summary.json"
        
        domain = f"s3.{aws_region}.amazonaws.com" if aws_region != "us-east-1" else "s3.amazonaws.com"
        html_public_url = f"https://{bucket_name}.{domain}/{base_report_key}/report.html"

        env = {
            "JOB_ID": str(job.id),
            "TENANT_ID": tenant_id_str,
            "MODEL_ID": job.model_api.name,
            "MODEL_URI": f"models:/{job.model_api.name}/Production",
            "REFERENCE_DATA_URL": ref_url,
            "DRIFT_THRESHOLD": str(job.trigger_threshold),
            
            # Webhook Artifact URIs
            "HTML_S3_URI": html_s3_uri,
            "REPORT_JSON_S3_URI": report_json_s3_uri,
            "SUMMARY_JSON_S3_URI": summary_json_s3_uri,
            "HTML_PUBLIC_URL": html_public_url,
            
            # Presigned PUT URLs for Uploading
            "HTML_UPLOAD_URL": html_upload_url,
            "REPORT_JSON_UPLOAD_URL": report_json_upload_url,
            "SUMMARY_JSON_UPLOAD_URL": summary_json_upload_url,
            
            "DB_HOST_RO": db_host,
            "DB_HOST": db_host,
            "DB_USER": db_user,
            "DB_PASSWORD": db_password,
            "DB_NAME": db_name,
            "DB_PORT": db_port,
            "MLFLOW_TRACKING_URI": os.environ.get("MLFLOW_TRACKING_URI", "http://mlflow:5000"),
            "WEBHOOK_URL": f"{internal_base_url}/api/internal/drift-webhook",
            "WEBHOOK_SECRET": getattr(settings, "WEBHOOK_SECRET", "super-secret-key"),
            "DRIFT_REPORTS_S3_PREFIX": "drift-reports"
        }

        network_name = getattr(settings, "DOCKER_NETWORK_NAME", "mlops_paas_network")
        
        logger.info(f"Spawning mlops-paas-evidently container for job {job.id}")
        
        # We reuse the mlops-paas-evidently image built by docker-compose
        # which already contains detect_drift.py and all dependencies.
        logs = client.containers.run(
            image="mlops-paas-evidently",
            command=["python", "/app/detect_drift.py"],
            environment=env,
            network=network_name,
            detach=False,
            remove=True
        )
        logger.info(f"Evidently job finished. Logs:\n{logs.decode('utf-8')}")

    except Exception as e:
        logger.error(f"Failed to run evidently job: {e}")

def run_evidently_job(job: DriftMonitoringJob):
    # Run in background
    thread = threading.Thread(target=run_evidently_job_async, args=(job.id,))
    thread.start()
