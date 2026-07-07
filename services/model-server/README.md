# Model Server — FastAPI Inference Engine

Model Server là **Base Image** cho mọi Model Endpoint của Tenant trong hệ thống AI PaaS. Mỗi mô hình sau khi được đóng gói (build) và triển khai (deploy) sẽ chạy một instance độc lập của service này, phục vụ suy luận (inference) tốc độ cao.

---

## Vai Trò

- **High-Performance Inference**: FastAPI serving endpoint `/models/{model_hashid}/predict` cho mô hình học máy (MLflow Pyfunc, XGBoost, Sklearn...).
- **Dynamic Model Loading**: Tự động tải model từ S3 qua Init Container khi Pod khởi động, không baked vào Docker Image.
- **Decentralized JWT Auth**: Verify JWT RS256 bằng Public Key lấy từ JWKS endpoint của Control Plane — không cần gọi network về Control Plane khi phục vụ request.
- **Event Logging (Async)**: Produce log dữ liệu inference vào Redpanda Kafka (topic: `mlops_paas_production_data`) bất đồng bộ, không ảnh hưởng latency.
- **Label Mapping**: Chuyển đổi output số nguyên của model sang chuỗi text ("DDoS", "BENIGN") dựa vào file label mapping.
- **Prometheus Metrics**: Expose metrics HTTP request count và latency để Prometheus scrape và KEDA autoscale.

---

## Luồng Xử Lý Request

```
POST /{tenant_id}/models/{hashid}/{version}/predict
  → Traefik: verify routing, rewrite path
  → FastAPI: parse Authorization header
  → JWKS verify: decode JWT RS256 (kiểm tra tenant_id, model_id)
  → Validate input features schema
  → Model inference (MLflow Pyfunc / joblib)
  → Label Mapping (optional)
  → Background Task: produce log → Redpanda Kafka
  → Return JSON response
```

---

## Cấu Trúc Thư Mục

```
src/
├── index.py      # FastAPI app: /predict, /health, JWT middleware, Kafka producer
├── loading.py    # Tải model từ S3; hỗ trợ MLflow Pyfunc, .pkl, .joblib, .xgb
└── database.py   # Query PostgreSQL để lấy thông tin ModelAPI, label mapping
```

---

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Framework | FastAPI + Uvicorn |
| ML Runtime | MLflow Pyfunc, XGBoost, Scikit-learn, joblib |
| Auth | `python-jwt` (RS256), JWKS public key caching |
| Event Logging | `confluent-kafka` (Producer) → Redpanda |
| Metrics | `prometheus-fastapi-instrumentator` |
| Hashids | `hashids` (decode `model_hashid` → `model_id`) |

---

## Biến Môi Trường

| Biến | Mô tả |
|---|---|
| `JWKS_URL` | URL lấy Public Key từ Control Plane (mặc định: `http://control-plane:8000/api/auth/.well-known/jwks.json`) |
| `REDPANDA_BROKERS` | Địa chỉ Redpanda broker (mặc định: `localhost:19092`) |
| `KAFKA_TOPIC` | Kafka topic log inference (mặc định: `mlops_paas_production_data`) |
| `MODEL_ID` | ID của model đang được phục vụ |
| `TENANT_ID` | Tenant sở hữu model |
| `REDIS_URL` | Redis để cache JWKS public key |
| `HASHIDS_SALT` | Salt để decode model hashid |

---

## Chú ý

Model file **không được** baked vào Docker Image. Thay vào đó, Argo Workflows inject model artifact URI, và Init Container sẽ tải từ S3 về `emptyDir` volume trước khi container này khởi động.
