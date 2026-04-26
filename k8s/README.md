# Kubernetes

Các manifest Kubernetes để triển khai hệ thống trên K3s.

- `api-deployment.yaml`: deployment và service cho FastAPI.
- `consumer-deployment.yaml`: deployment cho consumer của RedPanda.
- `postgres-cluster.yaml`: cụm CloudNativePG.
- `redpanda-deployment.yaml`: broker RedPanda.
- `evidently-job.yaml`: job quét drift theo yêu cầu.
- `mlflow-deployment.yaml`: dịch vụ MLflow.
- `sync-job.yaml`: job đồng bộ reference data.
- `init-mlflow-db.yaml`: job khởi tạo database cho MLflow.
