"""
WebSocket URL routing for Training PaaS.

Routes:
  ws/training-jobs/<job_id>/  → TrainingJobConsumer
  ws/models/<model_id>/       → ModelApiConsumer
"""

from django.urls import re_path
from realtime.training_job_consumer import TrainingJobConsumer
from realtime.model_api_consumer import ModelApiConsumer

websocket_urlpatterns = [
    re_path(r'^ws/training-jobs/(?P<job_id>\d+)/$', TrainingJobConsumer.as_asgi()),
    re_path(r'^ws/models/(?P<model_id>\d+)/$', ModelApiConsumer.as_asgi()),
]
