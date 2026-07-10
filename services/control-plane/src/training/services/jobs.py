from training.argo_training_adapter import ArgoTrainingAdapter
from training.local_service import run_local_training_job
from training.serializers import create_training_job_event

def _submit_training_job(training_job, training_backend):
    if training_backend == "local":
        run_local_training_job(training_job)
    else:
        ArgoTrainingAdapter().start_training_job(training_job)
    create_training_job_event(training_job, "JOB_SUBMITTED", f"Training job submitted to backend: {training_backend}.")


