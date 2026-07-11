def model_root(tenant_id: str, model_hash_id: str) -> str:
    return f"users/{tenant_id}/models/{model_hash_id}"


def model_code_prefix(tenant_id: str, model_hash_id: str) -> str:
    return f"{model_root(tenant_id, model_hash_id)}/code/"


def model_data_prefix(tenant_id: str, model_hash_id: str) -> str:
    return f"{model_root(tenant_id, model_hash_id)}/data/"


def training_job_prefix(tenant_id: str, model_hash_id: str, job_id: int) -> str:
    return f"{model_root(tenant_id, model_hash_id)}/training/jobs/{job_id}"


def training_job_code_key(tenant_id: str, model_hash_id: str, job_id: int) -> str:
    return f"{training_job_prefix(tenant_id, model_hash_id, job_id)}/input/code/source.zip"


def training_job_data_key(tenant_id: str, model_hash_id: str, job_id: int) -> str:
    return f"{training_job_prefix(tenant_id, model_hash_id, job_id)}/input/data/train.csv"


def training_job_output_prefix(tenant_id: str, model_hash_id: str, job_id: int) -> str:
    return f"{training_job_prefix(tenant_id, model_hash_id, job_id)}/output"


def training_job_mlflow_prefix(tenant_id: str, model_hash_id: str, job_id: int) -> str:
    return f"{training_job_prefix(tenant_id, model_hash_id, job_id)}/mlflow"
