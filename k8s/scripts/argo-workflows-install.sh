#!/bin/bash
# k8s/scripts/argo-workflows-install.sh: Cài đặt Argo Workflows & Argo Events lên K3s
set -e

echo "[1/3] Adding Argo Helm repository..."
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update

echo "[2/3] Installing Argo Workflows Controller & CRDs..."
helm upgrade --install argo-workflows argo/argo-workflows \
  --namespace argo \
  --create-namespace \
  --set crds.install=true \
  --set controller.workflowNamespaces='{default,argo}' \
  --wait

echo "[3/3] Installing Argo Events Controller & CRDs..."
helm upgrade --install argo-events argo/argo-events \
  --namespace argo-events \
  --create-namespace \
  --set crds.install=true \
  --wait

echo "Argo Workflows & Argo Events Controllers installed successfully!"
kubectl get pods -n argo
kubectl get pods -n argo-events
