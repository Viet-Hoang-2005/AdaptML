#!/usr/bin/env bash
set -euo pipefail

VERSION="${KUBEFLOW_TRAINING_OPERATOR_VERSION:-v1.7.0}"

echo "Installing Kubeflow Training Operator CRDs and standalone manifests (${VERSION})..."
kubectl apply --server-side -k "github.com/kubeflow/training-operator/manifests/overlays/standalone?ref=${VERSION}"

echo "Waiting for training-operator deployment..."
kubectl -n kubeflow rollout status deployment/training-operator --timeout=180s

echo "Kubeflow Training Operator is ready."
