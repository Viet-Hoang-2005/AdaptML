---
name: mlops-paas-lifecycle
description: Vòng đời của mô hình AI PaaS: User Upload, Build Image (Kaniko/Docker), Deploy API động qua Traefik, Drift Detection qua Argo Workflows, và Quản lý phiên bản.
---

# Luồng Vòng Đời Mô Hình (AI PaaS Model Lifecycle)

> Đọc skill `mlops-paas-architecture` trước để nắm kiến trúc tổng thể.

---

## 1. Upload & Build Image

1. **Upload**: Tenant đăng nhập Dashboard (ReactJS), upload model (ZIP chứa MLflow artifact) hoặc train trước rồi dùng artifact từ S3.
2. **S3 Storage**: Django lưu artifact lên S3, tạo bản ghi `ModelAPI` với trạng thái `uploading`.
3. **Trigger Build**: Control Plane gọi `get_build_adapter()` → dựa vào `BUILD_STRATEGY` env:
   - `docker` (local): `DockerBuildAdapter` → chạy container `model-packager` qua Docker SDK
   - `argo` (production): `ArgoBuildAdapter` → POST webhook `/build` tới Argo Events
4. **model-packager** xử lý:
   - Tải artifact từ S3
   - Chuẩn hóa sang MLflow Pyfunc format
   - Sinh `Dockerfile` + `requirements.txt` vào `/workspace`
   - Kaniko (production) build và push image lên Harbor
5. **Webhook callback**: model-packager gửi `POST /api/models/{id}/build-webhook` với `status=success/error`
6. **Control Plane**: cập nhật `ModelAPI.status = "ready"`, lưu `endpoint_image_name`

---

## 2. Deploy Model Endpoint

1. User bấm Deploy từ Dashboard.
2. Control Plane gọi `get_deploy_adapter()` → dựa vào `BUILD_STRATEGY`:
   - `docker` (local): `DockerDeployAdapter` → `docker run` image model-server, tạo Traefik route qua dynamic config
   - `argo` (production): `ArgoDeployAdapter` → POST webhook `/deploy` tới Argo Events
3. **deploy-workflowtemplate** dùng `bitnami/kubectl` để `kubectl apply`:
   - `Deployment` (Pod chạy FastAPI model-server)
   - `Service` (port 5000)
   - `Middleware` (Traefik RewritePath)
   - `IngressRoute` (Traefik) với rule: `PathPrefix(/{tenant_id}/models/{hashid}/{version}/predict)`
4. Control Plane nhận webhook callback, cập nhật `endpoint_url`

---

## 3. Inference

Client gọi:
```
POST /{tenant_id}/models/{model_hashid}/{version}/predict
Authorization: Bearer <JWT_API_KEY>
```
Traefik xác định IngressRoute → rewrite path → forward tới `model-server` Pod.

`model-server` (FastAPI):
1. Verify JWT bằng Public Key từ JWKS endpoint (`/api/auth/.well-known/jwks.json`)
2. Validate input features theo schema của model
3. Chạy inference (MLflow Pyfunc)
4. Map output bằng Label Mapping (nếu có)
5. Produce log bất đồng bộ vào Redpanda Kafka (topic: `mlops_paas_production_data`)
6. Return kết quả JSON

`consumer` service:
- Consume batch từ Redpanda
- INSERT vào PostgreSQL với `features` JSONB và `prediction` TEXT

---

## 4. Drift Detection

1. Tenant cấu hình Drift Job từ Dashboard (chọn model, threshold, lịch chạy).
2. Control Plane POST webhook `/drift` tới Argo Events.
3. **evidently-workflowtemplate** chạy container `evidently`:
   - Tải Reference Data từ S3 (URL presigned)
   - Query Production Logs từ PostgreSQL (`model_id = ?`)
   - Chạy Evidently AI DataDrift analysis
   - Upload HTML Report + JSON Summary lên S3
   - POST webhook về Control Plane kèm `drift_score`, S3 report URLs
4. Control Plane cập nhật `DriftJob` status, lưu report URLs

---

## 5. Xóa Mô hình

1. User xóa model từ Dashboard.
2. Control Plane:
   - Gọi Harbor API xóa Docker Image
   - POST webhook `/delete` tới Argo Events
3. **delete-workflowtemplate** `kubectl delete`:
   - `Deployment`, `Service`, `Middleware`, `IngressRoute`
4. Django xóa bản ghi `ModelAPI` khỏi PostgreSQL

---

## 6. Model Versioning

- Mỗi lần Build thành công tạo ra một `Registry Version` trong MLflow (proxy qua Django).
- Django API đóng vai trò **MLflow Proxy** đứng trước để đảm bảo Tenant chỉ thấy được phiên bản model của mình (`tenant_id` lọc tại ORM layer).
- `model_hashid` trong URL dùng Hashids library để mã hóa `model_id` thành chuỗi ngắn thân thiện.
