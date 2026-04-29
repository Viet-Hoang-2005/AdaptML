#!/bin/bash
# k8s/eso-install.sh: Cài đặt External Secrets Operator vào cụm K3s bằng Helm

echo "Start installing External Secrets Operator (ESO)..."

# Thêm kho chứa Helm của ESO
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

# Cài đặt ESO vào namespace external-secrets
helm install external-secrets \
   external-secrets/external-secrets \
    -n external-secrets \
    --create-namespace \
    --set installCRDs=true

echo "ESO installation complete! Run the command 'kubectl get pods -n external-secrets' to check."
