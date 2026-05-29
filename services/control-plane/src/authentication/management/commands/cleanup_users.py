from django.core.management.base import BaseCommand
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.conf import settings
from confluent_kafka import Producer
import datetime
import boto3
import json
import logging

logger = logging.getLogger(__name__)
User = get_user_model()

class Command(BaseCommand):
    help = 'Scan and permanently delete accounts that have been locked for more than 30 days (including S3 artifacts).'

    def handle(self, *args, **kwargs):
        # Mốc thời gian 30 ngày trước
        cutoff_date = timezone.now() - datetime.timedelta(days=30)
        
        # Tìm các user đã xóa mềm và vượt quá 30 ngày
        expired_users = User.objects.filter(is_active=False, deleted_at__lte=cutoff_date)
        
        if not expired_users.exists():
            self.stdout.write(self.style.SUCCESS("No accounts need to be permanently deleted today."))
            return
            
        # Khởi tạo Kafka Producer
        redpanda_brokers = getattr(settings, 'REDPANDA_BROKERS', 'localhost:19092')
        producer = Producer({'bootstrap.servers': redpanda_brokers})
        
        # Khởi tạo Boto3 S3 Client
        # Nếu chạy trên EC2/K3s, boto3 tự động lấy IAM Role
        s3 = boto3.client('s3', region_name=getattr(settings, 'AWS_S3_REGION_NAME', 'ap-southeast-1'))
        bucket_name = getattr(settings, 'AWS_STORAGE_BUCKET_NAME', 'mlops-paas-artifacts')

        for user in expired_users:
            tenant_id = user.tenant_id
            email = user.email
            self.stdout.write(f"Permanent deletion in progress: {email} (Tenant: {tenant_id})")
            
            # 1. Bắn sự kiện lên Redpanda (Để hệ thống khác biết tenant này đã bay màu hoàn toàn)
            event_payload = {
                "event": "TENANT_HARD_DELETED",
                "tenant_id": tenant_id,
                "email": email
            }
            producer.produce('mlops_paas_control_events', key=tenant_id, value=json.dumps(event_payload))
            
            # 2. Xóa Model Artifacts trên S3 (Giả sử thư mục là mlflow-artifacts/tenant_id)
            # Lưu ý: Cấu trúc thư mục MLflow có thể khác, nhưng thường người ta thiết kế theo tenant_id
            prefix = f"mlflow-artifacts/{tenant_id}/"
            self._delete_s3_folder(s3, bucket_name, prefix)
            
            # Xóa Avatar nếu có
            if user.avatar:
                try:
                    s3.delete_object(Bucket=bucket_name, Key=user.avatar.name)
                except Exception as e:
                    logger.warning(f"Cannot delete avatar {user.avatar.name}: {e}")
            
            # 3. Cuối cùng: Xóa cứng khỏi PostgreSQL
            user.delete()
            self.stdout.write(self.style.SUCCESS(f"Deleted successfully {email}"))
            
        producer.flush()
        self.stdout.write(self.style.SUCCESS("The system cleanup process is complete."))

    def _delete_s3_folder(self, s3_client, bucket_name, prefix):
        """Hàm hỗ trợ xóa toàn bộ objects trong một thư mục S3."""
        try:
            # Lấy danh sách objects
            paginator = s3_client.get_paginator('list_objects_v2')
            pages = paginator.paginate(Bucket=bucket_name, Prefix=prefix)
            
            delete_us = dict(Objects=[])
            for item in pages.search('Contents'):
                if item:
                    delete_us['Objects'].append({'Key': item['Key']})
                    
                    # Xóa từng batch 1000 items
                    if len(delete_us['Objects']) >= 1000:
                        s3_client.delete_objects(Bucket=bucket_name, Delete=delete_us)
                        delete_us = dict(Objects=[])
            
            # Xóa nốt phần còn lại
            if len(delete_us['Objects']):
                s3_client.delete_objects(Bucket=bucket_name, Delete=delete_us)
                
            self.stdout.write(f"The S3 folder has been cleaned up: s3://{bucket_name}/{prefix}")
        except Exception as e:
            logger.error(f"Error when deleting S3 prefix {prefix}: {e}")
