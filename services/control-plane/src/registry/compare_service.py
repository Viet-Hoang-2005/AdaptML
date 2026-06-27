HIGHER_IS_BETTER = {
    "accuracy",
    "f1",
    "f1_score",
    "precision",
    "recall",
    "auc",
    "roc_auc",
}

LOWER_IS_BETTER = {
    "loss",
    "error",
    "error_rate",
    "rmse",
    "mae",
    "mse",
}

PRIMARY_METRICS = ["f1_score", "f1", "accuracy", "roc_auc", "auc", "loss"]


def _safe_value(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _metric_direction(name):
    normalized = name.lower()
    if normalized in HIGHER_IS_BETTER:
        return True
    if normalized in LOWER_IS_BETTER:
        return False
    return None


def compare_metrics(left_metrics, right_metrics):
    left_metrics = left_metrics if isinstance(left_metrics, dict) else {}
    right_metrics = right_metrics if isinstance(right_metrics, dict) else {}
    rows = []
    for name in sorted(set(left_metrics) | set(right_metrics)):
        left = left_metrics.get(name)
        right = right_metrics.get(name)
        higher_is_better = _metric_direction(name)
        delta = None
        delta_percent = None
        winner = "unknown"

        if _is_number(left) and _is_number(right):
            delta = right - left
            if left != 0:
                delta_percent = (delta / abs(left)) * 100
            if higher_is_better is True:
                winner = "right" if delta > 0 else "left" if delta < 0 else "tie"
            elif higher_is_better is False:
                winner = "right" if delta < 0 else "left" if delta > 0 else "tie"
        elif left == right:
            winner = "tie"

        rows.append(
            {
                "name": name,
                "left": _safe_value(left),
                "right": _safe_value(right),
                "delta": delta,
                "delta_percent": delta_percent,
                "higher_is_better": higher_is_better,
                "winner": winner,
            }
        )
    return rows


def compare_params(left_params, right_params):
    left_params = left_params if isinstance(left_params, dict) else {}
    right_params = right_params if isinstance(right_params, dict) else {}
    return [
        {
            "name": name,
            "left": _safe_value(left_params.get(name)),
            "right": _safe_value(right_params.get(name)),
            "changed": left_params.get(name) != right_params.get(name),
            "only_in": "left" if name not in right_params else "right" if name not in left_params else "",
        }
        for name in sorted(set(left_params) | set(right_params))
    ]


def _manifest_by_path(manifest):
    result = {}
    if not isinstance(manifest, list):
        return result
    for item in manifest:
        if isinstance(item, dict) and item.get("path"):
            result[item["path"]] = item
    return result


def compare_artifacts(left_manifest, right_manifest):
    left = _manifest_by_path(left_manifest)
    right = _manifest_by_path(right_manifest)
    added = []
    removed = []
    changed = []
    unchanged_count = 0

    for path in sorted(set(left) | set(right)):
        left_item = left.get(path)
        right_item = right.get(path)
        if left_item is None and right_item is not None:
            added.append(right_item)
        elif right_item is None and left_item is not None:
            removed.append(left_item)
        elif left_item and right_item:
            if left_item.get("sha256") and left_item.get("sha256") == right_item.get("sha256"):
                unchanged_count += 1
            elif left_item == right_item:
                unchanged_count += 1
            else:
                changed.append(
                    {
                        "path": path,
                        "left_size_bytes": left_item.get("size_bytes"),
                        "right_size_bytes": right_item.get("size_bytes"),
                        "left_sha256": left_item.get("sha256"),
                        "right_sha256": right_item.get("sha256"),
                        "left_kind": left_item.get("kind"),
                        "right_kind": right_item.get("kind"),
                    }
                )

    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "unchanged_count": unchanged_count,
    }


def serialize_compare_version(version):
    return {
        "id": version.id,
        "version": version.version,
        "stage": version.stage,
        "deployability_status": version.deployability_status or "unknown",
        "deployability_reason": version.deployability_reason or "",
        "tracking_status": version.tracking_status or "",
        "endpoint_url": version.endpoint_url or "",
        "image_name": version.image_name or "",
        "artifact_uri": version.artifact_uri or "",
        "mlflow_run_id": version.mlflow_run_id or "",
        "created_at": version.created_at,
        "updated_at": version.updated_at,
    }


def build_recommendation(left_version, right_version, metrics_diff):
    warnings = []
    selected = None
    for metric_name in PRIMARY_METRICS:
        selected = next((row for row in metrics_diff if row["name"].lower() == metric_name and row["winner"] in {"left", "right", "tie"}), None)
        if selected:
            break

    if not selected:
        return {
            "winner": "unknown",
            "confidence": "low",
            "reason": "No primary comparable metric found.",
            "warnings": warnings,
        }

    if selected["winner"] == "tie":
        return {
            "winner": "unknown",
            "confidence": "medium",
            "reason": f"Primary metric {selected['name']} is tied.",
            "warnings": warnings,
        }

    winner = selected["winner"]
    winner_version = right_version if winner == "right" else left_version
    confidence = "medium"
    if (winner_version.deployability_status or "unknown") != "deployable":
        warnings.append("The better-scoring version is not deployable.")
        confidence = "low"

    direction = "improves" if winner == "right" else "is better on"
    delta = selected.get("delta")
    delta_text = f" by {delta:.4f}" if _is_number(delta) else ""
    return {
        "winner": winner,
        "confidence": confidence,
        "reason": f"{winner.capitalize()} version {direction} {selected['name']}{delta_text}.",
        "warnings": warnings,
    }


def build_version_compare_payload(family, left_version, right_version):
    metrics_diff = compare_metrics(left_version.metrics_summary, right_version.metrics_summary)
    params_diff = compare_params(left_version.params_summary, right_version.params_summary)
    artifact_diff = compare_artifacts(left_version.artifact_manifest, right_version.artifact_manifest)

    return {
        "family": {
            "id": family.id,
            "name": family.name,
            "display_name": family.display_name,
        },
        "left": serialize_compare_version(left_version),
        "right": serialize_compare_version(right_version),
        "metrics_diff": metrics_diff,
        "params_diff": params_diff,
        "artifact_diff": artifact_diff,
        "deployability_diff": {
            "left": {
                "status": left_version.deployability_status or "unknown",
                "reason": left_version.deployability_reason or "",
            },
            "right": {
                "status": right_version.deployability_status or "unknown",
                "reason": right_version.deployability_reason or "",
            },
        },
        "deployment_diff": {
            "left_stage": left_version.stage,
            "right_stage": right_version.stage,
            "left_endpoint_url": left_version.endpoint_url or "",
            "right_endpoint_url": right_version.endpoint_url or "",
            "left_deployed": bool(left_version.endpoint_url),
            "right_deployed": bool(right_version.endpoint_url),
            "left_image_name": left_version.image_name or "",
            "right_image_name": right_version.image_name or "",
        },
        "recommendation": build_recommendation(left_version, right_version, metrics_diff),
    }
