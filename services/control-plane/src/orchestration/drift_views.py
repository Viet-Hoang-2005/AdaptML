import json
import logging
from django.db import connection
from rest_framework import generics, status, views
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from django.shortcuts import get_object_or_404
from django.conf import settings
import boto3

from authentication.models import ModelAPI, DriftMonitoringJob, DriftMonitoringResult
from orchestration.hashid_utils import decode_model_id
from orchestration.drift_serializers import DriftMonitoringJobSerializer, DriftMonitoringResultSerializer
from orchestration.utils.s3_zip_utils import get_s3_file_list, upload_single_file_to_s3, delete_s3_path
from orchestration.evidently_service import run_evidently_job

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
                
                # features is stored as a JSON string, parse it back to dict
                import json
                for row in results:
                    if 'features' in row and isinstance(row['features'], str):
                        try:
                            row['features'] = json.loads(row['features'])
                        except (json.JSONDecodeError, TypeError):
                            pass
                
                return Response(results)
        except Exception as e:
            logger.error(f"Error fetching production data: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class ReferenceFileListView(views.APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, model_id):
        model_api = get_object_or_404(ModelAPI, id=model_id, tenant=request.user)
        
        user_name = request.user.email.split('@')[0] if getattr(request.user, 'email', None) else request.user.tenant_id
        safe_model_name = model_api.name.replace(' ', '') if model_api.name else 'UnnamedModel'
        safe_version = model_api.version.replace(' ', '') if model_api.version else 'v1'
        prefix = f'{user_name}/models/{safe_model_name}/{safe_version}/references/'
        
        files = get_s3_file_list(prefix)
            
        return Response(files)

class ReferenceFileUploadView(views.APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, model_id):
        model_api = get_object_or_404(ModelAPI, id=model_id, tenant=request.user)
        
        file_obj = request.FILES.get('file')
        if not file_obj:
            return Response({"error": "No file uploaded"}, status=status.HTTP_400_BAD_REQUEST)
            
        user_name = request.user.email.split('@')[0] if getattr(request.user, 'email', None) else request.user.tenant_id
        safe_model_name = model_api.name.replace(' ', '') if model_api.name else 'UnnamedModel'
        safe_version = model_api.version.replace(' ', '') if model_api.version else 'v1'
        key = f'{user_name}/models/{safe_model_name}/{safe_version}/references/{file_obj.name}'
        
        bucket_name = getattr(settings, 'AWS_STORAGE_BUCKET_NAME', 'mlops-paas-artifacts')
        
        try:
            upload_single_file_to_s3(file_obj, key)
            s3_uri = f"s3://{bucket_name}/{key}"
            return Response({"s3_uri": s3_uri, "message": "File uploaded successfully"})
        except Exception as e:
            logger.error(f"Error uploading reference file: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def delete(self, request, model_id):
        model_api = get_object_or_404(ModelAPI, id=model_id, tenant=request.user)
        
        file_path = request.data.get('path')
        if not file_path:
            return Response({"error": "path is required"}, status=status.HTTP_400_BAD_REQUEST)
            
        user_name = request.user.email.split('@')[0] if getattr(request.user, 'email', None) else request.user.tenant_id
        safe_model_name = model_api.name.replace(' ', '') if model_api.name else 'UnnamedModel'
        safe_version = model_api.version.replace(' ', '') if model_api.version else 'v1'
        
        if file_path.startswith('/'):
            file_path = file_path[1:]
            
        key = f'{user_name}/models/{safe_model_name}/{safe_version}/references/{file_path}'
        
        try:
            delete_s3_path(key)
            return Response({"message": "Deleted successfully"})
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class TriggerDriftJobWebhookView(views.APIView):
    permission_classes = [AllowAny] # Use custom secret token verification

    def post(self, request):
        secret = request.headers.get("Authorization", "")
        expected_secret = getattr(settings, 'WEBHOOK_SECRET', 'Bearer super-secret-key')
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
        
        # Spawn docker container
        run_evidently_job(job)
        
        return Response({"status": "Drift job manually triggered"})

class DriftResultWebhookView(views.APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        secret = request.headers.get("Authorization", "")
        expected_secret = f"Bearer {getattr(settings, 'WEBHOOK_SECRET', 'super-secret-key')}"
        if secret != expected_secret:
            return Response({"error": "Unauthorized"}, status=status.HTTP_401_UNAUTHORIZED)
            
        model_name = request.data.get("model_id")
        summary = request.data.get("drift_summary", {})
        
        if not model_name or not summary:
            return Response({"error": "model_id and drift_summary required"}, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            model = ModelAPI.objects.get(name=model_name)
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
