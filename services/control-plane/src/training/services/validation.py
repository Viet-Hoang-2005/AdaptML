from pathlib import Path
import zipfile

from django.conf import settings
from rest_framework.exceptions import ValidationError

from authentication.models import ModelAPI, TrainingJob
from integrations.hashid_utils import decode_model_id, encode_model_id
from integrations.s3_zip_utils import get_s3_file_list

MAX_TRAINING_FILE_SIZE_BYTES = 512 * 1024 * 1024
RUNTIME_PROFILES = {
    (1, 2048): "small",
    (2, 4096): "medium",
    (4, 8192): "large",
}
ACCELERATOR_TYPES = {"none", "gpu", "tpu", "trainium"}
GPU_ACCELERATOR_COUNTS = {1, 2, 4}
ACTIVE_STATUSES = {"pending", "uploading", "running"}

def _validate_upload_size(upload, label):
    if upload.size > MAX_TRAINING_FILE_SIZE_BYTES:
        raise ValidationError({"error": f"{label} must be 512MB or smaller."})


def _parse_positive_int(value, field_name, default):
    raw_value = value if value not in {None, ""} else default
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        raise ValidationError({"error": f"{field_name} must be a positive integer."})
    if parsed <= 0:
        raise ValidationError({"error": f"{field_name} must be a positive integer."})
    return parsed


def _parse_non_negative_int(value, field_name, default):
    raw_value = value if value not in {None, ""} else default
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        raise ValidationError({"error": f"{field_name} must be a non-negative integer."})
    if parsed < 0:
        raise ValidationError({"error": f"{field_name} must be a non-negative integer."})
    return parsed


def _validate_accelerator_config(accelerator_type, accelerator_count, training_backend):
    if accelerator_type not in ACCELERATOR_TYPES:
        raise ValidationError({"error": "accelerator_type must be one of: none, gpu, tpu, trainium."})
    if accelerator_type == "none":
        if accelerator_count != 0:
            raise ValidationError({"error": "accelerator_count must be 0 when accelerator_type is none."})
        return
    if accelerator_type in {"tpu", "trainium"}:
        raise ValidationError({"error": f"{accelerator_type.upper()} training is not supported yet."})
    if accelerator_type == "gpu":
        if accelerator_count not in GPU_ACCELERATOR_COUNTS:
            raise ValidationError({"error": "GPU accelerator_count must be one of: 1, 2, 4."})


def _validate_source_zip_entry_point(source_zip, entry_point):
    if source_zip.name.lower().endswith('.py'):
        if Path(entry_point).name != Path(source_zip.name).name:
            raise ValidationError({"error": f"Entry point must match uploaded python file name '{source_zip.name}'."})
        return

    try:
        source_zip.seek(0)
        with zipfile.ZipFile(source_zip) as archive:
            file_names = [item.filename.replace("\\", "/").lstrip("./").lstrip("/") for item in archive.infolist()]
    except zipfile.BadZipFile:
        raise ValidationError({"error": "source_zip is not a valid zip archive."})
    finally:
        try:
            source_zip.seek(0)
        except Exception:
            pass

    if not file_names:
        raise ValidationError({"error": "source_zip is empty."})

    has_template_bundle = "source.zip" in file_names and not any(Path(name).name == "train.py" for name in file_names)
    if has_template_bundle:
        raise ValidationError(
            {
                "error": (
                    "You uploaded the template bundle. Extract it and upload the inner source.zip, "
                    "or use the included train.csv/requirements.txt separately."
                )
            }
        )

    normalized_entry_point = entry_point.replace("\\", "/").lstrip("./").lstrip("/")
    if normalized_entry_point not in file_names:
        matching_names = [name for name in file_names if Path(name).name == Path(normalized_entry_point).name]
        suggestion = f" Did you mean '{matching_names[0]}'?" if len(matching_names) == 1 else ""
        raise ValidationError(
            {
                "error": (
                    f"Source zip must contain the configured entry point '{normalized_entry_point}'."
                    f"{suggestion}"
                )
            }
        )


def _ensure_active_job_capacity(user):
    active_count = TrainingJob.objects.filter(
        tenant=user,
        deleted_at__isnull=True,
        status__in=ACTIVE_STATUSES,
    ).count()
    if active_count >= settings.TRAINING_MAX_ACTIVE_JOBS_PER_TENANT:
        raise ValidationError(
            {
                "error": (
                    "You already have an active training job. Please wait for it to finish or cancel it first."
                )
            }
        )


