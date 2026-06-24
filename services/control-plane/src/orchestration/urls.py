from django.urls import path, register_converter
from .hashid_utils import decode_model_id, encode_model_id

class HashIdConverter:
    regex = '[a-zA-Z0-9]+'

    def to_python(self, value):
        return decode_model_id(value)

    def to_url(self, value):
        return encode_model_id(value)

register_converter(HashIdConverter, 'hashid')
from .training_job_views import (
    TrainingJobCancelView,
    TrainingJobDetailView,
    TrainingJobDownloadURLView,
    TrainingJobEventsView,
    TrainingJobListCreateView,
    TrainingJobLogsView,
    TrainingJobMetricsView,
    TrainingJobRefreshStatusView,
    TrainingJobRegisterModelView,
    TrainingJobRetryView,
    TrainingJobRestoreView,
    TrainingUsageView,
)

from .model_api_views import (
    ModelAPIBuildView,
    ModelAPIDetailView,
    ModelAPIListCreateView,
    ModelAPIPackagePreviewView,
    ModelAPIBuildLogsView,
    ModelAPIBuildWebhookView,
    ModelAPICancelBuildView,
    ModelAPICheckHealthView,
    ModelAPICleanupView,
    ModelAPIDeployView,
    ModelAPIEndpointLogsView,
    ModelAPIRedeployView,
    ModelAPIStopEndpointView,
    ModelAPITriggerBuildView,
    SourceCodeFileListView,
    SourceCodeFileUploadView,
)

from .drift_views import (
    DriftMonitoringJobListCreateView,
    DriftMonitoringJobDetailView,
    DriftMonitoringResultListView,
    ProductionDataView,
    ReferenceFileListView,
    ReferenceFileUploadView,
    TriggerDriftJobWebhookView,
    TriggerDriftJobManualView,
    DriftResultWebhookView,
)

urlpatterns = [
    path('models/', ModelAPIListCreateView.as_view(), name='model_api_list_create'),
    path('models/build/', ModelAPIBuildView.as_view(), name='model_api_build'),
    path('models/<hashid:model_id>/package-preview/', ModelAPIPackagePreviewView.as_view(), name='model_api_package_preview'),
    path('models/<hashid:model_id>/build-logs/', ModelAPIBuildLogsView.as_view(), name='model_api_build_logs'),
    path('models/<hashid:model_id>/build/', ModelAPITriggerBuildView.as_view(), name='model_api_trigger_build'),
    path('models/<hashid:model_id>/cancel-build/', ModelAPICancelBuildView.as_view(), name='model_api_cancel_build'),
    path('models/<hashid:model_id>/deploy/', ModelAPIDeployView.as_view(), name='model_api_deploy'),
    path('models/<hashid:model_id>/redeploy/', ModelAPIRedeployView.as_view(), name='model_api_redeploy'),
    path('models/<hashid:model_id>/stop-endpoint/', ModelAPIStopEndpointView.as_view(), name='model_api_stop_endpoint'),
    path('models/<hashid:model_id>/check-health/', ModelAPICheckHealthView.as_view(), name='model_api_check_health'),
    path('models/<hashid:model_id>/endpoint-logs/', ModelAPIEndpointLogsView.as_view(), name='model_api_endpoint_logs'),
    path('models/<hashid:model_id>/cleanup/', ModelAPICleanupView.as_view(), name='model_api_cleanup'),
    path('models/<hashid:model_id>/build-webhook', ModelAPIBuildWebhookView.as_view(), name='model_api_build_webhook'),
    path('models/<hashid:model_id>/', ModelAPIDetailView.as_view(), name='model_api_detail'),
    path('training-jobs/', TrainingJobListCreateView.as_view(), name='training_job_list_create'),
    path('training-jobs/<int:training_job_id>/', TrainingJobDetailView.as_view(), name='training_job_detail'),
    path('training-jobs/<int:training_job_id>/refresh-status/', TrainingJobRefreshStatusView.as_view(), name='training_job_refresh_status'),
    path('training-jobs/<int:training_job_id>/download-url/', TrainingJobDownloadURLView.as_view(), name='training_job_download_url'),
    path('training-jobs/<int:training_job_id>/register-model/', TrainingJobRegisterModelView.as_view(), name='training_job_register_model'),
    path('training-jobs/<int:training_job_id>/cancel/', TrainingJobCancelView.as_view(), name='training_job_cancel'),
    path('training-jobs/<int:training_job_id>/retry/', TrainingJobRetryView.as_view(), name='training_job_retry'),
    path('training-jobs/<int:training_job_id>/events/', TrainingJobEventsView.as_view(), name='training_job_events'),
    path('training-jobs/<int:training_job_id>/logs/', TrainingJobLogsView.as_view(), name='training_job_logs'),
    path('training-jobs/<int:training_job_id>/metrics/', TrainingJobMetricsView.as_view(), name='training_job_metrics'),
    path('training-jobs/<int:training_job_id>/restore/', TrainingJobRestoreView.as_view(), name='training_job_restore'),
    path('training-usage/', TrainingUsageView.as_view(), name='training_usage'),
    path('drift-jobs/', DriftMonitoringJobListCreateView.as_view(), name='drift_job_list_create'),
    path('drift-jobs/<int:pk>/', DriftMonitoringJobDetailView.as_view(), name='drift_job_detail'),
    path('drift-jobs/<int:job_id>/results/', DriftMonitoringResultListView.as_view(), name='drift_job_results'),
    path('drift-jobs/<int:job_id>/run/', TriggerDriftJobManualView.as_view(), name='drift_job_run_manual'),
    path('models/<hashid:model_id>/production-data/', ProductionDataView.as_view(), name='model_production_data'),
    path('models/<hashid:model_id>/reference-files/', ReferenceFileListView.as_view(), name='model_reference_files'),
    path('models/<hashid:model_id>/reference-data/', ReferenceFileUploadView.as_view(), name='model_reference_upload'),
    path('models/<hashid:model_id>/source-code-files/', SourceCodeFileListView.as_view(), name='model_source_code_files'),
    path('models/<hashid:model_id>/source-code-upload/', SourceCodeFileUploadView.as_view(), name='model_source_code_upload'),
    path('internal/trigger-drift-job', TriggerDriftJobWebhookView.as_view(), name='trigger_drift_job_webhook'),
    path('internal/drift-webhook', DriftResultWebhookView.as_view(), name='drift_result_webhook'),
]
