---
name: mlops-paas-testing
description: Phương pháp kiểm thử AI PaaS: Tenant Isolation, JWT RS256 validation, Build Pipeline (Docker/Kaniko), Training Job flow, và Drift Detection.
---

# Phương pháp Kiểm thử Nền tảng AI PaaS

> Đọc skill `mlops-paas-architecture` trước để nắm kiến trúc tổng thể.

---

## 1. Kiểm thử Cách Ly Người Dùng (Tenant Isolation)

**Data Isolation**:
- Đăng nhập với Tenant A, thử truy cập API với `model_id` thuộc Tenant B → phải nhận `403 Forbidden`
- Verify Django ORM filter đúng theo `tenant_id` trong mọi ViewSet

**Endpoint Isolation**:
- Tenant A dùng API Key (JWT) của mình gọi endpoint của Tenant B → phải nhận `401 Unauthorized`
- FastAPI model-server verify `model_id` trong JWT payload phải khớp với model đang chạy

**K8s Resource Isolation**:
- Mỗi model deployment có `resources.requests` và `resources.limits` riêng
- Tenant A không thể ảnh hưởng tài nguyên của Tenant B (Noisy Neighbor protection)

---

## 2. Kiểm thử JWT RS256

Kiểm thử end-to-end:
1. Lấy `access_token` từ `POST /api/auth/login/`
2. Dùng token đó gọi `POST /{tenant_id}/models/{hashid}/{version}/predict`
3. Verify response 200

Kiểm thử các trường hợp biên:
- Token hết hạn (`exp` đã qua) → 401
- Token bị chỉnh sửa (signature lỗi) → 401
- Token `model_id` không khớp endpoint đang phục vụ → 403
- JWKS endpoint không khả dụng → FastAPI phải dùng cached public key (fallback)

---

## 3. Kiểm thử Build Pipeline

**Local (BUILD_STRATEGY=docker)**:
```bash
# Test DockerBuildAdapter trực tiếp
POST /api/models/ (upload model ZIP)
# Kiểm tra container model-packager được spawn
docker ps | grep build_
# Kiểm tra webhook callback
GET /api/models/{id}/ → status="ready"
```

**Production (BUILD_STRATEGY=argo)**:
```bash
# Xem Argo Workflow được kích hoạt
kubectl get workflows -n default
# Xem từng bước của pipeline
kubectl get pods -n default | grep build-model-job
# Verify 3 bước: prepare-package, kaniko-build, notify-success
```

---

## 4. Kiểm thử Training Job

**Local (TRAINING_BACKEND=local)**:
- Submit training job với script đơn giản (ví dụ trong `examples/training/nids-xgboost/`)
- Verify log stream qua `GET /api/training-jobs/{id}/logs/`
- Verify file `model.tar.gz` được upload lên S3 sau khi hoàn tất

**Production (TRAINING_BACKEND=kubeflow)**:
- Verify Argo Workflow được tạo sau khi submit Training Job
- Verify PyTorchJob CRD xuất hiện trong namespace `user-jobs`
- Verify Karpenter provision node khi Job đang Pending (nếu không có node sẵn)
- Verify webhook callback cập nhật status về Control Plane

---

## 5. Kiểm thử Drift Detection

- Kích hoạt Drift Job từ Dashboard
- Verify Argo Workflow `evidently-job-*` được tạo
- Verify HTML report và JSON summary được upload lên S3
- Verify webhook callback cập nhật DriftJob status
- Test với dataset có drift rõ ràng → `drift_score >= threshold`
- Test với dataset tương tự reference → `drift_score < threshold`

---

## 6. Stress Test (Noisy Neighbor)

Dùng Locust để tạo traffic lớn vào model của Tenant A:
- Đo latency của Tenant B → phải không bị ảnh hưởng đáng kể
- Kiểm tra Pod của Tenant A bị OOMKilled (nếu cố tình dùng quá memory limit) nhưng Pod của Tenant B vẫn chạy bình thường
- Verify KEDA Scale-Out hoạt động đúng khi traffic tăng cao

---

## 7. Test Script Django (Unit Tests)

Chạy test suite của Control Plane:
```bash
cd services/control-plane
docker compose run control-plane python manage.py test
```

File test: `services/control-plane/src/registry/tests.py`
