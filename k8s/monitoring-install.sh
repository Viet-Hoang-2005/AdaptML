#!/bin/bash
# monitoring-install.sh: Cài đặt Prometheus + Grafana lên K3s qua Helm
# Chạy từ máy có kết nối kubectl đến cluster
set -e

NAMESPACE="monitoring"
RELEASE_NAME="monitoring"
GRAFANA_PASSWORD=$(kubectl get secret -n default mlflow-basic-auth -o jsonpath='{.data.auth}' | base64 -d | cut -d':' -f2 2>/dev/null || echo "admin")

echo "[1/3] Add Helm repo prometheus-community..."
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

echo "[2/3] Install kube-prometheus-stack (Prometheus + Grafana + node-exporter + kube-state-metrics)..."
helm upgrade --install ${RELEASE_NAME} prometheus-community/kube-prometheus-stack \
  --namespace ${NAMESPACE} \
  --create-namespace \
  --set grafana.adminPassword="${GRAFANA_PASSWORD}" \
  --set prometheus.prometheusSpec.retention=15d \
  --set prometheus.prometheusSpec.scrapeInterval=15s \
  --set "prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.storageClassName=local-path" \
  --set "prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage=10Gi" \
  --set grafana.persistence.enabled=true \
  --set grafana.persistence.storageClassName=local-path \
  --set grafana.persistence.size=5Gi \
  --set grafana.service.type=ClusterIP \
  --set "grafana.grafana\\.ini.server.root_url=https://grafana.mlops-nids-nt114.id.vn" \
  --set "grafana.grafana\\.ini.server.serve_from_sub_path=false" \
  --set alertmanager.alertmanagerSpec.storage.volumeClaimTemplate.spec.storageClassName=local-path \
  --set alertmanager.alertmanagerSpec.storage.volumeClaimTemplate.spec.resources.requests.storage=2Gi \
  --set "prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues=false" \
  --set "prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false" \
  --set "prometheus.prometheusSpec.ruleSelectorNilUsesHelmValues=false" \
  --timeout 10m \
  --wait

echo "[3/3] Installation completed!"
kubectl get pods -n ${NAMESPACE}
