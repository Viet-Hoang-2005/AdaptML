import os
import logging
import json
import time
import boto3

from django.utils import timezone
from django.db import connection
from rest_framework import generics, status, views
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from django.shortcuts import get_object_or_404
from django.conf import settings

from authentication.models import ModelAPI, DriftMonitoringJob, DriftMonitoringResult
from integrations.hashid_utils import decode_model_id, encode_model_id
from integrations.s3_paths import model_data_prefix
from integrations.s3_zip_utils import get_s3_file_list, upload_single_file_to_s3, delete_s3_path
from drift.serializers import DriftMonitoringJobSerializer, DriftMonitoringResultSerializer
from drift.evidently_service import run_evidently_job, run_evidently_job_sync

logger = logging.getLogger(__name__)

class DriftMonitoringJobListCreateView(generics.ListCreateAPIView):
    serializer_class = DriftMonitoringJobSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        model_id_str = self.request.query_params.get("model_id")
        if model_id_str:
            model_id = decode_model_id(model_id_str)
            return DriftMonitoringJob.objects.filter(tenant=self.request.user, model_api_id=model_id)
        return DriftMonitoringJob.objects.filter(tenant=self.request.user)

    def perform_create(self, serializer):
        model_id_str = self.request.data.get("model_id")
        model_id = decode_model_id(model_id_str)
        model_api = get_object_or_404(ModelAPI, id=model_id, tenant=self.request.user)
        serializer.save(tenant=self.request.user, model_api=model_api)

class DriftMonitoringJobDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = DriftMonitoringJobSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return DriftMonitoringJob.objects.filter(tenant=self.request.user)

class DriftMonitoringResultListView(generics.ListAPIView):
    serializer_class = DriftMonitoringResultSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        job_id = self.kwargs["job_id"]
        job = get_object_or_404(DriftMonitoringJob, id=job_id, tenant=self.request.user)
        return DriftMonitoringResult.objects.filter(job=job)

