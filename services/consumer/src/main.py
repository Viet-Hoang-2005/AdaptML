import os
import json
import time
import requests
import signal
from dataclasses import dataclass
from typing import Any
import pandas as pd
from confluent_kafka import Consumer, KafkaError, TopicPartition
from src.database import (
    get_model_drift_thresholds,
    get_production_data_count_by_model_version,
    init_db,
    save_dataframe_to_db,
)

# Lấy biến môi trường
REDPANDA_BROKERS = os.environ.get('REDPANDA_BROKERS', 'localhost:19092')
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC", "mlops_paas_production_data")
KAFKA_TOPIC_RETRY_SECONDS = max(1, int(os.environ.get("KAFKA_TOPIC_RETRY_SECONDS", "5")))
KAFKA_BATCH_SIZE = max(1, int(os.environ.get("KAFKA_BATCH_SIZE", "500")))
KAFKA_DB_RETRY_INITIAL_SECONDS = max(
    1, int(os.environ.get("KAFKA_DB_RETRY_INITIAL_SECONDS", "5"))
)
KAFKA_DB_RETRY_MAX_SECONDS = max(
    KAFKA_DB_RETRY_INITIAL_SECONDS,
    int(os.environ.get("KAFKA_DB_RETRY_MAX_SECONDS", "60")),
)
EVIDENTLY_TRIGGER_THRESHOLD = int(os.environ.get('EVIDENTLY_TRIGGER_THRESHOLD', '100'))
CONTROL_PLANE_WEBHOOK_URL = os.environ.get("CONTROL_PLANE_WEBHOOK_URL", "").strip()
WEBHOOK_SECRET = os.environ.get("CONTROL_PLANE_WEBHOOK_SECRET", "super-secret-key")

# Cờ báo hiệu trạng thái hoạt động
RUNNING = True


@dataclass(frozen=True)
class KafkaRecord:
    """Application payload together with the Kafka position that owns it."""

    payload: dict[str, Any]
    topic: str
    partition: int
    offset: int


@dataclass
class RetryState:
    attempts: int = 0
    next_retry_at: float = 0.0

# Hàm xử lý tín hiệu dừng
def handle_sigterm(*args):
    global RUNNING
    print("Received SIGTERM. Shutting down gracefully...")
    RUNNING = False

# Hàm gửi Webhook cảnh báo về Django Control Plane để kích hoạt Argo Workflows / Celery
def trigger_django_webhook(model_version_id: str, count: int):
    if not CONTROL_PLANE_WEBHOOK_URL:
        return
    print(f"[{model_version_id}] Triggering Django webhook for drift check...")

    headers = {
        "Authorization": f"Bearer {WEBHOOK_SECRET}",
        "Content-Type": "application/json"
    }
    payload = {
        "event_type": "trigger_drift_check",
        "model_version_id": model_version_id,
        "current_data_count": count
    }

    try:
        response = requests.post(CONTROL_PLANE_WEBHOOK_URL, headers=headers, json=payload, timeout=10)
        if response.status_code in [200, 201, 204]:
            print(f"[{model_version_id}] Webhook sent Successfully! Django has been notified.")
        else:
            print(f"[{model_version_id}] Webhook failed! HTTP {response.status_code}: {response.text}")
    except Exception as e:
        print(f"[{model_version_id}] Error sending webhook: {e}")

# Hàm kiểm tra và gọi webhook nếu Production Data vượt ngưỡng
def check_threshold_and_trigger(last_triggered_counts: dict, df_batch: pd.DataFrame) -> dict:
    """Kiểm tra số lượng và gọi webhook nếu vượt ngưỡng. Trả về last_triggered_counts mới."""
    if df_batch is None or df_batch.empty or 'model_version_id' not in df_batch.columns:
        return last_triggered_counts

    thresholds = get_model_drift_thresholds()
    unique_models = df_batch['model_version_id'].dropna().unique()
    
    for model_version_id in unique_models:
        threshold = thresholds.get(model_version_id)
        if not threshold:
            continue
            
        count = get_production_data_count_by_model_version(model_version_id)
        last_count = last_triggered_counts.get(model_version_id, 0)
        diff = count - last_count
        
        print(
            f"Drift monitoring [{model_version_id}]: {count} total rows. "
            f"New rows since last trigger: {diff}/{threshold}"
        )
        
        if diff >= threshold:
            trigger_django_webhook(model_version_id, count)
            last_triggered_counts[model_version_id] = count
            
    return last_triggered_counts

