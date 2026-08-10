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
ARGO_WEBHOOK_EVENTS = {"build", "deploy", "delete", "drift", "train", "cancel-train"}


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


def validate_execution_security(repo_root: Path, applications: list[dict]) -> list[str]:
    errors: list[str] = []
    execution_resources = render(repo_root, "k8s/argo")
    control_plane_resources = render(repo_root, "k8s/apps/base/control-plane")
    secret_resources = render(repo_root, "k8s/infra/secrets")

    def find_resource(resources: list[dict], kind: str, name: str) -> dict:
        for resource in resources:
            metadata = resource.get("metadata") or {}
            if resource.get("kind") == kind and metadata.get("name") == name:
                return resource
        return {}

    event_source = find_resource(execution_resources, "EventSource", "webhook-eventsource")
    if (event_source.get("metadata") or {}).get("namespace") != "argo-events":
        errors.append("webhook-eventsource must run in the argo-events namespace")
    event_source_spec = event_source.get("spec") or {}
    if "service" in event_source_spec:
        errors.append("EventSource must not generate an unmanaged webhook Service")
    if ((event_source_spec.get("template") or {}).get("serviceAccountName")) != "argo-eventsource-sa":
        errors.append("EventSource must use its non-privileged dedicated service account")
    webhooks = event_source_spec.get("webhook") or {}
    if set(webhooks) != ARGO_WEBHOOK_EVENTS:
        errors.append("webhook-eventsource must define exactly the six trusted execution endpoints")
    for event_name in sorted(ARGO_WEBHOOK_EVENTS):
        webhook = webhooks.get(event_name) or {}
        if webhook.get("authSecret") != {"name": "argo-events-webhook-server", "key": "token"}:
            errors.append(f"Argo webhook {event_name} must use the dedicated bearer-token Secret")
        if webhook.get("maxPayloadSize") != 262144:
            errors.append(f"Argo webhook {event_name} must enforce the 256 KiB payload limit")

    event_bus = find_resource(execution_resources, "EventBus", "default")
    if (event_bus.get("metadata") or {}).get("namespace") != "argo-events":
        errors.append("Argo EventBus must run in the argo-events namespace")
    native_nats = (((event_bus.get("spec") or {}).get("nats") or {}).get("native") or {})
    if native_nats.get("auth") != "token":
        errors.append("Argo EventBus native NATS authentication must be token")

    resource_text = json.dumps(execution_resources, sort_keys=True)
    if "argo-workflow-sa" in resource_text or "argo-events-sa" in resource_text:
        errors.append("legacy shared Argo service accounts must not be rendered")
    if "body.namespace" in resource_text:
        errors.append("training namespace must be fixed in Git, not accepted from an event payload")

    forbidden_role_resources = {"secrets", "pods/exec", "configmaps", "ingressroutes"}
    for resource in execution_resources:
        if resource.get("kind") != "Role":
            continue
        for rule in resource.get("rules") or []:
            resources = set(rule.get("resources") or [])
            if resources & forbidden_role_resources:
                errors.append(
                    f"Role {(resource.get('metadata') or {}).get('name')} grants forbidden execution access"
                )

    sensor = find_resource(execution_resources, "Sensor", "model-sensor")
    if (sensor.get("metadata") or {}).get("namespace") != "argo-events":
        errors.append("model-sensor must run in the argo-events namespace")
    if ((((sensor.get("spec") or {}).get("template") or {}).get("serviceAccountName"))) != "argo-sensor-sa":
        errors.append("model-sensor must use the dedicated sensor service account")
    for trigger in (sensor.get("spec") or {}).get("triggers") or []:
        source = (((trigger.get("template") or {}).get("k8s") or {}).get("source") or {})
        workflow_manifest = source.get("resource") or {}
        workflow_spec = workflow_manifest.get("spec") or {}
        if not workflow_spec.get("workflowTemplateRef"):
            errors.append("every Sensor trigger must reference a Git-managed WorkflowTemplate")
        if workflow_spec.get("serviceAccountName"):
            errors.append("Sensor trigger must not override a WorkflowTemplate service account")

    network_policy_names = {
        (resource.get("metadata") or {}).get("name")
        for resource in execution_resources
        if resource.get("kind") == "NetworkPolicy"
    }
    required_policies = {
        "allow-control-plane-worker-to-argo-events-webhook",
        "isolate-argo-events-eventbus",
    }
    if not required_policies <= network_policy_names:
        errors.append("execution Application must render EventSource and EventBus NetworkPolicies")

    webhook_policy = find_resource(
        execution_resources,
        "NetworkPolicy",
        "allow-control-plane-worker-to-argo-events-webhook",
    )
    webhook_ingress = ((webhook_policy.get("spec") or {}).get("ingress") or [])
    if len(webhook_ingress) != 1 or webhook_ingress[0] != {
        "from": [
            {
                "namespaceSelector": {
                    "matchLabels": {"kubernetes.io/metadata.name": "default"}
                },
                "podSelector": {"matchLabels": {"app": "mlops-paas-control-plane-worker"}},
            }
        ],
        "ports": [{"protocol": "TCP", "port": 12000}],
    }:
        errors.append("EventSource NetworkPolicy must allow only the default Control Plane worker on TCP 12000")

    external_secret_targets = {
        ((resource.get("spec") or {}).get("target") or {}).get("name")
        for resource in secret_resources
        if resource.get("kind") == "ExternalSecret"
    }
    if not {"argo-events-webhook-client", "argo-events-webhook-server"} <= external_secret_targets:
        errors.append("dedicated Argo Events client/server Secrets must be synchronized by External Secrets")

    for deployment_name in ("mlops-paas-control-plane", "mlops-paas-control-plane-worker"):
        deployment = find_resource(control_plane_resources, "Deployment", deployment_name)
        pod_spec = (((deployment.get("spec") or {}).get("template") or {}).get("spec") or {})
        if pod_spec.get("automountServiceAccountToken") is not False:
            errors.append(f"{deployment_name} must disable service-account token automount")
        if pod_spec.get("serviceAccountName"):
            errors.append(f"{deployment_name} must not use an execution-plane service account")
        token_env = [
            env
            for container in [*(pod_spec.get("initContainers") or []), *(pod_spec.get("containers") or [])]
            for env in container.get("env") or []
            if env.get("name") == "ARGO_EVENTS_WEBHOOK_TOKEN"
        ]
        if not token_env or any(
            (((env.get("valueFrom") or {}).get("secretKeyRef") or {}).get("name"))
            != "argo-events-webhook-client"
            for env in token_env
        ):
            errors.append(f"{deployment_name} must source the Argo bearer token from its client Secret")

    applications_by_name = {
        (application.get("metadata") or {}).get("name", ""): application
        for application in applications
    }
    workflows_application = applications_by_name.get("platform-argo-workflows") or {}
    helm_values = (
        (((workflows_application.get("spec") or {}).get("source") or {}).get("helm") or {})
        .get("values", "")
    )
    parsed_values = yaml.safe_load(helm_values) if helm_values else {}
    workflow_restrictions = ((parsed_values or {}).get("controller") or {}).get(
        "workflowRestrictions"
    )
    if workflow_restrictions != {"templateReferencing": "Secure"}:
        errors.append("Argo Workflows must enforce Secure WorkflowTemplate referencing")

    return errors


def validate(repo_root: Path, baseline: Path | None) -> int:
    root_resources = render(repo_root, "k8s")
    applications = [
        resource
        for resource in root_resources
        if resource.get("kind") == "Application"
    ]

    layout_errors = validate_workload_layout(repo_root, applications)
    validation_errors = [
        *layout_errors,
        *validate_execution_security(repo_root, applications),
    ]
    if validation_errors:
        for error in validation_errors:
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