class ProductionDataView(views.APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, model_id):
        model_api = get_object_or_404(ModelAPI, id=model_id, tenant=request.user)
        
        # Query up to 50 latest records from paas_production_logs
        # Since paas_production_logs might be created dynamically by consumer, we catch errors
        try:
            with connection.cursor() as cursor:
                # Need to check if table exists
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_name = 'paas_production_logs'
                    );
                """)
                if not cursor.fetchone()[0]:
                    return Response([])

                cursor.execute("""
                    SELECT features, prediction FROM paas_production_logs 
                    WHERE model_id = %s 
                    ORDER BY timestamp DESC 
                    LIMIT 50
                """, [str(model_api.id)])
                
                columns = [col[0] for col in cursor.description]
                results = [
                    dict(zip(columns, row))
                    for row in cursor.fetchall()
                ]
                
                # features may be stored as a (possibly double-encoded) JSON string.
                # Decode repeatedly until we get a dict/list so the preview works
                # for both legacy and freshly ingested rows.
                for row in results:
                    value = row.get('features')
                    for _ in range(3):
                        if not isinstance(value, str):
                            break
                        try:
                            value = json.loads(value)
                        except (json.JSONDecodeError, TypeError):
                            break
                    row['features'] = value
                
                return Response(results)
        except Exception as e:
            logger.error(f"Error fetching production data: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class ReferenceFileListView(views.APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, model_id):
        model_api = get_object_or_404(ModelAPI, id=model_id, tenant=request.user)
        
        tenant_id = request.user.tenant_id
        model_hash_id = encode_model_id(model_api.id)
        prefix = model_data_prefix(tenant_id, model_hash_id)
        
        files = get_s3_file_list(prefix)
            
        return Response(files)

class ReferenceFileUploadView(views.APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, model_id):
        model_api = get_object_or_404(ModelAPI, id=model_id, tenant=request.user)
        
        file_obj = request.FILES.get('file')
        if not file_obj:
            return Response({"error": "No file uploaded"}, status=status.HTTP_400_BAD_REQUEST)
            
        tenant_id = request.user.tenant_id
        model_hash_id = encode_model_id(model_api.id)
        key = f'{model_data_prefix(tenant_id, model_hash_id)}{file_obj.name}'
        
        bucket_name = getattr(settings, 'AWS_STORAGE_BUCKET_NAME', 'mlops-paas-artifacts')
        
        try:
            upload_single_file_to_s3(file_obj, key)
            return Response({"message": "File uploaded successfully"})
        except Exception as e:
            logger.error(f"Error uploading reference file: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def delete(self, request, model_id):
        model_api = get_object_or_404(ModelAPI, id=model_id, tenant=request.user)
        
        file_path = request.data.get('path')
        if not file_path:
            return Response({"error": "path is required"}, status=status.HTTP_400_BAD_REQUEST)
            
        tenant_id = request.user.tenant_id
        model_hash_id = encode_model_id(model_api.id)
        
        if file_path.startswith('/'):
            file_path = file_path[1:]
            
        key = f'{model_data_prefix(tenant_id, model_hash_id)}{file_path}'
        
        try:
            delete_s3_path(key)
            return Response({"message": "Deleted successfully"})
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class TriggerDriftJobWebhookView(views.APIView):
    permission_classes = [AllowAny] # Use custom secret token verification

    def post(self, request):
        secret = request.headers.get("Authorization", "")
        expected_secret = f"Bearer {getattr(settings, 'CONTROL_PLANE_WEBHOOK_SECRET', 'super-secret-key')}"
        if secret != expected_secret:
            return Response({"error": "Unauthorized"}, status=status.HTTP_401_UNAUTHORIZED)
            
        # The payload contains model_id and current_data_count
        model_id_str = request.data.get("model_id")
        current_data_count = request.data.get("current_data_count")
        
        if not model_id_str:
            return Response({"error": "model_id required"}, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            model_id = decode_model_id(model_id_str)
            job = DriftMonitoringJob.objects.get(model_api_id=model_id, status="active")
            
            # Spawn docker container
            run_evidently_job(job)
            
            return Response({"status": "Drift job triggered"})
        except DriftMonitoringJob.DoesNotExist:
            return Response({"error": "No active drift job found for this model"}, status=status.HTTP_404_NOT_FOUND)

class TriggerDriftJobManualView(views.APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, job_id):
        job = get_object_or_404(DriftMonitoringJob, id=job_id, tenant=request.user)
        
        start_time = timezone.now()

        # Spawn docker container synchronously and catch error
        try:
            run_evidently_job_sync(job.id)
            
            # If argo workflow, we poll for completion up to 10 minutes
            strategy = os.environ.get("BUILD_STRATEGY", "docker").lower()
            if strategy == "argo":
                max_retries = 60
                success = False
                for _ in range(max_retries):
                    if DriftMonitoringResult.objects.filter(job=job, run_at__gte=start_time).exists():
                        success = True
                        break
                    time.sleep(10)
                
                if not success:
                    return Response({"error": "Argo workflow triggered but timed out waiting for result."}, status=status.HTTP_408_REQUEST_TIMEOUT)

            return Response({"status": "Drift job manually triggered and completed"})
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

class DriftResultWebhookView(views.APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        secret = request.headers.get("Authorization", "")
        expected_secret = f"Bearer {getattr(settings, 'CONTROL_PLANE_WEBHOOK_SECRET', 'super-secret-key')}"
        if secret != expected_secret:
            return Response({"error": "Unauthorized"}, status=status.HTTP_401_UNAUTHORIZED)
            
        model_id = request.data.get("model_id")
        summary = request.data.get("drift_summary", {})
        
        if not model_id or not summary:
            return Response({"error": "model_id and drift_summary required"}, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            model = ModelAPI.objects.get(id=model_id)
            job = DriftMonitoringJob.objects.get(model_api=model, status="active")
            
            artifacts = summary.get("report_artifacts", {})
            html_s3_uri = artifacts.get("html_s3_uri", "")
            
            DriftMonitoringResult.objects.create(
                job=job,
                report_url=html_s3_uri,
                drift_score=summary.get("share_drifted_features", 0.0),
                dataset_drift=summary.get("dataset_drift", False),
                drifted_features_count=summary.get("number_of_drifted_features", 0),
                total_features=summary.get("number_of_features", 0)
            )
            
            return Response({"status": "Drift result saved"})
            
        except Exception as e:
            logger.error(f"Failed to process drift result webhook: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class PresignedUrlView(views.APIView):
    def post(self, request):
        s3_uri = request.data.get("s3_uri")
        if not s3_uri or not s3_uri.startswith("s3://"):
            return Response({"error": "Invalid s3_uri"}, status=status.HTTP_400_BAD_REQUEST)
        
        aws_region = getattr(settings, "AWS_S3_REGION_NAME", "ap-southeast-1")
        s3_client = boto3.client('s3', region_name=aws_region)
        
        try:
            # s3://bucket-name/path/to/key
            parts = s3_uri.replace("s3://", "").split("/", 1)
            bucket_name = parts[0]
            key = parts[1]
            
            url = s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': bucket_name, 'Key': key},
                ExpiresIn=3600
            )
            return Response({"url": url})
        except Exception as e:
            logger.error(f"Failed to generate presigned URL: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
