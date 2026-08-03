#!/usr/bin/env python3
"""Validate the production GitOps layout, rendering, and resource ownership."""

from __future__ import annotations

import argparse
import copy
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml


REPOSITORY_URL = "https://github.com/Viet-Hoang-2005/MLOps-paas-system.git"
ALLOWED_BASELINE_EXTRAS = {
    ("v1", "Namespace", "", "karpenter"),
    ("v1", "Namespace", "", "gpu-operator"),
}
LEGACY_K8S_PATHS = (
    "k8s/.kube",
    "k8s/harbor",
    "k8s/operators/bootstrap",
    "k8s/platform",
    "k8s/workloads",
    "k8s/execution",
    "k8s/deferred",
)
WORKLOAD_APPLICATIONS = {
    "mlops-prod-control-plane": ("control-plane", "mlops-paas-control-plane"),
    "mlops-prod-consumer": ("consumer", "mlops-paas-consumer"),
    "mlops-prod-model-server": ("model-server", "mlops-paas-model-server"),
    "mlops-prod-web": ("web", "mlops-paas-web"),
}


def render(repo_root: Path, path: str) -> list[dict]:
    command = ["kubectl", "kustomize", "--enable-helm", path]
    result = subprocess.run(
        command,
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return [document for document in yaml.safe_load_all(result.stdout) if document]


def render_helm(application: dict) -> list[dict]:
    spec = application.get("spec") or {}
    source = spec.get("source") or {}
    destination = spec.get("destination") or {}
    helm = source.get("helm") or {}
    release_name = helm.get("releaseName") or (application.get("metadata") or {}).get("name")
    repo_url = source["repoURL"].rstrip("/")
    chart = source["chart"]
    if repo_url.startswith("http://") or repo_url.startswith("https://"):
        chart_ref = chart
        repository_args = ["--repo", repo_url]
    else:
        chart_ref = f"oci://{repo_url}/{chart}"
        repository_args = []
    command = [
        "helm",
        "template",
        release_name,
        chart_ref,
        "--version",
        str(source["targetRevision"]),
        "--namespace",
        destination.get("namespace", "default"),
        *repository_args,
    ]
    values = helm.get("values")
    values_path: Path | None = None
    try:
        if values:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".yaml", delete=False) as handle:
                handle.write(values)
                values_path = Path(handle.name)
            command.extend(["--values", str(values_path)])
        result = subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8")
    finally:
        if values_path:
            values_path.unlink(missing_ok=True)
    return [document for document in yaml.safe_load_all(result.stdout) if document]


def identity(resource: dict) -> tuple[str, str, str, str]:
    metadata = resource.get("metadata") or {}
    return (
        resource.get("apiVersion", ""),
        resource.get("kind", ""),
        metadata.get("namespace", ""),
        metadata.get("name", ""),
    )


def normalized(resource: dict) -> dict:
    value = copy.deepcopy(resource)
    metadata = value.get("metadata") or {}
    if metadata.get("namespace") == "harbor":
        if value.get("kind") == "Secret":
            value.pop("data", None)
            value.pop("stringData", None)
        annotations = (
            value.get("spec", {})
            .get("template", {})
            .get("metadata", {})
            .get("annotations", {})
        )
        for annotation in list(annotations):
            if annotation.startswith("checksum/secret"):
                annotations.pop(annotation)
    return value


def canonical(resource: dict) -> str:
    return json.dumps(normalized(resource), sort_keys=True, separators=(",", ":"))


