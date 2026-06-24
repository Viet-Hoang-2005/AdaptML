from django.urls import path

from drift.views import (
    DriftMonitoringJobDetailView,
    DriftMonitoringJobListCreateView,
    DriftMonitoringResultListView,
    DriftResultWebhookView,
    ProductionDataView,
    ReferenceFileListView,
    ReferenceFileUploadView,
    TriggerDriftJobManualView,
    TriggerDriftJobWebhookView,
)

urlpatterns = [
    path("jobs/", DriftMonitoringJobListCreateView.as_view(), name="drift_job_list_create"),
    path("jobs/<int:pk>/", DriftMonitoringJobDetailView.as_view(), name="drift_job_detail"),
    path("jobs/<int:job_id>/results/", DriftMonitoringResultListView.as_view(), name="drift_job_results"),
    path("jobs/<int:job_id>/run/", TriggerDriftJobManualView.as_view(), name="drift_job_run_manual"),
    path("models/<hashid:model_id>/production-data/", ProductionDataView.as_view(), name="model_production_data"),
    path("models/<hashid:model_id>/reference-files/", ReferenceFileListView.as_view(), name="model_reference_files"),
    path("models/<hashid:model_id>/reference-data/", ReferenceFileUploadView.as_view(), name="model_reference_upload"),
    path("internal/trigger-drift-job", TriggerDriftJobWebhookView.as_view(), name="trigger_drift_job_webhook"),
    path("internal/drift-webhook", DriftResultWebhookView.as_view(), name="drift_result_webhook"),
]
