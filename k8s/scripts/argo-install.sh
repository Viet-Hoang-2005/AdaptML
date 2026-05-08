#!/bin/bash
# argo-install.sh: Cài đặt ArgoCD lên K3s cluster
set -e

# Bước 1: Tạo namespace argocd
echo "[1/7] Creating argocd namespace..."
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -

# Bước 2: Cài đặt ArgoCD bằng manifest chính thức
echo "[2/7] Installing ArgoCD..."
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Bước 3: Cấu hình RBAC (Least Privilege)
echo "[3/7] Applying RBAC configuration (Account: github-actions)..."
kubectl apply -f k8s/argocd/rbac.yaml

# Bước 4: Chờ ArgoCD Server sẵn sàng
echo "[4/7] Waiting for ArgoCD Server to be ready..."
kubectl rollout status deployment/argocd-server -n argocd --timeout=300s

# Bước 5: Apply Application resources
echo "[5/7] Applying ArgoCD Application manifests..."
kubectl apply -f k8s/argocd/application.yaml
kubectl apply -f k8s/argocd/application-jobs.yaml

# Bước 6: Tạo API Token cho tài khoản GIỚI HẠN github-actions
echo "[6/7] Generating LIMITED API Token for github-actions account..."

# Lấy initial admin password để đăng nhập
ARGOCD_PASSWORD=$(kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 --decode)

# Port-forward để login và tạo token
kubectl port-forward svc/argocd-server -n argocd 8080:443 > /dev/null 2>&1 &
PF_PID=$!
sleep 5

# Đăng nhập bằng admin để tạo token cho account github-actions
argocd login localhost:8080 --username admin --password "$ARGOCD_PASSWORD" --insecure --grpc-web > /dev/null 2>&1

# Tạo token cho đúng account github-actions
ARGOCD_TOKEN=$(argocd account generate-token --account github-actions --expires-in 8760h)

kill $PF_PID 2>/dev/null || true

echo "[7/7] ArgoCD Installation Complete!"
echo "Dashboard URL   : https://argocd.mlops-nids-nt114.id.vn"
echo "Admin password  : $ARGOCD_PASSWORD"
echo "ARGOCD_TOKEN    : $ARGOCD_TOKEN"
echo "IMPORTANT! Change your password immediately after your first login"