#!/bin/bash
# argo-install.sh: Cài đặt ArgoCD lên K3s cluster
set -e

# Bước 1: Tạo namespace argocd
echo "[1/6] Creating argocd namespace..."
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -

# Bước 2: Cài đặt ArgoCD bằng manifest chính thức
echo "[2/6] Installing ArgoCD..."
kubectl apply --server-side -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Bước 3: Cấu hình RBAC (Least Privilege)
echo "[3/6] Applying RBAC configuration (Account: github-actions)..."
kubectl apply -f k8s/argocd/rbac.yaml

# Bước 4: Gắn nodeSelector để ArgoCD chạy trên Worker Node
echo "[4/6] Patching ArgoCD deployments to run on worker nodes..."
for deploy in argocd-server argocd-repo-server argocd-dex-server argocd-redis argocd-applicationset-controller argocd-notifications-controller; do
  kubectl patch deployment $deploy -n argocd -p '{"spec": {"template": {"spec": {"nodeSelector": {"workload-type": "worker"}}}}}' || true
done
kubectl patch statefulset argocd-application-controller -n argocd -p '{"spec": {"template": {"spec": {"nodeSelector": {"workload-type": "worker"}}}}}' || true

# Bước 5: Chờ ArgoCD Server sẵn sàng
echo "[5/6] Waiting for ArgoCD Server to be ready..."
kubectl rollout status deployment/argocd-server -n argocd --timeout=300s

# Bước 6: Apply Application resources
echo "[6/6] Applying ArgoCD Application manifests..."
kubectl apply -f k8s/argocd/application.yaml

# Bước 7: Lấy initial admin password
ARGOCD_PASSWORD=$(kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 --decode)

echo "ArgoCD installation complete!"
echo "Dashboard URL   : https://argocd.mlops-nids-nt114.id.vn"
echo "Admin password  : $ARGOCD_PASSWORD"
kubectl get pods -n argocd