def validate_create_training_job_request(request):
    name = (request.data.get("name") or "").strip()
    model_version = (request.data.get("model_version") or "").strip()
    entry_point = (request.data.get("entry_point") or "train.py").strip()
    max_runtime_seconds = _parse_positive_int(request.data.get("max_runtime_seconds"), "max_runtime_seconds", 3600)
    vcpu = _parse_positive_int(request.data.get("vcpu"), "vcpu", 2)
    memory = _parse_positive_int(request.data.get("memory"), "memory", 4096)
    accelerator_type = (request.data.get("accelerator_type") or "none").strip().lower()
    accelerator_count = _parse_non_negative_int(request.data.get("accelerator_count"), "accelerator_count", 0)
    registered_model_id = request.data.get("registered_model_id")

    if not registered_model_id:
        raise ValidationError({"error": "registered_model_id is required. You must select a model to train."})

    model_id_int = decode_model_id(registered_model_id)
    if not model_id_int:
        raise ValidationError({"error": "Invalid registered_model_id."})
        
    base_model = ModelAPI.objects.filter(id=model_id_int, tenant=request.user).first()
    if not base_model:
        raise ValidationError({"error": "Registered model not found."})

    if not name:
        raise ValidationError({"error": "Training job name is required."})
    if not model_version:
        raise ValidationError({"error": "Model version is required."})
    if not entry_point:
        raise ValidationError({"error": "Entry point is required."})
    if max_runtime_seconds > settings.TRAINING_MAX_RUNTIME_SECONDS:
        raise ValidationError({"error": "Max runtime cannot exceed 12 hours per training job."})
    if (vcpu, memory) not in RUNTIME_PROFILES:
        raise ValidationError(
            {
                "error": (
                    "Invalid runtime profile. Supported profiles are: "
                    "small=1 vCPU/2048MB, medium=2 vCPU/4096MB, large=4 vCPU/8192MB."
                )
            }
        )
    training_backend = settings.TRAINING_BACKEND
    _validate_accelerator_config(accelerator_type, accelerator_count, training_backend)

    entry_point_path = Path(entry_point)
    if entry_point_path.is_absolute() or ".." in entry_point_path.parts:
        raise ValidationError({"error": "entry_point must be a relative path inside source_zip."})

    s3_code_prefix = None
    if base_model:
        if base_model.source_code_file:
            # Legacy path: source code stored as Django FileField (zip/py)
            _validate_source_zip_entry_point(base_model.source_code_file.file, entry_point)
        else:
            # New path: source code stored in S3 via SourceEditor
            safe_version = base_model.version.replace(' ', '') if base_model.version else 'v1'
            s3_code_prefix = f'users/{base_model.tenant.tenant_id}/models/{encode_model_id(base_model.id)}/{safe_version}/code/'
            s3_files = get_s3_file_list(s3_code_prefix)
            # Filter out .keep placeholder files
            real_files = [f for f in s3_files if not f['relative_path'].endswith('.keep')]
            if not real_files:
                raise ValidationError(
                    {"error": "Base model does not have source code. Upload source files in Step 1 (Sources) before starting training."}
                )
            # Verify entry_point exists in S3 files
            s3_paths = [f['relative_path'] for f in real_files]
            if entry_point not in s3_paths:
                raise ValidationError(
                    {
                        "error": (
                            f"Entry point '{entry_point}' not found in uploaded source code. "
                            f"Available files: {', '.join(s3_paths[:5])}."
                        )
                    }
                )
        if not base_model.reference_data_file:
            user_name = (
                base_model.tenant.email.split('@')[0]
                if getattr(base_model.tenant, 'email', None)
                else base_model.tenant.tenant_id
            )
            safe_model_name = base_model.name.replace(' ', '') if base_model.name else 'UnnamedModel'
            safe_version = base_model.version.replace(' ', '') if base_model.version else 'v1'
            s3_reference_prefix = f'users/{base_model.tenant.tenant_id}/models/{encode_model_id(base_model.id)}/{safe_version}/references/'
            s3_ref_files = get_s3_file_list(s3_reference_prefix)
            csv_files = [f for f in s3_ref_files if f['relative_path'].lower().endswith('.csv')]
            if not csv_files:
                raise ValidationError(
                    {"error": "Base model does not have reference data. Upload a .csv file in Step 1 (Sources) before starting training."}
                )

    return {
        "name": name,
        "model_version": model_version,
        "entry_point": entry_point,
        "vcpu": vcpu,
        "memory": memory,
        "max_runtime_seconds": max_runtime_seconds,
        "accelerator_type": accelerator_type,
        "accelerator_count": accelerator_count,
        "base_model": base_model,
        "s3_code_prefix": s3_code_prefix,
        "s3_reference_prefix": s3_reference_prefix,
    }


