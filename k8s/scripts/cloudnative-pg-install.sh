#!/usr/bin/env bash
# Install CloudNativePG operator and CRDs before ArgoCD syncs PostgreSQL Cluster resources.
set -euo pipefail

NAMESPACE="${CNPG_NAMESPACE:-cnpg-system}"
RELEASE_NAME="${CNPG_RELEASE_NAME:-cloudnative-pg}"
CHART_VERSION="${CNPG_OPERATOR_CHART_VERSION:-}"

echo "[1/2] Add Helm repository for CloudNativePG..."
helm repo add cloudnative-pg https://cloudnative-pg.github.io/charts --force-update
helm repo update cloudnative-pg

echo "[2/2] Installing CloudNativePG operator..."
HELM_ARGS=(
  upgrade --install "${RELEASE_NAME}" cloudnative-pg/cloudnative-pg
  --namespace "${NAMESPACE}"
  --create-namespace
  --set "nodeSelector.workload-type=worker"
  --wait
)

if [[ -n "${CHART_VERSION}" ]]; then
  HELM_ARGS+=(--version "${CHART_VERSION}")
fi

helm "${HELM_ARGS[@]}"

kubectl -n "${NAMESPACE}" rollout status deployment/"${RELEASE_NAME}" --timeout=180s
echo "CloudNativePG operator is ready."
