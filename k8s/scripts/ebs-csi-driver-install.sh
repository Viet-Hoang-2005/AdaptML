#!/usr/bin/env bash
# install-ebs-csi-driver.sh: Cài đặt AWS EBS CSI Driver vào K3s Cluster
# Giải quyết lỗi PVC ebs-gp3 bị Pending do thiếu Provisioner 'ebs.csi.aws.com'
set -euo pipefail

export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"

# 1. Thêm Helm Repo chính thức của AWS EBS CSI Driver
echo "[1/3] Add Helm repository 'aws-ebs-csi-driver'..."
helm repo add aws-ebs-csi-driver https://kubernetes-sigs.github.io/aws-ebs-csi-driver
helm repo update aws-ebs-csi-driver

# 2. Cài đặt hoặc cập nhật AWS EBS CSI Driver vào namespace 'kube-system'
echo "[2/3] Installing AWS EBS CSI Driver Controller & DaemonSet..."
helm upgrade --install aws-ebs-csi-driver aws-ebs-csi-driver/aws-ebs-csi-driver \
  --namespace kube-system \
  --set controller.replicaCount=1 \
  --set controller.nodeSelector."workload-type"=worker \
  --set node.tolerations[0].operator="Exists" \
  --set storageClasses[0].name="ebs-gp3" \
  --set storageClasses[0].volumeBindingMode="WaitForFirstConsumer" \
  --set storageClasses[0].reclaimPolicy="Delete" \
  --set storageClasses[0].allowVolumeExpansion=true \
  --set storageClasses[0].parameters.type="gp3" \
  --set storageClasses[0].parameters.fsType="ext4" \
  --set storageClasses[0].annotations."storageclass\.kubernetes\.io/is-default-class"="false"

echo "[3/3] Waiting for EBS CSI Controller Pod to start successfully..."
kubectl wait --namespace kube-system \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/name=aws-ebs-csi-driver \
  --timeout=120s

echo "INSTALLATION COMPLETED! AWS EBS CSI DRIVER IS READY"
