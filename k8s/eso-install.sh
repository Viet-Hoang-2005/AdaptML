#!/bin/bash
# k8s/eso-install.sh: Cài đặt External Secrets Operator vào cụm K3s bằng Helm

set -e

echo "[1/2] Start installing External Secrets Operator (ESO)..."

# Thêm kho chứa Helm của ESO
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

# Cài đặt ESO vào namespace external-secrets
helm install external-secrets \
   external-secrets/external-secrets \
    -n external-secrets \
    --create-namespace \
    --set installCRDs=true

echo "[2/2] ESO installation complete!"
kubectl get pods -n external-secrets