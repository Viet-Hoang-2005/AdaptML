#!/usr/bin/env bash
set -euo pipefail

: "${CLUSTER_NAME:?Set CLUSTER_NAME to your Karpenter discovery cluster name.}"
: "${CLUSTER_ENDPOINT:?Set CLUSTER_ENDPOINT to your K3s Kubernetes API endpoint.}"

KARPENTER_VERSION="${KARPENTER_VERSION:-1.13.0}"
KARPENTER_BRIDGE_CRD_VERSION="${KARPENTER_BRIDGE_CRD_VERSION:-1.0.8}"
KARPENTER_CRD_VERSION="${KARPENTER_CRD_VERSION:-${KARPENTER_VERSION}}"
KARPENTER_NAMESPACE="${KARPENTER_NAMESPACE:-karpenter}"
INTERRUPTION_QUEUE="${KARPENTER_INTERRUPTION_QUEUE:-${CLUSTER_NAME}}"
KARPENTER_REPLICAS="${KARPENTER_REPLICAS:-1}"

echo "Installing Karpenter controller ${KARPENTER_VERSION} into namespace ${KARPENTER_NAMESPACE}..."
kubectl create namespace "${KARPENTER_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

echo "Applying Karpenter bridge CRDs for ${KARPENTER_BRIDGE_CRD_VERSION}..."
# v1.0.8 CRDs serve both v1 and v1beta1, which makes upgrades from older
# Karpenter releases possible before storedVersions is fully migrated to v1.
for crd in \
  karpenter.sh_nodeclaims.yaml \
  karpenter.sh_nodepools.yaml \
  karpenter.k8s.aws_ec2nodeclasses.yaml
do
  kubectl apply --server-side --force-conflicts -f "https://raw.githubusercontent.com/aws/karpenter-provider-aws/v${KARPENTER_BRIDGE_CRD_VERSION}/pkg/apis/crds/${crd}"
done

# The bridge CRDs include a conversion webhook default that does not match the
# Helm release namespace used here. Disable conversion while all manifests are
# served directly as v1.
for crd in \
  nodeclaims.karpenter.sh \
  nodepools.karpenter.sh \
  ec2nodeclasses.karpenter.k8s.aws
do
  kubectl patch crd "${crd}" --type=json -p='[{"op":"replace","path":"/spec/conversion","value":{"strategy":"None"}}]' || true
done

if [[ "${KARPENTER_CRD_VERSION}" != "${KARPENTER_BRIDGE_CRD_VERSION}" ]]; then
  echo "Migrating Karpenter CRD storedVersions to v1..."
  for crd in \
    nodeclaims.karpenter.sh \
    nodepools.karpenter.sh \
    ec2nodeclasses.karpenter.k8s.aws
  do
    kubectl patch crd "${crd}" --subresource=status --type=merge -p='{"status":{"storedVersions":["v1"]}}' || true
  done

  echo "Applying Karpenter CRDs for ${KARPENTER_CRD_VERSION}..."
  for crd in \
    karpenter.sh_nodeclaims.yaml \
    karpenter.sh_nodepools.yaml \
    karpenter.k8s.aws_ec2nodeclasses.yaml
  do
    kubectl apply --server-side --force-conflicts -f "https://raw.githubusercontent.com/aws/karpenter-provider-aws/v${KARPENTER_CRD_VERSION}/pkg/apis/crds/${crd}"
  done
fi

HELM_ARGS=(
  upgrade --install karpenter oci://public.ecr.aws/karpenter/karpenter
  --version "${KARPENTER_VERSION}"
  --namespace "${KARPENTER_NAMESPACE}"
  --set "replicas=${KARPENTER_REPLICAS}"
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
