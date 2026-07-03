#!/bin/bash
# monitoring-install.sh: Cài đặt Prometheus + Grafana lên K3s qua Helm

set -e

NAMESPACE="monitoring"
RELEASE_NAME="monitoring"

echo "[1/2] Add Helm repo prometheus-community..."
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

echo "[2/2] Install kube-prometheus-stack (Prometheus + Grafana + node-exporter + kube-state-metrics)..."
helm upgrade --install ${RELEASE_NAME} prometheus-community/kube-prometheus-stack \
  --namespace ${NAMESPACE} \
  --create-namespace \
  --set prometheus.prometheusSpec.retention=3d \
  --set prometheus.prometheusSpec.scrapeInterval=30s \
  --set prometheus.prometheusSpec.resources.limits.memory=1500Mi \
  --set "prometheus.prometheusSpec.nodeSelector.workload-type=worker" \
  --set "prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.storageClassName=local-path" \
  --set "prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage=10Gi" \
  --set grafana.persistence.enabled=true \
  --set "grafana.nodeSelector.workload-type=worker" \
  --set grafana.persistence.storageClassName=local-path \
  --set grafana.persistence.size=5Gi \
  --set grafana.service.type=ClusterIP \
  --set "alertmanager.alertmanagerSpec.nodeSelector.workload-type=worker" \
  --set "prometheusOperator.nodeSelector.workload-type=worker" \
  --set "kube-state-metrics.nodeSelector.workload-type=worker" \
  --set "grafana.grafana\\.ini.server.root_url=https://grafana.mlops-nids-nt114.id.vn" \
  --set "grafana.grafana\\.ini.server.serve_from_sub_path=false" \
  --set alertmanager.alertmanagerSpec.storage.volumeClaimTemplate.spec.storageClassName=local-path \
  --set alertmanager.alertmanagerSpec.storage.volumeClaimTemplate.spec.resources.requests.storage=2Gi \
  --set "prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues=false" \
  --set "prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false" \
  --set "prometheus.prometheusSpec.ruleSelectorNilUsesHelmValues=false" \
  --set prometheusOperator.admissionWebhooks.enabled=false \
  --set prometheusOperator.tls.enabled=false \
  --timeout 10m \
  --wait

echo "Prometheus & Grafana installation completed!"
kubectl get pods -n ${NAMESPACE}
