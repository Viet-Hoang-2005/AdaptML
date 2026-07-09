from django.urls import path, register_converter
from integrations.hashid_utils import decode_model_id, encode_model_id
from monitoring.views import ModelAPIObservabilityView


class HashIdConverter:
    regex = "[a-zA-Z0-9]+"

    def to_python(self, value):
        return decode_model_id(value)

    def to_url(self, value):
        return encode_model_id(value)


register_converter(HashIdConverter, "hashid")

urlpatterns = [
    path("models/<hashid:model_id>/observability/", ModelAPIObservabilityView.as_view(), name="model_api_observability"),
]