def build_batch_dataframe(records: list[KafkaRecord]) -> pd.DataFrame:
    df = pd.DataFrame([record.payload for record in records])
    for column in ("timestamp", "created_at"):
        if column in df.columns:
            df[column] = pd.to_datetime(df[column], utc=True, errors="coerce")
    return df


def _commit_batch_offset(consumer, record: KafkaRecord) -> bool:
    """Synchronously commit exactly one processed partition position."""
    next_offset = TopicPartition(record.topic, record.partition, record.offset + 1)
    try:
        committed_offsets = consumer.commit(offsets=[next_offset], asynchronous=False)
    except Exception as exc:
        print(
            f"[{record.topic}/{record.partition}] Kafka offset commit failed at "
            f"{record.offset + 1}: {exc}"
        )
        return False

    failures = [offset for offset in committed_offsets or [] if getattr(offset, "error", None)]
    if failures:
        print(
            f"[{record.topic}/{record.partition}] Kafka offset commit returned errors: "
            f"{failures}"
        )
        return False
    return True


def flush_batch(
    consumer, records: list[KafkaRecord], last_triggered_counts: dict
) -> tuple[bool, dict]:
    """Persist one partition batch before committing its exact next offset."""
    if not records:
        return True, last_triggered_counts
    partitions = {(record.topic, record.partition) for record in records}
    if len(partitions) != 1:
        raise ValueError("A Kafka batch must contain records from exactly one partition.")

    dataframe = build_batch_dataframe(records)
    if not save_dataframe_to_db(dataframe, "paas_production_logs"):
        return False, last_triggered_counts
    if not _commit_batch_offset(consumer, records[-1]):
        return False, last_triggered_counts
    return True, check_threshold_and_trigger(last_triggered_counts, dataframe)


def _partition_handle(key: tuple[str, int]) -> TopicPartition:
    return TopicPartition(key[0], key[1])


def _retry_delay(attempts: int) -> int:
    return min(
        KAFKA_DB_RETRY_INITIAL_SECONDS * (2 ** max(0, attempts - 1)),
        KAFKA_DB_RETRY_MAX_SECONDS,
    )


def _schedule_retry(consumer, key: tuple[str, int], retries: dict[tuple[str, int], RetryState]) -> None:
    retry = retries.setdefault(key, RetryState())
    retry.attempts += 1
    delay = _retry_delay(retry.attempts)
    retry.next_retry_at = time.monotonic() + delay
    if retry.attempts == 1:
        consumer.pause([_partition_handle(key)])
    print(
        f"[{key[0]}/{key[1]}] Database or offset commit failed; partition paused. "
        f"Retrying batch in {delay}s (attempt {retry.attempts})."
    )


