import os
import boto3
import docker
import logging
import threading

from datetime import datetime, timezone
from django.conf import settings
from authentication.models import DriftMonitoringJob
from integrations.hashid_utils import encode_model_id

logger = logging.getLogger(__name__)

def run_evidently_job_sync(job_id: int):
    try:
        job = DriftMonitoringJob.objects.get(id=job_id)
        
        db_host = os.environ.get("DB_HOST_RO", "postgres")
        db_user = os.environ.get("DB_USER", "postgres")
        db_password = os.environ.get("DB_PASSWORD", "postgres")
        db_name = os.environ.get("DB_NAME", "mlops_paas_db")
        db_port = os.environ.get("DB_PORT", "5432")
        
        aws_region = getattr(settings, "AWS_S3_REGION_NAME", "ap-southeast-1")
        bucket_name = getattr(settings, "AWS_STORAGE_BUCKET_NAME", "mlops-paas-artifacts")
        
        internal_base_url = getattr(settings, "CONTROL_PLANE_INTERNAL_URL", "http://control-plane:8000").rstrip("/")
        
        s3_client = boto3.client('s3', region_name=aws_region)
        
        ref_path = job.reference_data_s3_path
        ref_url = ""
        tenant_id = job.tenant.tenant_id
        model_hash_id = encode_model_id(job.model_api.id) if job.model_api else "temp-id"
        version = job.model_api.version.replace(' ', '') if job.model_api and job.model_api.version else 'v1'
        
        s3_key = f"users/{tenant_id}/models/{model_hash_id}/{version}/references/{ref_path}"
        try:
            ref_url = s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': bucket_name, 'Key': s3_key},
                ExpiresIn=3600
            )
        except Exception as e:
            logger.error(f"Could not generate presigned URL for {s3_key}: {e}")

        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        base_report_key = f"users/{tenant_id}/models/{model_hash_id}/{version}/drift/{job.id}/{run_id}"

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

        def get_signed_model_url(api):
            s3_key = None
            uri = api.model_uri or api.source_artifact_uri or ""
            if uri.startswith("s3://"):
                s3_key = uri.split("/", 3)[-1]
            elif api.artifact:
                s3_key = api.artifact.name
            elif api.source_artifact:
                s3_key = api.source_artifact.name

            if s3_key:
                try:
                    return s3_client.generate_presigned_url('get_object', Params={'Bucket': bucket_name, 'Key': s3_key}, ExpiresIn=3600)
                except Exception as e:
                    logger.error(f"Failed to generate presigned model URL: {e}")
            return f"models:/{api.name}/Production"

        model_uri_resolved = get_signed_model_url(job.model_api)

        env = {
            "JOB_ID": str(job.id),
            "TENANT_ID": tenant_id,
            "MODEL_ID": str(job.model_api.id),  # integer DB ID matching paas_production_logs
            "MODEL_NAME": job.model_api.name,   # human-readable name for MLflow
            "MODEL_URI": model_uri_resolved,
            "REFERENCE_DATA_URL": ref_url,
            "DRIFT_THRESHOLD": "0.6", # Hardcoded float share, DO NOT use job.trigger_threshold here
            
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
            "DB_USER": db_user,
            "DB_PASSWORD": db_password,
            "DB_NAME": db_name,
            "DB_PORT": db_port,
            "CONTROL_PLANE_WEBHOOK_URL": f"{internal_base_url}/api/drift/internal/drift-webhook",
            "CONTROL_PLANE_WEBHOOK_SECRET": getattr(settings, "CONTROL_PLANE_WEBHOOK_SECRET", "super-secret-key"),
            "DRIFT_REPORTS_S3_PREFIX": "drift-reports"
        }

        strategy = os.environ.get("BUILD_STRATEGY", "docker").lower()
        if strategy == "argo":
            import requests
            webhook_url = os.environ.get("ARGO_DRIFT_WEBHOOK_URL", "http://webhook-eventsource-eventsource-svc.default.svc.cluster.local:12000/drift")
            payload = {
                "job_id": str(job.id),
                "tenant_id": tenant_id,
                "model_id": str(job.model_api.id),
                "model_name": job.model_api.name,
                "model_uri": model_uri_resolved,
                "reference_data_url": ref_url,
                "html_s3_uri": html_s3_uri,
                "report_json_s3_uri": report_json_s3_uri,
                "summary_json_s3_uri": summary_json_s3_uri,
                "html_public_url": html_public_url,
                "html_upload_url": html_upload_url,
                "report_json_upload_url": report_json_upload_url,
                "summary_json_upload_url": summary_json_upload_url,
                "control_plane_webhook_url": f"{internal_base_url}/api/drift/internal/drift-webhook"
            }
            logger.info(f"Triggering Argo Drift Workflow for job {job.id}")
            response = requests.post(webhook_url, json=payload, timeout=10)
            response.raise_for_status()
            return "Argo Workflow triggered successfully."
        else:
            client = docker.from_env()
            network_name = getattr(settings, "DOCKER_NETWORK_NAME", "mlops_paas_network")
            
            model_hashid = encode_model_id(job.model_api.id)
            container_name = f"evidently_{tenant_id.lower()}_model_{model_hashid.lower()}"
            
            logger.info(f"Spawning container {container_name} for job {job.id}")
            
            try:
                old_container = client.containers.get(container_name)
                old_container.remove(force=True)
            except docker.errors.NotFound:
                pass

            container = client.containers.run(
                image="mlops-paas-evidently",
                name=container_name,
                command=["python", "/app/detect_drift.py"],
                environment=env,
                network=network_name,
                detach=True
            )
            
            result = container.wait()
            log_str = container.logs().decode('utf-8')
            container.remove()
            
            if result['StatusCode'] != 0:
                logger.error(f"Evidently job container failed. Output: {log_str}")
                raise Exception(f"Container error: {log_str}")
                
            logger.info(f"Evidently job finished. Logs:\n{log_str}")
            
            if "Skipping drift analysis" in log_str:
                raise Exception("Not enough production data to run drift analysis. Please send more requests to the model first.")
                
            return log_str

    except Exception as e:
        logger.error(f"Failed to run evidently job: {e}")
        raise Exception(f"Job execution failed: {str(e)}")

def run_evidently_job(job: DriftMonitoringJob):
    # Run in background (for automated webhook triggers)
    def bg_task():
        try:
            run_evidently_job_sync(job.id)
        except Exception as e:
            logger.error(f"Background Evidently job failed: {e}")
            
    thread = threading.Thread(target=bg_task)
    thread.start()
