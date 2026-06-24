from rest_framework import serializers
from authentication.models import DriftMonitoringJob, DriftMonitoringResult

class DriftMonitoringJobSerializer(serializers.ModelSerializer):
    model_api_id = serializers.CharField(source="model_api.id", read_only=True)
    
    class Meta:
        model = DriftMonitoringJob
        fields = [
            "id",
            "model_api_id",
            "trigger_threshold",
            "reference_data_s3_path",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "model_api_id", "created_at", "updated_at"]

class DriftMonitoringResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = DriftMonitoringResult
        fields = [
            "id",
            "job",
            "report_url",
            "drift_score",
            "dataset_drift",
            "drifted_features_count",
            "total_features",
            "run_at",
        ]
        read_only_fields = ["id", "job", "run_at"]
