from integrations.hashid_utils import encode_model_id
from authentication.models import TrainingJob
from registry.views import serialize_model_api

def create_training_job_event(training_job, event_type, message, metadata=None):
    training_job.events.create(event_type=event_type, message=message, metadata=metadata or {})


def serialize_training_job_event(event):
    return {
        "id": event.id,
        "training_job": event.training_job_id,
        "event_type": event.event_type,
        "message": event.message,
        "metadata": event.metadata,
        "created_at": event.created_at,
    }


def serialize_training_job(training_job: TrainingJob):
    registered_model = (
        training_job.registered_model_apis.exclude(status="disabled")
        .order_by("-updated_at")
        .first()
    )
    return {
        "id": training_job.id,
        "name": training_job.name,
        "model_version": training_job.model_version,
        "entry_point": training_job.entry_point,
        "requirements_text": training_job.requirements_text,
        "training_backend": training_job.training_backend,
        "vcpu": training_job.vcpu,
        "memory": training_job.memory,
        "max_runtime_seconds": training_job.max_runtime_seconds,
        "accelerator_type": training_job.accelerator_type,
        "accelerator_count": training_job.accelerator_count,
        "retry_of": training_job.retry_of_id,
        "source_zip": "",
        "requirements_file": "",
        "training_data": "",
        "s3_source_uri": training_job.s3_source_uri,
        "s3_training_data_uri": training_job.s3_training_data_uri,
        "sagemaker_job_name": training_job.sagemaker_job_name,
        "external_job_id": training_job.external_job_id,
        "output_s3_uri": training_job.output_s3_uri,
        "model_artifact_uri": training_job.model_artifact_uri,
        "status": training_job.status,
        "error_message": training_job.error_message,
        "training_logs": training_job.training_logs,
        "started_at": training_job.started_at,
        "completed_at": training_job.completed_at,
        "runtime_seconds": training_job.runtime_seconds,
        "stop_reason": training_job.stop_reason,
        "deleted_at": training_job.deleted_at,
        "is_deleted": bool(training_job.deleted_at),
        "registered_model": serialize_model_api(registered_model) if registered_model else None,
        "registered_model_id": encode_model_id(registered_model.id) if registered_model else None,
        "tracking_status": training_job.tracking_status,
        "tracking_error": training_job.tracking_error,
        "tracking_ingested_at": training_job.tracking_ingested_at,
        "training_summary": training_job.training_summary,
        "metrics_summary": training_job.metrics_summary,
        "params_summary": training_job.params_summary,
        "model_insights_summary": training_job.model_insights_summary,
        "artifact_manifest": training_job.artifact_manifest,
        "deployability_status": training_job.deployability_status,
        "deployability_reason": training_job.deployability_reason,
        "mlflow_run_id": training_job.mlflow_run_id or "",
        "mlflow_experiment_id": training_job.mlflow_experiment_id or "",
        "mlflow_artifact_uri": training_job.mlflow_artifact_uri or "",
        "created_at": training_job.created_at,
        "updated_at": training_job.updated_at,
    }


