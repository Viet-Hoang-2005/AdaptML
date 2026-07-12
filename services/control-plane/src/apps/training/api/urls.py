from django.urls import path

from .endpoints import (
    TrainingJobCancelEndpoint,
    TrainingJobDetailEndpoint,
    TrainingJobDownloadEndpoint,
    TrainingJobEventsEndpoint,
    TrainingJobListCreateEndpoint,
    TrainingJobSubmitEndpoint,
)

urlpatterns = [
    path("", TrainingJobListCreateEndpoint.as_view(), name="training-job-list"),
    path("<uuid:job_id>/", TrainingJobDetailEndpoint.as_view(), name="training-job-detail"),
    path("<uuid:job_id>/submit/", TrainingJobSubmitEndpoint.as_view(), name="training-job-submit"),
    path("<uuid:job_id>/cancel/", TrainingJobCancelEndpoint.as_view(), name="training-job-cancel"),
    path("<uuid:job_id>/events/", TrainingJobEventsEndpoint.as_view(), name="training-job-events"),
    path("<uuid:job_id>/download/", TrainingJobDownloadEndpoint.as_view(), name="training-job-download"),
]
