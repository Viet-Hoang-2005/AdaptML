from django.urls import path, register_converter

from integrations.hashid_utils import decode_model_id, encode_model_id
from registry.views import (
    ModelAPIBuildLogsView,
    ModelAPIBuildView,
    ModelAPIBuildWebhookView,
    ModelAPICancelBuildView,
    ModelAPICheckHealthView,
    ModelAPICleanupView,
    ModelAPIDeployView,
    ModelAPIDetailView,
    ModelAPIEndpointLogsView,
    ModelAPIListCreateView,
    ModelAPIPackagePreviewView,
    ModelAPIRedeployView,
    ModelAPIStopEndpointView,
    ModelAPITriggerBuildView,
    SourceCodeFileListView,
    SourceCodeFileUploadView,
)


class HashIdConverter:
    regex = "[a-zA-Z0-9]+"

    def to_python(self, value):
        return decode_model_id(value)

    def to_url(self, value):
        return encode_model_id(value)


register_converter(HashIdConverter, "hashid")

urlpatterns = [
    path("", ModelAPIListCreateView.as_view(), name="model_api_list_create"),
    path("build/", ModelAPIBuildView.as_view(), name="model_api_build"),
    path("<hashid:model_id>/package-preview/", ModelAPIPackagePreviewView.as_view(), name="model_api_package_preview"),
    path("<hashid:model_id>/build-logs/", ModelAPIBuildLogsView.as_view(), name="model_api_build_logs"),
    path("<hashid:model_id>/build/", ModelAPITriggerBuildView.as_view(), name="model_api_trigger_build"),
    path("<hashid:model_id>/cancel-build/", ModelAPICancelBuildView.as_view(), name="model_api_cancel_build"),
    path("<hashid:model_id>/deploy/", ModelAPIDeployView.as_view(), name="model_api_deploy"),
    path("<hashid:model_id>/redeploy/", ModelAPIRedeployView.as_view(), name="model_api_redeploy"),
    path("<hashid:model_id>/stop-endpoint/", ModelAPIStopEndpointView.as_view(), name="model_api_stop_endpoint"),
    path("<hashid:model_id>/check-health/", ModelAPICheckHealthView.as_view(), name="model_api_check_health"),
    path("<hashid:model_id>/endpoint-logs/", ModelAPIEndpointLogsView.as_view(), name="model_api_endpoint_logs"),
    path("<hashid:model_id>/cleanup/", ModelAPICleanupView.as_view(), name="model_api_cleanup"),
    path("<hashid:model_id>/build-webhook", ModelAPIBuildWebhookView.as_view(), name="model_api_build_webhook"),
    path("<hashid:model_id>/source-code-files/", SourceCodeFileListView.as_view(), name="model_source_code_files"),
    path("<hashid:model_id>/source-code-upload/", SourceCodeFileUploadView.as_view(), name="model_source_code_upload"),
    path("<hashid:model_id>/", ModelAPIDetailView.as_view(), name="model_api_detail"),
]
