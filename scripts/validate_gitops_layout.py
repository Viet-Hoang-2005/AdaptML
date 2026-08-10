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
PLATFORM_IMAGE_PATTERN = "registry.mlops-nids-nt114.id.vn/mlops-paas/*"
KEYLESS_SIGNER_IDENTITY = (
    "https://github.com/Viet-Hoang-2005/MLOps-paas-system/"
    ".github/workflows/cd.yml@refs/heads/main"
)
KEYLESS_SIGNER_ISSUER = "https://token.actions.githubusercontent.com"
ALLOWED_BASELINE_EXTRAS = {
    ("v1", "Namespace", "", "karpenter"),
    ("v1", "Namespace", "", "gpu-operator"),
}
LEGACY_K8S_PATHS = (
    "k8s/.kube",
    "k8s/harbor",
    "k8s/workloads",
    "k8s/execution",
    "k8s/deferred",
    "k8s/infra",
    "k8s/operators",
    "k8s/gitops/production/cluster",
)
PRODUCTION_NAMESPACES = {
    "argo",
    "argo-events",
    "cloudflare",
    "cnpg-system",
    "external-secrets",
    "gpu-operator",
    "harbor",
    "karpenter",
    "keda",
    "kubeflow",
    "kyverno",
    "mlflow-server",
    "monitoring",
    "user-jobs",
}
WORKLOAD_APPLICATIONS = {
    "mlops-prod-workload-control-plane": ("control-plane", "mlops-paas-control-plane"),
    "mlops-prod-workload-consumer": ("consumer", "mlops-paas-consumer"),
    "mlops-prod-workload-model-server": ("model-server", "mlops-paas-model-server"),
    "mlops-prod-workload-web": ("web", "mlops-paas-web"),
}
ARGO_WEBHOOK_EVENTS = {"build", "deploy", "delete", "drift", "train", "cancel-train"}
LEGACY_SHARED_SECRET_TARGETS = {
    "mlops-paas-secret",
    "postgres-secrets",
    "harbor-registry-secret",
}
EXTERNAL_SECRET_OWNERS = {
    "k8s/apps/overlays/production/control-plane": {
        ("default", "control-plane-api-secret"),
        ("default", "control-plane-worker-secret"),
    },
    "k8s/apps/overlays/production/consumer": {("default", "consumer-secret")},
    "k8s/apps/overlays/production/model-server": {("default", "model-server-secret")},
    "k8s/platform/data/postgres": {("default", "postgres-bootstrap-secret")},
    "k8s/platform/mlflow": {("mlflow-server", "mlflow-secret")},
    "k8s/platform/edge/cloudflare": {("cloudflare", "tunnel-token")},
    "k8s/argo": {
        ("default", "argo-build-callback-secret"),
        ("default", "harbor-registry-dockerconfig"),
        ("default", "argo-delete-callback-secret"),
        ("default", "argo-evidently-secret"),
        ("argo-events", "argo-events-webhook-server"),
        ("user-jobs", "harbor-registry-pull-secret"),
    },
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


def validate_lifecycle_contract(applications: list[dict]) -> list[str]:
    """Require every child Application to declare one unambiguous lifecycle plane."""
    errors: list[str] = []
    if len(applications) != 30:
        errors.append(f"root GitOps must render exactly 30 child Applications, found {len(applications)}")

    git_boundaries = {
        "k8s/cluster/": ("mlops-prod-cluster-", "mlops-cluster", "cluster"),
        "k8s/addons/": ("mlops-prod-addon-", "mlops-addons", "addon"),
        "k8s/platform/": ("mlops-prod-platform-", "mlops-platform", "platform"),
        "k8s/argo": ("mlops-prod-execution-", "mlops-execution", "execution"),
        "k8s/apps/": ("mlops-prod-workload-", "mlops-workloads", "workload"),
    }

    for application in applications:
        metadata = application.get("metadata") or {}
        spec = application.get("spec") or {}
        name = metadata.get("name", "")
        project = spec.get("project")
        plane = (metadata.get("labels") or {}).get("mlops-paas.io/plane")
        sources = spec.get("sources") or [spec.get("source") or {}]
        is_chart = any(source.get("chart") for source in sources)

        if is_chart:
            expected = ("mlops-prod-addon-", "mlops-addons", "addon")
            if not all((name.startswith(expected[0]), project == expected[1], plane == expected[2])):
                errors.append(f"Helm Application {name} must belong to the addons lifecycle boundary")
            continue

        paths = [source.get("path", "") for source in sources]
        boundary = next(
            (
                contract
                for path_prefix, contract in git_boundaries.items()
                if paths and all(path.startswith(path_prefix) for path in paths)
            ),
            None,
        )
        if not boundary:
            errors.append(f"Git Application {name} has an unsupported lifecycle source path: {paths}")
            continue
        expected_name, expected_project, expected_plane = boundary
        if not name.startswith(expected_name) or project != expected_project or plane != expected_plane:
            errors.append(
                f"Git Application {name} must use {expected_name}<component>, "
                f"project {expected_project}, and plane {expected_plane}"
            )

    expected_waves = {
        "mlops-prod-cluster-namespaces": "-50",
        "mlops-prod-cluster-storage": "-30",
        "mlops-prod-cluster-secret-store": "-30",
        "mlops-prod-cluster-image-verification": "-29",
        "mlops-prod-addon-karpenter-crds": "-25",
        "mlops-prod-addon-karpenter": "-24",
        "mlops-prod-addon-kubeflow-training": "-24",
        "mlops-prod-addon-node-feature-discovery": "-24",
        "mlops-prod-cluster-karpenter-capacity": "-23",
        "mlops-prod-addon-gpu-operator": "-23",
    }
    expected_waves.update(
        {
            name: "-40"
            for name in (
                "mlops-prod-addon-aws-ebs-csi",
                "mlops-prod-addon-external-secrets",
                "mlops-prod-addon-cloudnative-pg",
                "mlops-prod-addon-keda",
                "mlops-prod-addon-argo-workflows",
                "mlops-prod-addon-argo-events",
                "mlops-prod-addon-monitoring",
                "mlops-prod-addon-kyverno",
            )
        }
    )
    for application in applications:
        metadata = application.get("metadata") or {}
        name = metadata.get("name", "")
        expected_wave = expected_waves.get(name)
        if expected_wave and (metadata.get("annotations") or {}).get(
            "argocd.argoproj.io/sync-wave"
        ) != expected_wave:
            errors.append(f"{name} must reconcile at sync wave {expected_wave}")

    return errors


def validate_project_boundaries(root_resources: list[dict]) -> list[str]:
    """Verify that trust boundaries match the lifecycle Application contract."""
    errors: list[str] = []
    projects = {
        (resource.get("metadata") or {}).get("name"): resource
        for resource in root_resources
        if resource.get("kind") == "AppProject"
    }
    required_projects = {
        "mlops-cluster",
        "mlops-addons",
        "mlops-platform",
        "mlops-execution",
        "mlops-workloads",
    }
    if set(projects) != required_projects:
        errors.append(
            f"GitOps must define exactly {sorted(required_projects)} AppProjects, found {sorted(projects)}"
        )
        return errors

    repo_only = [REPOSITORY_URL]
    for project_name in ("mlops-cluster", "mlops-platform", "mlops-execution", "mlops-workloads"):
        if (projects[project_name].get("spec") or {}).get("sourceRepos") != repo_only:
            errors.append(f"{project_name} must trust only the repository Git source")

    platform_spec = projects["mlops-platform"].get("spec") or {}
    if platform_spec.get("clusterResourceBlacklist") != [{"group": "*", "kind": "*"}]:
        errors.append("mlops-platform must explicitly deny all cluster-scoped resources")

    cluster_spec = projects["mlops-cluster"].get("spec") or {}
    cluster_kinds = {
        (entry.get("group"), entry.get("kind"))
        for entry in cluster_spec.get("clusterResourceWhitelist") or []
    }
    expected_cluster_kinds = {
        ("", "Namespace"),
        ("storage.k8s.io", "StorageClass"),
        ("external-secrets.io", "ClusterSecretStore"),
        ("karpenter.k8s.aws", "EC2NodeClass"),
        ("karpenter.sh", "NodePool"),
        ("kyverno.io", "ClusterPolicy"),
    }
    if cluster_kinds != expected_cluster_kinds:
        errors.append("mlops-cluster must allow only declared cluster-configuration resource kinds")

    addons_spec = projects["mlops-addons"].get("spec") or {}
    if addons_spec.get("clusterResourceWhitelist") != [{"group": "*", "kind": "*"}]:
        errors.append("mlops-addons must retain the trusted add-on chart cluster-resource allowance")

    return errors


def validate_cluster_namespace_ownership(
    repo_root: Path, root_resources: list[dict], applications: list[dict]
) -> list[str]:
    """Keep namespaces and cluster configuration in their dedicated child apps."""
    errors: list[str] = []
    root_namespaces = {
        (resource.get("metadata") or {}).get("name")
        for resource in root_resources
        if resource.get("kind") == "Namespace"
    }
    if root_namespaces:
        errors.append("root GitOps must own only control-tree resources, never Namespace resources")

    namespace_resources = render(repo_root, "k8s/cluster/namespaces")
    namespace_names = {
        (resource.get("metadata") or {}).get("name")
        for resource in namespace_resources
        if resource.get("kind") == "Namespace"
    }
    if namespace_names != PRODUCTION_NAMESPACES:
        errors.append(
            "cluster namespace set must be "
            f"{sorted(PRODUCTION_NAMESPACES)}, found {sorted(namespace_names)}"
        )

    applications_by_name = {
        (application.get("metadata") or {}).get("name", ""): application
        for application in applications
    }
    namespaces_application = applications_by_name.get("mlops-prod-cluster-namespaces") or {}
    namespaces_source = ((namespaces_application.get("spec") or {}).get("source") or {})
    if namespaces_source.get("path") != "k8s/cluster/namespaces":
        errors.append("mlops-prod-cluster-namespaces must source k8s/cluster/namespaces")
    if (namespaces_application.get("metadata") or {}).get("annotations", {}).get(
        "argocd.argoproj.io/sync-wave"
    ) != "-50":
        errors.append("mlops-prod-cluster-namespaces must reconcile at sync wave -50")

    storage_application = applications_by_name.get("mlops-prod-cluster-storage") or {}
    storage_source = ((storage_application.get("spec") or {}).get("source") or {})
    if storage_source.get("path") != "k8s/cluster/storage":
        errors.append("mlops-prod-cluster-storage must source k8s/cluster/storage")
    if (storage_application.get("metadata") or {}).get("annotations", {}).get(
        "argocd.argoproj.io/sync-wave"
    ) != "-30":
        errors.append("mlops-prod-cluster-storage must reconcile at sync wave -30")

    storage_resources = render(repo_root, "k8s/cluster/storage")
    if any(resource.get("kind") == "Namespace" for resource in storage_resources):
        errors.append("mlops-prod-cluster-storage must not own Namespace resources")
    storage_classes = {
        (resource.get("metadata") or {}).get("name")
        for resource in storage_resources
        if resource.get("kind") == "StorageClass"
    }
    if storage_classes != {"ebs-gp3"}:
        errors.append("mlops-prod-cluster-storage must own exactly the ebs-gp3 StorageClass")

    return errors


def validate_execution_security(repo_root: Path, applications: list[dict]) -> list[str]:
    errors: list[str] = []
    execution_resources = render(repo_root, "k8s/argo")
    control_plane_resources = render(repo_root, "k8s/apps/overlays/production/control-plane")

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
        (resource_namespace(resource), ((resource.get("spec") or {}).get("target") or {}).get("name"))
        for resource in execution_resources
        if resource.get("kind") == "ExternalSecret"
    }
    if ("argo-events", "argo-events-webhook-server") not in external_secret_targets:
        errors.append("the Argo Events server bearer-token Secret must be synchronized by External Secrets")

    for deployment_name, expected_secret in {
        "mlops-paas-control-plane": "control-plane-api-secret",
        "mlops-paas-control-plane-worker": "control-plane-worker-secret",
    }.items():
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
            != expected_secret
            for env in token_env
        ):
            errors.append(f"{deployment_name} must source the Argo bearer token from {expected_secret}")

    applications_by_name = {
        (application.get("metadata") or {}).get("name", ""): application
        for application in applications
    }
    workflows_application = applications_by_name.get("mlops-prod-addon-argo-workflows") or {}
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


