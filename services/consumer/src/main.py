# consumer.py: Consumer liên tục lắng nghe Redpanda, gom nhóm dữ liệu, và lưu vào PostgreSQL
import os
import json
import time
import requests
import signal
import pandas as pd
from confluent_kafka import Consumer, KafkaError
from src.database import save_dataframe_to_db, get_production_data_count_by_model, get_model_drift_thresholds

# Lấy biến môi trường
REDPANDA_BROKERS = os.environ.get('REDPANDA_BROKERS', 'localhost:19092')
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC", "mlops_paas_production_logs")
EVIDENTLY_TRIGGER_THRESHOLD = int(os.environ.get('EVIDENTLY_TRIGGER_THRESHOLD', '100'))
WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "http://control_plane:8000/api/v1/internal/trigger-drift-job")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "super-secret-key")

# Cờ báo hiệu trạng thái hoạt động
RUNNING = True

# Hàm xử lý tín hiệu dừng
def handle_sigterm(*args):
    global RUNNING
    print("Received SIGTERM. Shutting down gracefully...")
    RUNNING = False

# Hàm gửi Webhook cảnh báo về Django Control Plane để kích hoạt Argo Workflows / Celery
def trigger_django_webhook(model_name: str, count: int):
    print(f"[{model_name}] Triggering Django webhook for drift check...")

    headers = {
        "Authorization": f"Bearer {WEBHOOK_SECRET}",
        "Content-Type": "application/json"
    }
    payload = {
        "event_type": "trigger_drift_check",
        "model_id": model_name,
        "current_data_count": count
    }

    try:
        response = requests.post(WEBHOOK_URL, headers=headers, json=payload, timeout=10)
        if response.status_code in [200, 201, 204]:
            print(f"[{model_name}] Webhook sent Successfully! Django has been notified.")
        else:
            print(f"[{model_name}] Webhook failed! HTTP {response.status_code}: {response.text}")
    except Exception as e:
        print(f"[{model_name}] Error sending webhook: {e}")

# Hàm kiểm tra và gọi webhook nếu Production Data vượt ngưỡng
def check_threshold_and_trigger(last_triggered_counts: dict, df_batch: pd.DataFrame) -> dict:
    """Kiểm tra số lượng và gọi webhook nếu vượt ngưỡng. Trả về last_triggered_counts mới."""
    if df_batch is None or df_batch.empty or 'model_id' not in df_batch.columns:
        return last_triggered_counts

    thresholds = get_model_drift_thresholds()
    unique_models = df_batch['model_id'].dropna().unique()
    
    for model_name in unique_models:
        threshold = thresholds.get(model_name)
        if not threshold:
            continue
            
        count = get_production_data_count_by_model(model_name)
        last_count = last_triggered_counts.get(model_name, 0)
        diff = count - last_count
        
        print(f"Drift monitoring [{model_name}]: {count} total rows. New rows since last trigger: {diff}/{threshold}")
        
        if diff >= threshold:
            trigger_django_webhook(model_name, count)
            last_triggered_counts[model_name] = count
            
    return last_triggered_counts

def build_batch_dataframe(records: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(records)
    for column in ("timestamp", "created_at"):
        if column in df.columns:
            df[column] = pd.to_datetime(df[column], utc=True, errors="coerce")
    return df

# Hàm main để chạy Consumer liên tục lắng nghe Redpanda và xử lý dữ liệu
def main():
    # Đăng ký handler cho SIGTERM và SIGINT
    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGINT, handle_sigterm)

    # Cấu hình Kafka Consumer
    conf = {
        'bootstrap.servers': REDPANDA_BROKERS,
        'group.id': 'paas-db-writer-group',
        'auto.offset.reset': 'earliest',
        'enable.auto.commit': False  # Tự quản lý commit để tránh mất data nếu crash giữa chừng
    }

    # Khởi tạo Consumer và subscribe vào topic
    consumer = Consumer(conf)
    consumer.subscribe([KAFKA_TOPIC])

    print(f"Consumer listening to the topic '{KAFKA_TOPIC}' at {REDPANDA_BROKERS}")

    BATCH_SIZE = 500  # Số lượng gom nhóm tối đa trước khi Write DB
    current_batch = []
    last_triggered_counts = {} # Khởi tạo tracking số lượng theo từng model
    print("Initial tracking dictionary initialized.")

    try:
        while RUNNING:
            # Liên tục lắng nghe (poll) với timeout 1 giây
            msg = consumer.poll(timeout=1.0)
            
            # Cơ chế "Flush on Idle": Nếu không có message mới nào trong 1 giây, tự động flush batch hiện tại vào DB.
            if msg is None:
                if len(current_batch) > 0:
                    df = build_batch_dataframe(current_batch)
                    # Chuyển đổi chuỗi text created_at (isoformat) lại thành DateTime object chuẩn pandas
                    if save_dataframe_to_db(df, "paas_production_logs"):
                        consumer.commit() # Chỉ commit khi đã lưu thẳng vào Database thành công
                        print(f"Flushed {len(current_batch)} records to DB due to idle time.")
                        last_triggered_counts = check_threshold_and_trigger(last_triggered_counts, df)
                    current_batch = []
                continue
                
            # Xử lý lỗi Kafka
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                else:
                    print(msg.error())
                    break
                    
            try:
                # Đọc payload từ API và parse lại thành Dictionary
                val_json = msg.value().decode('utf-8')
                row_data = json.loads(val_json)
                current_batch.append(row_data)
                
                # Gom đủ một hộp (BATCH) thì mang đi phân phối
                if len(current_batch) >= BATCH_SIZE:
                    df = build_batch_dataframe(current_batch)
                    if save_dataframe_to_db(df, "paas_production_logs"):
                        consumer.commit()
                        print(f"Completed batch delivery: {len(current_batch)} records to DB.")
                        last_triggered_counts = check_threshold_and_trigger(last_triggered_counts, df)
                    current_batch = []
                    
            except Exception as parse_e:
                print(f"Error parsing payload: {parse_e}")
                
    except KeyboardInterrupt:
        print("Received shutdown command...")
    finally:
        # Trước khi đóng Consumer, nếu còn dữ liệu trong batch thì cũng nên flush nốt vào DB để tránh mất mát dữ liệu cuối cùng.
        if len(current_batch) > 0:
            df = build_batch_dataframe(current_batch)
            if save_dataframe_to_db(df, "paas_production_logs"):
                consumer.commit()
                last_triggered_counts = check_threshold_and_trigger(last_triggered_counts, df)
        consumer.close()
        print("Consumer cleaned up safely.")

if __name__ == '__main__':
    # Đợi Redpanda khởi động hoàn tất trước khi Consumer nhảy vào kết nối
    print("Waiting for Redpanda Broker to start...")
    time.sleep(5)
    main()
