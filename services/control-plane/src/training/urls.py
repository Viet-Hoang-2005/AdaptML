from django.urls import path

from training.views import (
    TrainingJobCancelView,
    TrainingJobDetailView,
    TrainingJobDownloadURLView,
    TrainingJobEventsView,
    TrainingJobIngestTrackingView,
    TrainingJobListCreateView,
    TrainingJobLogsView,
    TrainingJobMetricsView,
    TrainingJobRefreshStatusView,
    TrainingJobRegisterModelView,
    TrainingJobRestoreView,
    TrainingJobRetryView,
    TrainingJobSummaryView,
    TrainingUsageView,
)

urlpatterns = [
    path("jobs/", TrainingJobListCreateView.as_view(), name="training_job_list_create"),
    path("jobs/<int:training_job_id>/", TrainingJobDetailView.as_view(), name="training_job_detail"),
    path("jobs/<int:training_job_id>/refresh-status/", TrainingJobRefreshStatusView.as_view(), name="training_job_refresh_status"),
    path("jobs/<int:training_job_id>/download-url/", TrainingJobDownloadURLView.as_view(), name="training_job_download_url"),
    path("jobs/<int:training_job_id>/register-model/", TrainingJobRegisterModelView.as_view(), name="training_job_register_model"),
    path("jobs/<int:training_job_id>/cancel/", TrainingJobCancelView.as_view(), name="training_job_cancel"),
    path("jobs/<int:training_job_id>/retry/", TrainingJobRetryView.as_view(), name="training_job_retry"),
    path("jobs/<int:training_job_id>/events/", TrainingJobEventsView.as_view(), name="training_job_events"),
    path("jobs/<int:training_job_id>/logs/", TrainingJobLogsView.as_view(), name="training_job_logs"),
    path("jobs/<int:training_job_id>/metrics/", TrainingJobMetricsView.as_view(), name="training_job_metrics"),
    path("jobs/<int:training_job_id>/summary/", TrainingJobSummaryView.as_view(), name="training_job_summary"),
    path("jobs/<int:training_job_id>/ingest-tracking/", TrainingJobIngestTrackingView.as_view(), name="training_job_ingest_tracking"),
    path("jobs/<int:training_job_id>/restore/", TrainingJobRestoreView.as_view(), name="training_job_restore"),
    path("usage/", TrainingUsageView.as_view(), name="training_usage"),
]