def validate_workload_layout(repo_root: Path, applications: list[dict]) -> list[str]:
    applications_by_name = {
        (application.get("metadata") or {}).get("name", ""): application
        for application in applications
    }
    errors: list[str] = []

    for application_name, (service, logical_image) in WORKLOAD_APPLICATIONS.items():
        expected_path = f"k8s/apps/overlays/production/{service}"
        application = applications_by_name.get(application_name)
        source_path = ((application or {}).get("spec") or {}).get("source", {}).get("path")
        if source_path != expected_path:
            errors.append(
                f"{application_name} source must be {expected_path}, found {source_path or 'missing'}"
            )

        base_resources = render(repo_root, f"k8s/apps/base/{service}")
        application_images: list[str] = []
        for resource in base_resources:
            pod_spec = (
                (resource.get("spec") or {})
                .get("template", {})
                .get("spec", {})
            )
            for container_type in ("initContainers", "containers"):
                application_images.extend(
                    container.get("image", "")
                    for container in pod_spec.get(container_type, [])
                    if container.get("image", "").split(":", 1)[0] == logical_image
                )

        if not application_images:
            errors.append(f"{service} base does not reference logical image {logical_image}")
        for image in application_images:
            if image != logical_image:
                errors.append(
                    f"{service} base image must not contain a tag or digest: {image}"
                )

    return errors


def validate(repo_root: Path, baseline: Path | None) -> int:
    root_resources = render(repo_root, "k8s")
    applications = [
        resource
        for resource in root_resources
        if resource.get("kind") == "Application"
    ]

    layout_errors = validate_workload_layout(repo_root, applications)
    if layout_errors:
        for error in layout_errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    ownership: dict[tuple[str, str, str, str], str] = {}
    rendered: dict[tuple[str, str, str, str], dict] = {}
    core_rendered: dict[tuple[str, str, str, str], dict] = {}
    duplicate_errors: list[str] = []

    for application in applications:
        metadata = application.get("metadata") or {}
        spec = application.get("spec") or {}
        app_name = metadata.get("name", "")
        sources = spec.get("sources") or [spec.get("source") or {}]
        for source in sources:
            source_path = source.get("path")
            if source.get("repoURL") == REPOSITORY_URL and source_path:
                resources = render(repo_root, source_path)
            elif source.get("chart"):
                resources = render_helm(application)
            else:
                raise ValueError(f"Unsupported Application source for {app_name}")
            for resource in resources:
                key = identity(resource)
                if not all((key[0], key[1], key[3])):
                    raise ValueError(f"Resource without a complete identity in {app_name}: {key}")
                previous_owner = ownership.get(key)
                if previous_owner:
                    duplicate_errors.append(f"{key} is owned by {previous_owner} and {app_name}")
                    continue
                ownership[key] = app_name
                rendered[key] = resource
                if app_name.startswith("mlops-prod-"):
                    core_rendered[key] = resource

    if duplicate_errors:
        for error in duplicate_errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    if baseline:
        baseline_resources = {
            identity(resource): resource
            for resource in yaml.safe_load_all(baseline.read_text(encoding="utf-8"))
            if resource
        }
        baseline_keys = set(baseline_resources)
        current_keys = set(core_rendered)
        missing = sorted(baseline_keys - current_keys)
        extra = sorted((current_keys - baseline_keys) - ALLOWED_BASELINE_EXTRAS)
        changed = sorted(
            key
            for key in baseline_keys & current_keys
            if canonical(baseline_resources[key]) != canonical(core_rendered[key])
        )
        if missing or extra or changed:
            for label, values in (("missing", missing), ("extra", extra), ("changed", changed)):
                for value in values:
                    print(f"ERROR: baseline {label}: {value}", file=sys.stderr)
            return 1

    print(
        f"Validated {len(applications)} Argo CD Applications and "
        f"{len(rendered)} unique resources."
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--baseline",
        type=Path,
        help="Optional manifest rendered by the legacy monolithic root.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    legacy_paths = [path for path in LEGACY_K8S_PATHS if (repo_root / path).exists()]
    if legacy_paths:
        for path in legacy_paths:
            print(f"ERROR: legacy Kubernetes path still exists: {path}", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory(prefix="mlops-gitops-") as temporary_directory:
        render_root = Path(temporary_directory)
        shutil.copytree(repo_root / "k8s", render_root / "k8s")
        return validate(render_root, args.baseline)


if __name__ == "__main__":
    raise SystemExit(main())
