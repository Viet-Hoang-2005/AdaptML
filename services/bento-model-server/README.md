# Bento Model Server — Deep Learning Inference Runtime

Bento Model Server là **Base Image** dành riêng cho các mô hình **Deep Learning** (BentoML + MLflow Pyfunc). Service này được sử dụng thay thế `model-server` (FastAPI thuần) khi mô hình cần **Adaptive Batching** — gom nhiều request nhỏ thành batch lớn trước khi đưa vào model inference, tối ưu throughput cho mô hình DL tốn tài nguyên.

---

## Vai Trò

- **BentoML Adaptive Batching**: Tự động gom request từ nhiều client thành batch để tối ưu GPU/CPU utilization.
- **MLflow Pyfunc Inference**: Load model từ `/app/model_artifact` (được inject bởi Init Container từ S3) qua `mlflow.pyfunc.load_model()`.
- **Dual Endpoint**: Hỗ trợ cả BentoML native endpoint (`/predict`) lẫn FastAPI-compatible endpoint (`/models/{model_id_str}/predict`) để tương thích với Traefik IngressRoute routing của Argo deploy pipeline.
- **Async Event Logging**: Produce log inference vào Redpanda Kafka (topic: `mlops_paas_production_data`) bất đồng bộ để phục vụ Data Drift Monitoring qua Evidently AI.

---

## Luồng Xử Lý

```
POST /models/{model_id_str}/predict  (FastAPI-compatible)
  hoặc
POST /predict  (BentoML native)

  → Nhận input Dict[str, Any] (features dưới dạng dict hoặc list)
  → Tạo Pandas DataFrame từ features
  → model.predict(df) — MLflow Pyfunc runner
  → Produce log JSON bất đồng bộ → Redpanda topic
  → Return {"success": True, "prediction": [...]}
```

---

## Cấu Trúc Thư Mục

```
src/
└── index.py    # BentoML Service class: predict, health; Kafka producer; model loading
```

---

## Sự khác biệt so với model-server (FastAPI)

| Tính năng | model-server (FastAPI) | bento-model-server (BentoML) |
|---|---|---|
| **Dùng cho** | Mô hình truyền thống (sklearn, XGBoost) | Mô hình Deep Learning nặng |
| **Batching** | Không có, xử lý từng request | Adaptive Batching tự động |
| **Auth JWT** | Có, verify tại FastAPI middleware | Không (auth ở Traefik/gateway) |
| **BentoML** | Không | Có (`@bentoml.service`, `@bentoml.api`) |

---

## Biến Môi Trường

| Biến | Mô tả |
|---|---|
| `REDPANDA_BROKERS` | Địa chỉ Redpanda broker (mặc định: `redpanda:9092`) |
| `KAFKA_TOPIC` | Kafka topic log inference (mặc định: `mlops_paas_production_data`) |
| `TENANT_ID` | Tenant sở hữu model (inject bởi Argo deploy workflow) |
| `MODEL_ID` | ID của model đang phục vụ |

---

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Serving Framework | BentoML 1.x |
| ML Runtime | MLflow Pyfunc |
| Event Logging | `confluent-kafka` (Producer) → Redpanda |
| HTTP Compat | FastAPI ASGI app mounted vào BentoML service |
