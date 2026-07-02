#!/usr/bin/env bash
set -euo pipefail

: "${CLUSTER_NAME:?Set CLUSTER_NAME to your Karpenter discovery cluster name.}"
: "${CLUSTER_ENDPOINT:?Set CLUSTER_ENDPOINT to your K3s Kubernetes API endpoint.}"

KARPENTER_VERSION="${KARPENTER_VERSION:-0.37.0}"
KARPENTER_NAMESPACE="${KARPENTER_NAMESPACE:-karpenter}"
INTERRUPTION_QUEUE="${KARPENTER_INTERRUPTION_QUEUE:-${CLUSTER_NAME}}"

echo "Installing Karpenter controller ${KARPENTER_VERSION} into namespace ${KARPENTER_NAMESPACE}..."
kubectl create namespace "${KARPENTER_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

HELM_ARGS=(
  upgrade --install karpenter oci://public.ecr.aws/karpenter/karpenter
  --version "${KARPENTER_VERSION}"
  --namespace "${KARPENTER_NAMESPACE}"
  --set "settings.clusterName=${CLUSTER_NAME}"
  --set "settings.clusterEndpoint=${CLUSTER_ENDPOINT}"
  --set "settings.interruptionQueue=${INTERRUPTION_QUEUE}"
  --set "nodeSelector.workload-type=worker"
  --wait
)

if [[ -n "${KARPENTER_CONTROLLER_ROLE_ARN:-}" ]]; then
  HELM_ARGS+=(--set "serviceAccount.annotations.eks\.amazonaws\.com/role-arn=${KARPENTER_CONTROLLER_ROLE_ARN}")
fi

helm "${HELM_ARGS[@]}"

kubectl -n "${KARPENTER_NAMESPACE}" rollout status deployment/karpenter --timeout=180s

echo "Karpenter controller is ready."