def resource_namespace(resource: dict) -> str:
    return ((resource.get("metadata") or {}).get("namespace")) or "default"


def validate_secret_ownership(repo_root: Path) -> list[str]:
    """Ensure target Secrets have one nearby ExternalSecret owner and a consumer."""
    errors: list[str] = []
    all_resources: list[dict] = []
    targets: dict[tuple[str, str], str] = {}

    for source_path, expected_targets in EXTERNAL_SECRET_OWNERS.items():
        resources = render(repo_root, source_path)
        all_resources.extend(resources)
        actual_targets = {
            (resource_namespace(resource), ((resource.get("spec") or {}).get("target") or {}).get("name"))
            for resource in resources
            if resource.get("kind") == "ExternalSecret"
        }
        if actual_targets != expected_targets:
            errors.append(
                f"{source_path} ExternalSecret targets must be {sorted(expected_targets)}, found {sorted(actual_targets)}"
            )
        for resource in resources:
            if resource.get("kind") != "ExternalSecret":
                continue
            metadata = resource.get("metadata") or {}
            spec = resource.get("spec") or {}
            if (metadata.get("annotations") or {}).get("argocd.argoproj.io/sync-wave") != "-1":
                errors.append(f"ExternalSecret {metadata.get('name')} must use sync wave -1")
            if spec.get("secretStoreRef") != {"kind": "ClusterSecretStore", "name": "aws-secrets-manager"}:
                errors.append(f"ExternalSecret {metadata.get('name')} must use aws-secrets-manager")
        for target in actual_targets:
            if not target[1]:
                errors.append(f"{source_path} contains an ExternalSecret without spec.target.name")
                continue
            if target in targets:
                errors.append(f"ExternalSecret target {target} is owned by both {targets[target]} and {source_path}")
            targets[target] = source_path

    rendered_text = json.dumps(
        [resource for resource in all_resources if resource.get("kind") != "ExternalSecret"],
        sort_keys=True,
    )
    for namespace, target in sorted(targets):
        if target not in rendered_text:
            errors.append(f"ExternalSecret target {namespace}/{target} has no consumer in its owner source")

    for target in LEGACY_SHARED_SECRET_TARGETS:
        if target in rendered_text or any(target == target_name for _, target_name in targets):
            errors.append(f"legacy shared Secret target {target} must not be rendered")

    secrets_resources = render(repo_root, "k8s/cluster/secret-store")
    if any(resource.get("kind") == "ExternalSecret" for resource in secrets_resources):
        errors.append("mlops-prod-cluster-secret-store must own only ClusterSecretStore, not ExternalSecrets")

    return errors


