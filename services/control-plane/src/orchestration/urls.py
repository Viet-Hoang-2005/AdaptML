from django.urls import path
from .training_job_views import (
    TrainingJobCancelView,
    TrainingJobDetailView,
    TrainingJobDownloadURLView,
    TrainingJobEventsView,
    TrainingJobListCreateView,
    TrainingJobLogsView,
    TrainingJobMetricsView,
    TrainingJobRefreshStatusView,
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
    ModelAPIDeployView,
)

urlpatterns = [
    path('models/', ModelAPIListCreateView.as_view(), name='model_api_list_create'),
    path('models/build/', ModelAPIBuildView.as_view(), name='model_api_build'),
    path('models/<int:model_id>/package-preview/', ModelAPIPackagePreviewView.as_view(), name='model_api_package_preview'),
    path('models/<int:model_id>/build-logs/', ModelAPIBuildLogsView.as_view(), name='model_api_build_logs'),
    path('models/<int:model_id>/cancel-build/', ModelAPICancelBuildView.as_view(), name='model_api_cancel_build'),
    path('models/<int:model_id>/deploy/', ModelAPIDeployView.as_view(), name='model_api_deploy'),
    path('models/<int:model_id>/build-webhook', ModelAPIBuildWebhookView.as_view(), name='model_api_build_webhook'),
    path('models/<int:model_id>/', ModelAPIDetailView.as_view(), name='model_api_detail'),
    path('training-jobs/', TrainingJobListCreateView.as_view(), name='training_job_list_create'),
    path('training-jobs/<int:training_job_id>/', TrainingJobDetailView.as_view(), name='training_job_detail'),
    path('training-jobs/<int:training_job_id>/refresh-status/', TrainingJobRefreshStatusView.as_view(), name='training_job_refresh_status'),
    path('training-jobs/<int:training_job_id>/download-url/', TrainingJobDownloadURLView.as_view(), name='training_job_download_url'),
    path('training-jobs/<int:training_job_id>/cancel/', TrainingJobCancelView.as_view(), name='training_job_cancel'),
    path('training-jobs/<int:training_job_id>/retry/', TrainingJobRetryView.as_view(), name='training_job_retry'),
    path('training-jobs/<int:training_job_id>/events/', TrainingJobEventsView.as_view(), name='training_job_events'),
    path('training-jobs/<int:training_job_id>/logs/', TrainingJobLogsView.as_view(), name='training_job_logs'),
    path('training-jobs/<int:training_job_id>/metrics/', TrainingJobMetricsView.as_view(), name='training_job_metrics'),
    path('training-jobs/<int:training_job_id>/restore/', TrainingJobRestoreView.as_view(), name='training_job_restore'),
    path('training-usage/', TrainingUsageView.as_view(), name='training_usage'),
]
