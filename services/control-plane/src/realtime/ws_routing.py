"""
WebSocket URL routing for Training PaaS.

Routes:
  ws/training-jobs/<job_id>/  → TrainingJobConsumer
  ws/models/<model_id>/       → ModelApiConsumer
"""

from django.urls import re_path
from realtime.model_api_consumer import ModelApiConsumer

websocket_urlpatterns = [
    re_path(r'^ws/models/(?P<model_id>\d+)/$', ModelApiConsumer.as_asgi()),
]