def validate_image_verification(repo_root: Path, applications: list[dict]) -> list[str]:
    """Keep the keyless image-verification boundary explicit and fail closed."""
    errors: list[str] = []
    applications_by_name = {
        (application.get("metadata") or {}).get("name", ""): application
        for application in applications
    }

    kyverno_application = applications_by_name.get("mlops-prod-addon-kyverno") or {}
    kyverno_source = ((kyverno_application.get("spec") or {}).get("source") or {})
    kyverno_destination = ((kyverno_application.get("spec") or {}).get("destination") or {})
    if kyverno_source.get("repoURL") != "https://kyverno.github.io/kyverno":
        errors.append("mlops-prod-addon-kyverno must use the official Kyverno Helm repository")
    if kyverno_source.get("chart") != "kyverno" or kyverno_source.get("targetRevision") != "3.8.2":
        errors.append("mlops-prod-addon-kyverno must pin the Kyverno chart to 3.8.2")
    if kyverno_destination.get("namespace") != "kyverno":
        errors.append("mlops-prod-addon-kyverno must install into the kyverno namespace")
    if (kyverno_application.get("metadata") or {}).get("annotations", {}).get(
        "argocd.argoproj.io/sync-wave"
    ) != "-40":
        errors.append("mlops-prod-addon-kyverno must reconcile at sync wave -40")

    verification_application = applications_by_name.get("mlops-prod-cluster-image-verification") or {}
    verification_source = ((verification_application.get("spec") or {}).get("source") or {})
    verification_destination = ((verification_application.get("spec") or {}).get("destination") or {})
    if verification_source.get("path") != "k8s/cluster/policies/image-verification":
        errors.append("mlops-prod-cluster-image-verification must use the Git-backed policy source")
    if verification_destination.get("namespace") != "kyverno":
        errors.append("mlops-prod-cluster-image-verification must reconcile in the kyverno namespace")
    if (verification_application.get("metadata") or {}).get("annotations", {}).get(
        "argocd.argoproj.io/sync-wave"
    ) != "-29":
        errors.append("mlops-prod-cluster-image-verification must reconcile after its dependencies")

    resources = render(repo_root, "k8s/cluster/policies/image-verification")

    def find_resource(kind: str, name: str) -> dict:
        return next(
            (
                resource
                for resource in resources
                if resource.get("kind") == kind
                and (resource.get("metadata") or {}).get("name") == name
            ),
            {},
        )

    credentials = find_resource("ExternalSecret", "kyverno-harbor-registry-auth-sync")
    credentials_spec = credentials.get("spec") or {}
    credentials_target = credentials_spec.get("target") or {}
    if resource_namespace(credentials) != "kyverno":
        errors.append("Kyverno registry credentials must be synchronized into the kyverno namespace")
    if credentials_target.get("name") != "kyverno-harbor-registry-auth":
        errors.append("Kyverno registry credential target must be kyverno-harbor-registry-auth")
    if (credentials_target.get("template") or {}).get("type") != "kubernetes.io/dockerconfigjson":
        errors.append("Kyverno registry credentials must be a dockerconfigjson Secret")
    if credentials_spec.get("secretStoreRef") != {
        "kind": "ClusterSecretStore",
        "name": "aws-secrets-manager",
    }:
        errors.append("Kyverno registry credentials must use aws-secrets-manager")

    policy = find_resource("ClusterPolicy", "verify-platform-images")
    policy_spec = policy.get("spec") or {}
    if policy_spec.get("background") is not False:
        errors.append("image verification must not mutate existing workloads in the background")
    if policy_spec.get("failurePolicy") != "Fail":
        errors.append("image verification must fail closed when Kyverno cannot verify")
    if policy_spec.get("validationFailureAction") != "Enforce":
        errors.append("image verification must be enforced, not audit-only")
    if policy_spec.get("webhookTimeoutSeconds") != 30:
        errors.append("image verification must use the bounded 30-second registry timeout")

    rules = policy_spec.get("rules") or []
    verify_images = ((rules[0] if rules else {}).get("verifyImages") or [])
    if len(verify_images) != 1:
        errors.append("image verification policy must contain exactly one verifyImages rule")
        return errors
    verification = verify_images[0]
    if verification.get("imageReferences") != [PLATFORM_IMAGE_PATTERN]:
        errors.append("image verification must scope only platform images, never tenant images")
    for field in ("required", "mutateDigest", "verifyDigest"):
        if verification.get(field) is not True:
            errors.append(f"image verification must set {field}=true")
    if (verification.get("imageRegistryCredentials") or {}).get("secrets") != [
        "kyverno-harbor-registry-auth"
    ]:
        errors.append("image verification must authenticate to Harbor with its scoped credential")

    attestors = verification.get("attestors") or []
    entries = ((attestors[0] if attestors else {}).get("entries") or [])
    keyless = ((entries[0] if entries else {}).get("keyless") or {})
    if keyless.get("subject") != KEYLESS_SIGNER_IDENTITY:
        errors.append("image verification must require the exact CD workflow keyless identity")
    if keyless.get("issuer") != KEYLESS_SIGNER_ISSUER:
        errors.append("image verification must require the GitHub Actions OIDC issuer")
    if keyless.get("rekor", {}).get("url") != "https://rekor.sigstore.dev":
        errors.append("image verification must verify the transparency-log entry")

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
        *validate_lifecycle_contract(applications),
        *validate_project_boundaries(root_resources),
        *validate_cluster_namespace_ownership(repo_root, root_resources, applications),
        *validate_execution_security(repo_root, applications),
        *validate_secret_ownership(repo_root),
        *validate_image_verification(repo_root, applications),
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
