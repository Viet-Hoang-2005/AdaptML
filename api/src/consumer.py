import os
import json
import time
import pandas as pd
from confluent_kafka import Consumer, KafkaError
from db_manager import save_dataframe_to_db

# Lấy biến môi trường
REDPANDA_BROKERS = os.environ.get('REDPANDA_BROKERS', 'localhost:19092')
KAFKA_TOPIC = "nids_production_data"

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
        consumer.close()
        print("💤 Consumer cleaned up safely.")

if __name__ == '__main__':
    # Đợi Redpanda khởi động hoàn tất trước khi Consumer nhảy vào kết nối
    print("⏳ Waiting for Redpanda Broker to start...")
    time.sleep(10)
    main()
