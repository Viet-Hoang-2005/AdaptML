#!/bin/bash
# argo-install.sh: Cài đặt ArgoCD lên K3s cluster bằng Helm
set -euo pipefail

ARGOCD_NAMESPACE="${ARGOCD_NAMESPACE:-argocd}"
ARGOCD_RELEASE_NAME="${ARGOCD_RELEASE_NAME:-argocd}"
ARGOCD_CHART_VERSION="${ARGOCD_CHART_VERSION:-}"
ARGOCD_VALUES_FILE="${ARGOCD_VALUES_FILE:-k8s/argocd/values.yaml}"

adopt_existing_argocd_resources() {
  if ! kubectl get namespace "${ARGOCD_NAMESPACE}" >/dev/null 2>&1; then
    return
  fi

  if helm status "${ARGOCD_RELEASE_NAME}" -n "${ARGOCD_NAMESPACE}" >/dev/null 2>&1; then
    return
  fi

  echo "Existing non-Helm ArgoCD resources detected; adopting them into Helm release metadata..."

  local namespaced_kinds=(
    deployment
    statefulset
    service
    serviceaccount
    configmap
    secret
    role
    rolebinding
    poddisruptionbudget
  )

  for kind in "${namespaced_kinds[@]}"; do
    while IFS= read -r resource; do
      [[ -z "${resource}" ]] && continue
      kubectl -n "${ARGOCD_NAMESPACE}" annotate "${resource}" \
        meta.helm.sh/release-name="${ARGOCD_RELEASE_NAME}" \
        meta.helm.sh/release-namespace="${ARGOCD_NAMESPACE}" \
        --overwrite >/dev/null
      kubectl -n "${ARGOCD_NAMESPACE}" label "${resource}" \
        app.kubernetes.io/managed-by=Helm \
        --overwrite >/dev/null
    done < <(kubectl -n "${ARGOCD_NAMESPACE}" get "${kind}" \
      -l app.kubernetes.io/part-of=argocd \
      -o name --ignore-not-found 2>/dev/null || true)
  done

  for kind in clusterrole clusterrolebinding; do
    while IFS= read -r resource; do
      [[ -z "${resource}" ]] && continue
      kubectl annotate "${resource}" \
        meta.helm.sh/release-name="${ARGOCD_RELEASE_NAME}" \
        meta.helm.sh/release-namespace="${ARGOCD_NAMESPACE}" \
        --overwrite >/dev/null
      kubectl label "${resource}" \
        app.kubernetes.io/managed-by=Helm \
        --overwrite >/dev/null
    done < <(kubectl get "${kind}" \
      -l app.kubernetes.io/part-of=argocd \
      -o name --ignore-not-found 2>/dev/null || true)
  done
}

echo "[1/7] Adding Argo Helm repository..."
helm repo add argo https://argoproj.github.io/argo-helm --force-update
helm repo update argo

echo "[2/7] Preparing existing ArgoCD resources for Helm ownership..."
adopt_existing_argocd_resources

echo "[3/7] Installing/Upgrading ArgoCD with Helm..."
helm_args=(
  upgrade --install "${ARGOCD_RELEASE_NAME}" argo/argo-cd
  --namespace "${ARGOCD_NAMESPACE}"
  --create-namespace
  --values "${ARGOCD_VALUES_FILE}"
  --wait
  --timeout 10m
)

if [[ -n "${ARGOCD_CHART_VERSION}" ]]; then
  helm_args+=(--version "${ARGOCD_CHART_VERSION}")
fi

helm "${helm_args[@]}"

echo "[4/7] Waiting for ArgoCD Server to be ready..."
kubectl rollout status deployment/argocd-server -n "${ARGOCD_NAMESPACE}" --timeout=300s

echo "[5/7] Applying ArgoCD repository credential sync..."
if kubectl get crd externalsecrets.external-secrets.io >/dev/null 2>&1; then
  kubectl apply -f k8s/argocd/repo-sync.yaml
else
  echo "External Secrets Operator CRD not found; skipping repository credential sync."
fi

echo "[6/7] Applying ArgoCD Application manifests..."
kubectl apply -f k8s/argocd/application.yaml

echo "[7/7] Reading initial admin password..."
ARGOCD_PASSWORD="$(kubectl -n "${ARGOCD_NAMESPACE}" get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" 2>/dev/null | base64 --decode || true)"

echo "ArgoCD installation complete!"
echo "Dashboard URL   : https://argocd.mlops-nids-nt114.id.vn"
if [[ -n "${ARGOCD_PASSWORD}" ]]; then
  echo "Admin password  : ${ARGOCD_PASSWORD}"
else
  echo "Admin password  : already rotated or initial secret not found"
fi
kubectl get pods -n "${ARGOCD_NAMESPACE}"
