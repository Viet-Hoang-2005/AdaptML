"""
URL configuration for core project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from authentication.model_api_views import (
    ModelAPIBuildView,
    ModelAPIDetailView,
    ModelAPIListCreateView,
    ModelAPIPackagePreviewView,
)
from authentication.training_job_views import (
    TrainingJobDetailView,
    TrainingJobDownloadURLView,
    TrainingJobListCreateView,
    TrainingJobLogsView,
    TrainingJobRefreshStatusView,
    TrainingJobRestoreView,
)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('authentication.urls')),
    path('api/models/', ModelAPIListCreateView.as_view(), name='model_api_list_create'),
    path('api/models/build/', ModelAPIBuildView.as_view(), name='model_api_build'),
    path('api/models/<int:model_id>/package-preview/', ModelAPIPackagePreviewView.as_view(), name='model_api_package_preview'),
    path('api/models/<int:model_id>/', ModelAPIDetailView.as_view(), name='model_api_detail'),
    path('api/training-jobs/', TrainingJobListCreateView.as_view(), name='training_job_list_create'),
    path('api/training-jobs/<int:training_job_id>/', TrainingJobDetailView.as_view(), name='training_job_detail'),
    path('api/training-jobs/<int:training_job_id>/refresh-status/', TrainingJobRefreshStatusView.as_view(), name='training_job_refresh_status'),
    path('api/training-jobs/<int:training_job_id>/download-url/', TrainingJobDownloadURLView.as_view(), name='training_job_download_url'),
    path('api/training-jobs/<int:training_job_id>/logs/', TrainingJobLogsView.as_view(), name='training_job_logs'),
    path('api/training-jobs/<int:training_job_id>/restore/', TrainingJobRestoreView.as_view(), name='training_job_restore'),
]