def flush_pending_batch(
    consumer,
    pending_batches: dict[tuple[str, int], list[KafkaRecord]],
    retries: dict[tuple[str, int], RetryState],
    key: tuple[str, int],
    last_triggered_counts: dict,
) -> tuple[bool, dict]:
    """Flush a retained partition batch and release it only after offset commit."""
    batch = pending_batches[key]
    saved, last_triggered_counts = flush_batch(consumer, batch, last_triggered_counts)
    if not saved:
        _schedule_retry(consumer, key, retries)
        return False, last_triggered_counts

    pending_batches.pop(key)
    was_paused = retries.pop(key, None)
    if was_paused:
        consumer.resume([_partition_handle(key)])
    return True, last_triggered_counts

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
        'enable.auto.commit': False,
        # Store and commit offsets only after their PostgreSQL transaction succeeds.
        'enable.auto.offset.store': False,
    }

    init_db()

    # Khởi tạo Consumer và subscribe vào topic
    consumer = Consumer(conf)
    consumer.subscribe([KAFKA_TOPIC])

    print(f"Consumer listening to the topic '{KAFKA_TOPIC}' at {REDPANDA_BROKERS}")

    pending_batches: dict[tuple[str, int], list[KafkaRecord]] = {}
    retries: dict[tuple[str, int], RetryState] = {}
    last_triggered_counts = {} # Khởi tạo tracking số lượng theo từng model
    print("Initial tracking dictionary initialized.")

    try:
        while RUNNING:
            # Retry failed partitions without blocking heartbeats for the rest
            # of the consumer group. A partition remains paused until its
            # retained batch has both persisted and committed its exact offset.
            now = time.monotonic()
            for key, retry in list(retries.items()):
                if now >= retry.next_retry_at:
                    _, last_triggered_counts = flush_pending_batch(
                        consumer, pending_batches, retries, key, last_triggered_counts
                    )

            # Liên tục lắng nghe (poll) với timeout 1 giây
            msg = consumer.poll(timeout=1.0)
            
            # Cơ chế "Flush on Idle": Nếu không có message mới nào trong 1 giây, tự động flush batch hiện tại vào DB.
            if msg is None:
                for key in list(pending_batches):
                    if key in retries:
                        continue
                    batch_size = len(pending_batches[key])
                    saved, last_triggered_counts = flush_pending_batch(
                        consumer, pending_batches, retries, key, last_triggered_counts
                    )
                    if saved:
                        print(f"Flushed {batch_size} records to DB due to idle time.")
                continue
                
            # Xử lý lỗi Kafka
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                if msg.error().code() == KafkaError.UNKNOWN_TOPIC_OR_PART or msg.error().retriable():
                    print(
                        f"Kafka topic '{KAFKA_TOPIC}' is temporarily unavailable; "
                        f"retrying in {KAFKA_TOPIC_RETRY_SECONDS}s: {msg.error()}"
                    )
                    time.sleep(KAFKA_TOPIC_RETRY_SECONDS)
                    continue
                raise RuntimeError(f"Kafka consumer error: {msg.error()}")
                    
            try:
                # Đọc payload từ API và parse lại thành Dictionary
                val_json = msg.value().decode('utf-8')
                row_data = json.loads(val_json)
                record = KafkaRecord(
                    payload=row_data,
                    topic=msg.topic(),
                    partition=msg.partition(),
                    offset=msg.offset(),
                )
                key = (record.topic, record.partition)
                current_batch = pending_batches.setdefault(key, [])
                current_batch.append(record)
                
                # Gom đủ một partition batch thì mang đi ghi. A failed batch
                # pauses that partition, so its later offsets cannot overtake it.
                if key not in retries and len(current_batch) >= KAFKA_BATCH_SIZE:
                    batch_size = len(current_batch)
                    saved, last_triggered_counts = flush_pending_batch(
                        consumer, pending_batches, retries, key, last_triggered_counts
                    )
                    if saved:
                        print(f"Completed batch delivery: {batch_size} records to DB.")
                    
            except Exception as parse_e:
                # Never allow a later offset to skip an invalid message. The
                # process exits without committing this position; Compose will
                # restart it and preserve the event for operator remediation.
                raise RuntimeError(f"Error parsing Kafka payload: {parse_e}") from parse_e
                
    except KeyboardInterrupt:
        print("Received shutdown command...")
    finally:
        # Try every remaining batch once. Failed batches are intentionally not
        # committed; they will be replayed after the local Compose restart.
        for key in list(pending_batches):
            _, last_triggered_counts = flush_pending_batch(
                consumer, pending_batches, retries, key, last_triggered_counts
            )
        consumer.close()
        print("Consumer cleaned up safely.")

if __name__ == '__main__':
    # Đợi Redpanda khởi động hoàn tất trước khi Consumer nhảy vào kết nối
    print("Waiting for Redpanda Broker to start...")
    time.sleep(5)
    main()
