import base64
import json
import zipfile

MAX_MODEL_ARTIFACT_SIZE_BYTES = 512 * 1024 * 1024
MAX_METADATA_FILE_SIZE_BYTES = 2 * 1024 * 1024
MAX_MODEL_INSIGHT_ITEMS = 500
SUPPORTED_BUILD_FLAVORS = {"sklearn", "scikit-learn", "xgboost", "pytorch", "keras"}
SUPPORTED_SOURCE_EXTENSIONS = {".pkl", ".joblib", ".xgb", ".json", ".pth", ".pt", ".bin", ".keras", ".h5", ".hdf5"}

def _read_json_upload(file_obj, label, warnings):
    if not file_obj:
        return None
    if getattr(file_obj, "size", 0) and file_obj.size > MAX_METADATA_FILE_SIZE_BYTES:
        warnings.append(f"{label} ignored: file must be 2MB or smaller.")
        return None
    try:
        file_obj.seek(0)
        raw = file_obj.read()
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        data = json.loads(raw)
    except Exception as exc:
        warnings.append(f"{label} ignored: invalid JSON ({exc}).")
        return None
    finally:
        try:
            file_obj.seek(0)
        except Exception:
            pass
    return data


def _json_safe(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        return [_json_safe(item) for item in value[:MAX_MODEL_INSIGHT_ITEMS]]
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    return str(value)


def _normalize_summary_map(data, nested_key, label, warnings):
    if data is None:
        return {}
    if not isinstance(data, dict):
        warnings.append(f"{label} ignored: expected a JSON object.")
        return {}
    candidate = data.get(nested_key) if isinstance(data.get(nested_key), dict) else data
    return {str(key): _json_safe(value) for key, value in candidate.items()}


def _normalize_manual_metrics_file(data, warnings):
    """Split common uploaded training reports into metric and param summaries."""
    if data is None:
        return {}, {}
    if not isinstance(data, dict):
        warnings.append("metrics_file ignored: expected a JSON object.")
        return {}, {}

    metrics_candidate = data.get("evaluation_metrics")
    if not isinstance(metrics_candidate, dict):
        metrics_candidate = data.get("metrics") if isinstance(data.get("metrics"), dict) else data

    metrics_summary = {}
    for key, value in metrics_candidate.items():
        # Nested objects are useful metadata, but they should not appear as metric
        # cards or dominate metric compare/recommendation logic.
        if isinstance(value, dict):
            continue
        metrics_summary[str(key)] = _json_safe(value)

    derived_params = {}
    hyperparams = data.get("best_hyperparameters")
    if isinstance(hyperparams, dict):
        derived_params.update({str(key): _json_safe(value) for key, value in hyperparams.items()})

    for key in ("model_version", "timestamp", "num_classes", "objective"):
        if key in data:
            derived_params[key] = _json_safe(data.get(key))

    return metrics_summary, derived_params


def _numeric_value(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _normalize_model_insights(data, *, kind_hint="feature_importance", source="manual_upload_file", warnings=None):
    warnings = warnings if warnings is not None else []
    if data is None:
        return {}
    if not isinstance(data, dict):
        warnings.append("model insights ignored: expected a JSON object.")
        return {}

    kind = data.get("kind") or kind_hint
    raw_items = data.get("items")
    if raw_items is None and isinstance(data.get("feature_importance"), dict):
        raw_items = [{"name": key, "value": value} for key, value in data["feature_importance"].items()]
        kind = "feature_importance"
    if raw_items is None and isinstance(data.get("coefficients"), dict):
        raw_items = [{"name": key, "value": value} for key, value in data["coefficients"].items()]
        kind = "coefficients"
    if raw_items is None and all(_numeric_value(value) is not None for value in data.values()):
        raw_items = [{"name": key, "value": value} for key, value in data.items()]

    if not isinstance(raw_items, list):
        warnings.append("model insights ignored: expected items array or feature_importance object.")
        return {}

    items = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        name = raw_item.get("name") or raw_item.get("feature")
        value = _numeric_value(raw_item.get("value"))
        if not name or value is None:
            continue
        abs_value = _numeric_value(raw_item.get("abs_value"))
        item = {
            "name": str(name),
            "value": value,
            "abs_value": abs_value if abs_value is not None else abs(value),
        }
        if raw_item.get("class_name") is not None:
            item["class_name"] = str(raw_item.get("class_name"))
        items.append(item)

    items.sort(key=lambda item: item["abs_value"], reverse=True)
    items = items[:MAX_MODEL_INSIGHT_ITEMS]
    for index, item in enumerate(items, start=1):
        item["rank"] = index

    if not items:
        warnings.append("model insights ignored: no valid numeric insight items found.")
        return {}

    return {
        "schema_version": "model-insights-v1",
        "kind": str(kind or kind_hint),
        "source": source,
        "feature_count": int(data.get("feature_count") or len(items)),
        "items": items,
    }


def parse_manual_upload_metadata(request):
    warnings = []
    metrics_payload = _read_json_upload(request.FILES.get("metrics_file"), "metrics_file", warnings)
    metrics_summary, params_from_metrics = _normalize_manual_metrics_file(metrics_payload, warnings)

    params_payload = _read_json_upload(request.FILES.get("params_file"), "params_file", warnings)
    explicit_params = _normalize_summary_map(params_payload, "params", "params_file", warnings)
    params_summary = explicit_params if explicit_params else params_from_metrics

    insights_file = request.FILES.get("model_insights_file")
    insight_kind = "feature_importance"
    if not insights_file:
        insights_file = request.FILES.get("feature_importance_file")
        insight_kind = "feature_importance"
    insights_summary = _normalize_model_insights(
        _read_json_upload(insights_file, "model_insights_file", warnings) if insights_file else None,
        kind_hint=insight_kind,
        source="manual_upload_file",
        warnings=warnings,
    )

    return {
        "metrics_summary": metrics_summary,
        "params_summary": params_summary,
        "model_insights_summary": insights_summary,
        "warnings": warnings,
    }


def _apply_manual_metadata_to_model_api(model_api, metadata):
    model_api.metrics_summary = metadata.get("metrics_summary") or {}
    model_api.params_summary = metadata.get("params_summary") or {}
    model_api.model_insights_summary = metadata.get("model_insights_summary") or {}


def validate_model_artifact(artifact_file):
    if artifact_file.size > MAX_MODEL_ARTIFACT_SIZE_BYTES:
        return "Model artifact must be 512MB or smaller."

    if not artifact_file.name.lower().endswith(".zip"):
        return "Model artifact must be a .zip package containing an MLmodel file."

    try:
        with zipfile.ZipFile(artifact_file) as archive:
            has_mlmodel = any(
                name.rstrip("/").endswith("MLmodel")
                for name in archive.namelist()
                if not name.endswith("/")
            )
    except zipfile.BadZipFile:
        return "Model artifact is not a valid zip file."
    finally:
        artifact_file.seek(0)

    if not has_mlmodel:
        return "Model artifact must contain an MLmodel file."

    return ""


def validate_source_artifact(artifact_file, flavor):
    if artifact_file.size > MAX_MODEL_ARTIFACT_SIZE_BYTES:
        return "Model artifact must be 512MB or smaller."

    filename = artifact_file.name.lower()
    if not any(filename.endswith(extension) for extension in SUPPORTED_SOURCE_EXTENSIONS):
        return f"Raw model artifact extension is not supported for flavor '{flavor}'."

    if flavor in {"sklearn", "scikit-learn"} and not filename.endswith((".pkl", ".joblib")):
        return "Scikit-learn flavor requires a .pkl or .joblib artifact."

    if flavor == "xgboost" and not filename.endswith((".pkl", ".joblib", ".xgb", ".json")):
        return "XGBoost flavor requires a .xgb, .pkl, .joblib, or .json artifact."

    if flavor == "pytorch" and not filename.endswith((".pth", ".pt", ".pkl", ".bin")):
        return "PyTorch flavor requires a .pth, .pt, .pkl, or .bin artifact."

    if flavor == "keras" and not filename.endswith((".keras", ".h5", ".hdf5", ".pkl")):
        return "Keras flavor requires a .keras, .h5, or .hdf5 artifact."

    return ""


def decode_header_json(encoded_value, fallback):
    if not encoded_value:
        return fallback

    try:
        raw = base64.urlsafe_b64decode(encoded_value.encode("ascii"))
        return json.loads(raw.decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return fallback


def combine_requirements_text(request):
    text = (request.data.get("requirements_text") or "").strip()
    requirements_file = request.FILES.get("requirements_file")

    if not requirements_file:
        return text

    try:
        file_text = requirements_file.read().decode("utf-8").strip()
    except UnicodeDecodeError:
        raise ValueError("requirements.txt must be UTF-8 text.")
    finally:
        requirements_file.seek(0)

    if text and file_text:
        return f"{text}\n{file_text}"
    return text or file_text


def _auto_detect_flavor(model_api):
    """Infer build flavor from training job artifact_manifest when not explicitly set."""
    job = model_api.source_training_job
    if not job:
        return None
    manifest = job.artifact_manifest or []
    paths = [str(m.get("path", "") if isinstance(m, dict) else m).lower() for m in manifest]
    if any(p.endswith(".pkl") or p.endswith(".joblib") for p in paths):
        return "sklearn"
    if any(p.endswith(".xgb") or p.endswith(".bst") or p.endswith(".json") and "xgboost" in p for p in paths):
        return "xgboost"
    # Fallback: check training_summary for flavor hint
    summary = job.training_summary or {}
    flavor_hint = str(summary.get("flavor", "")).lower()
    if flavor_hint in SUPPORTED_BUILD_FLAVORS:
        return flavor_hint
    return None


