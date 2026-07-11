# Consumer — Production Data Ingestion Worker

Consumer là một **Background Worker** chạy liên tục, đóng vai trò trung gian giữa Event Stream (Redpanda Kafka) và Cơ sở dữ liệu dài hạn (PostgreSQL). Nó thực hiện **Micro-Batching** để ghi dữ liệu inference log hiệu quả và đồng thời giám sát ngưỡng để kích hoạt Drift Detection.

---

## Vai Trò

- **Kafka Consumer**: Lắng nghe liên tục topic `mlops_paas_production_data` từ Redpanda.
- **Micro-Batching**: Gom nhiều message vào buffer, chỉ `INSERT` vào PostgreSQL khi:
  - Đạt kích thước batch tối đa, **hoặc**
  - Vượt thời gian chờ idle (idle timeout).
- **Schema-Flexible Storage**: Lưu `features` dạng `JSONB` (hỗ trợ mọi số lượng features khác nhau giữa các mô hình), `prediction` dạng `TEXT`.
- **Drift Threshold Monitoring**: Sau mỗi batch INSERT, kiểm tra xem số lượng production data của từng model có vượt ngưỡng drift chưa. Nếu có → gửi Webhook về Control Plane để kích hoạt Evidently Drift Job.
- **At-Least-Once Delivery**: Kafka Offset chỉ được commit **sau khi** INSERT thành công vào DB — không bao giờ mất dữ liệu khi crash.

---

## Luồng Hoạt Động

```
Redpanda (topic: mlops_paas_production_data)
  → Consumer subscribe, poll message
  → Gom buffer (Micro-batching)
  → build_dataframe(records) → pandas DataFrame
  → save_dataframe_to_db()  → PostgreSQL (JSONB features + TEXT prediction)
  → consumer.commit()  (sau khi INSERT thành công)
  → check_threshold_and_trigger()
      → Nếu diff >= threshold → POST webhook → Control Plane
```

---

## Cấu Trúc Thư Mục

```
src/
├── main.py       # Consumer loop: subscribe, poll, batch, commit, threshold check
└── database.py   # PostgreSQL helpers: save_dataframe_to_db, get_production_data_count_by_model, get_model_drift_thresholds
```

---

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Message Broker | Redpanda (Kafka-compatible), `confluent-kafka` |
| Database | PostgreSQL + `psycopg2` / SQLAlchemy |
| Batch Processing | `pandas` DataFrame → `to_sql` bulk insert |

---

## Biến Môi Trường

| Biến | Mô tả |
|---|---|
| `REDPANDA_BROKERS` | Địa chỉ Redpanda broker (mặc định: `localhost:19092`) |
| `KAFKA_TOPIC` | Topic lắng nghe (mặc định: `mlops_paas_production_data`) |
| `CONTROL_PLANE_WEBHOOK_URL` | URL webhook kích hoạt drift check |
| `CONTROL_PLANE_WEBHOOK_SECRET` | Secret header xác thực webhook |
| `EVIDENTLY_TRIGGER_THRESHOLD` | Ngưỡng mặc định (mặc định: `100` rows) |
| `DB_USER`, `DB_PASSWORD`, `DB_HOST_RW`, `DB_PORT`, `DB_NAME` | PostgreSQL connection |

---

## Chạy Local

```bash
docker compose up consumer
```

Consumer sẽ tự động connect Redpanda và bắt đầu consume. Nếu Redpanda chưa sẵn sàng, nó sẽ retry.
