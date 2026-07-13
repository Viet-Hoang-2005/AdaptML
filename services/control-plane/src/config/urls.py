from apps.deployment.api.urls import build_patterns, deployment_patterns, endpoint_patterns
from apps.deployment.api.webhooks import BuildWebhookEndpoint
from apps.drift.api.webhooks import DriftRunWebhookEndpoint
from apps.training.api.webhooks import TrainingJobWebhookEndpoint, TrainingOutputUploadURLEndpoint
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.auth.api.urls")),
    path("api/api-keys/", include("apps.access.api.urls")),
    path("api/models/", include("apps.catalog.api.urls")),
    path("api/registry/", include("apps.registry.api.urls")),
    path("api/training-jobs/", include("apps.training.api.urls")),
    path("api/builds/", include((build_patterns, "builds"))),
    path("api/deployments/", include((deployment_patterns, "deployments"))),
    path("api/endpoints/", include((endpoint_patterns, "endpoints"))),
    path("api/drift-monitors/", include("apps.drift.api.urls")),
    path("api/observability/", include("apps.observability.api.model_urls")),
    path("health/", include("apps.observability.api.urls")),
    path("internal/webhooks/builds/<uuid:build_id>/", BuildWebhookEndpoint.as_view()),
    path("internal/webhooks/training-jobs/<uuid:job_id>/", TrainingJobWebhookEndpoint.as_view()),
    path("internal/training-jobs/<uuid:job_id>/output-upload-url/", TrainingOutputUploadURLEndpoint.as_view()),
    path("internal/webhooks/drift-runs/<uuid:run_id>/", DriftRunWebhookEndpoint.as_view()),
]
