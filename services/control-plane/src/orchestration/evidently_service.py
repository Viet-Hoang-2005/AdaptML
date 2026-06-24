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
        
        env = {
            "JOB_ID": str(job.id),
            "TENANT_ID": getattr(job.tenant, "tenant_id", "T-LOCALDEV"),
            "MODEL_ID": job.model_api.name,
            "MODEL_URI": f"models:/{job.model_api.name}/Production",
            "REFERENCE_DATA_S3_URI": job.reference_data_s3_path,
            "DRIFT_THRESHOLD": str(job.trigger_threshold),
            "AWS_ACCESS_KEY_ID": aws_access_key,
            "AWS_SECRET_ACCESS_KEY": aws_secret_key,
            "AWS_DEFAULT_REGION": aws_region,
            "AWS_BUCKET_NAME": bucket_name,
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
        client.containers.run(
            image="mlops-paas-evidently",
            command=["python", "/app/detect_drift.py"],
            environment=env,
            network=network_name,
            detach=True,
            remove=True
        )

    except Exception as e:
        logger.error(f"Failed to run evidently job: {e}")

def run_evidently_job(job: DriftMonitoringJob):
    # Run in background
    thread = threading.Thread(target=run_evidently_job_async, args=(job.id,))
    thread.start()
