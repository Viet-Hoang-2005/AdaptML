from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.training.selectors import job_for_user, jobs_for_user
from apps.training.services.jobs import cancel_job, create_job, output_download_url, submit_job

from .serializers import TrainingJobEventSerializer, TrainingJobSerializer


class TrainingJobListCreateEndpoint(generics.ListCreateAPIView):
    serializer_class = TrainingJobSerializer

    def get_queryset(self):
        return jobs_for_user(self.request.user).prefetch_related("outputs")

    def perform_create(self, serializer):
        project = serializer.validated_data.pop("project")
        serializer.instance = create_job(project=project, validated_data=serializer.validated_data)


class TrainingJobDetailEndpoint(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TrainingJobSerializer
    lookup_field = "public_id"
    lookup_url_kwarg = "job_id"

    def get_queryset(self):
        return jobs_for_user(self.request.user).prefetch_related("outputs")


class TrainingJobSubmitEndpoint(APIView):
    def post(self, request, job_id):
        job = submit_job(job_for_user(request.user, job_id))
        return Response(TrainingJobSerializer(job).data, status=status.HTTP_202_ACCEPTED)


class TrainingJobCancelEndpoint(APIView):
    def post(self, request, job_id):
        job = cancel_job(job_for_user(request.user, job_id))
        return Response(TrainingJobSerializer(job).data, status=status.HTTP_202_ACCEPTED)


class TrainingJobEventsEndpoint(APIView):
    def get(self, request, job_id):
        job = job_for_user(request.user, job_id)
        return Response(TrainingJobEventSerializer(job.events.all(), many=True).data)


class TrainingJobDownloadEndpoint(APIView):
    def get(self, request, job_id):
        job = job_for_user(request.user, job_id)
        return Response({"download_url": output_download_url(job)})
