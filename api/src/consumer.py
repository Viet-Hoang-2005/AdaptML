import os
import json
import time
import requests
import pandas as pd
from confluent_kafka import Consumer, KafkaError
from db_manager import save_dataframe_to_db, get_production_data_count

# Lấy biến môi trường
REDPANDA_BROKERS = os.environ.get('REDPANDA_BROKERS', 'localhost:19092')
KAFKA_TOPIC = "nids_production_data"
EVIDENTLY_TRIGGER_THRESHOLD = int(os.environ.get('EVIDENTLY_TRIGGER_THRESHOLD', '100'))
GITHUB_REPO = os.environ.get("GITHUB_REPO", "")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

def trigger_github_webhook(count: int):
    """Gửi Webhook kích hoạt GitHub Action Evidently Drift Check."""
    print(f"🚀 Data count reached {count} (threshold: {EVIDENTLY_TRIGGER_THRESHOLD}). Triggering GitHub webhook...")

    if not GITHUB_TOKEN or not GITHUB_REPO:
        print("⚠️ GITHUB_TOKEN or GITHUB_REPO not configured - skipping webhook.")
        return

    url = f"https://api.github.com/repos/{GITHUB_REPO}/dispatches"
    
    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
    }
    payload = {
        "event_type": "trigger_drift_check",
        "client_payload": {
            "trigger_source": "redpanda_consumer",
            "current_data_count": count
        }
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        if response.status_code == 204:
            print("✅ Webhook sent successfully! GitHub Actions has been triggered.")
        else:
            print(f"❌ Webhook failed! HTTP {response.status_code}: {response.text}")
    except Exception as e:
        print(f"❌ Error sending webhook: {e}")

def check_threshold_and_trigger(last_triggered_count: int) -> int:
    """Kiểm tra số lượng và gọi webhook nếu vượt ngưỡng. Trả về last_triggered_count mới."""
    count = get_production_data_count()
    diff = count - last_triggered_count
    print(f"📈 Drift monitoring: {count} total rows. New rows since last trigger: {diff}/{EVIDENTLY_TRIGGER_THRESHOLD}")
    
    if diff >= EVIDENTLY_TRIGGER_THRESHOLD:
        trigger_github_webhook(count)
        return count
    return last_triggered_count

def main():
    # Cấu hình Kafka Consumer
    conf = {
        'bootstrap.servers': REDPANDA_BROKERS,
        'group.id': 'nids-db-writer-group',
        'auto.offset.reset': 'earliest',
        'enable.auto.commit': False  # Tự quản lý commit để tránh mất data nếu crash giữa chừng
    }

    consumer = Consumer(conf)
    consumer.subscribe([KAFKA_TOPIC])

    print(f"🎧 Consumer listening to the topic '{KAFKA_TOPIC}' at {REDPANDA_BROKERS}")

    BATCH_SIZE = 500  # Số lượng gom nhóm tối đa trước khi Write DB
    current_batch = []
    last_triggered_count = get_production_data_count() # Lấy số lượng ban đầu để tránh trigger ngay lúc bật
    print(f"📊 Initial DB record count: {last_triggered_count}")
    
    try:
        while True:
            # Liên tục lắng nghe (poll) với timeout 1 giây
            msg = consumer.poll(timeout=1.0)
            
            # Khởi động cơ chế "Flush on Idle":
            # Nếu không có message nào mới, nhưng trong giỏ (current_batch) vẫn còn dữ liệu tệp cũ,
            # thì mang đi insert luôn thay vì đợi đến khi đủ BATCH_SIZE
            if msg is None:
                if len(current_batch) > 0:
                    df = pd.DataFrame(current_batch)
                    # Chuyển đổi chuỗi text created_at (isoformat) lại thành DateTime object chuẩn pandas
                    if 'created_at' in df.columns:
                        df['created_at'] = pd.to_datetime(df['created_at'])
                        
                    if save_dataframe_to_db(df, "nids_production_data"):
                        consumer.commit() # Chỉ commit khi đã lưu thẳng vào Database thành công
                        print(f"✅ Flushed {len(current_batch)} records to DB due to idle time.")
                        last_triggered_count = check_threshold_and_trigger(last_triggered_count)
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
                    df = pd.DataFrame(current_batch)
                    if 'created_at' in df.columns:
                        df['created_at'] = pd.to_datetime(df['created_at'])
                        
                    if save_dataframe_to_db(df, "nids_production_data"):
                        consumer.commit()
                        print(f"📦 Completed batch delivery: {len(current_batch)} records to DB.")
                        last_triggered_count = check_threshold_and_trigger(last_triggered_count)
                    current_batch = []
                    
            except Exception as parse_e:
                print(f"⚠️ Error parsing payload: {parse_e}")
                
    except KeyboardInterrupt:
        print("🛑 Received shutdown command...")
    finally:
        # Xử lý tàn dư nếu bị tắt khẩn cấp
        if len(current_batch) > 0:
            df = pd.DataFrame(current_batch)
            if 'created_at' in df.columns:
                df['created_at'] = pd.to_datetime(df['created_at'])
            if save_dataframe_to_db(df, "nids_production_data"):
                consumer.commit()
                last_triggered_count = check_threshold_and_trigger(last_triggered_count)
        consumer.close()
        print("💤 Consumer cleaned up safely.")

if __name__ == '__main__':
    # Đợi Redpanda khởi động hoàn tất trước khi Consumer nhảy vào kết nối
    print("⏳ Waiting for Redpanda Broker to start...")
    time.sleep(10)
    main()
