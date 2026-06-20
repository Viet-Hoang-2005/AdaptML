"""
WebSocket URL routing for Training PaaS.
Maps: ws/training-jobs/<job_id>/ → TrainingJobConsumer
"""

from django.urls import re_path
from .training_job_consumer import TrainingJobConsumer

websocket_urlpatterns = [
    re_path(r'^ws/training-jobs/(?P<job_id>\d+)/$', TrainingJobConsumer.as_asgi()),
]
