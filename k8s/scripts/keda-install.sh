#!/bin/bash
# k8s/keda-install.sh: Cài đặt KEDA (Kubernetes Event-driven Autoscaling) lên K3s

set -e

NAMESPACE="keda"

echo "[1/2] Add Helm repo KEDA..."
helm repo add kedacore https://kedacore.github.io/charts
helm repo update

echo "[2/2] Install KEDA..."
helm upgrade --install keda kedacore/keda \
  --namespace ${NAMESPACE} \
  --create-namespace \
  --wait

echo "KEDA installation completed!"
kubectl get pods -n ${NAMESPACE}
