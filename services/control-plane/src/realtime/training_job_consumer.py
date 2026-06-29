"""
WebSocket consumer for Training Job realtime sync.

Connects to: ws/training-jobs/<job_id>/?token=<access_token>
"""

import asyncio
import json
import logging

from datetime import datetime
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth.models import AnonymousUser
from django.utils import timezone
from authentication.models import TrainingJob

from training.aws_batch_service import refresh_aws_batch_training_job
from training.sagemaker_service import refresh_sagemaker_training_job
from training.aws_batch_service import get_training_metrics_payload
from training.views import serialize_training_job_event

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = {"pending", "uploading", "running"}
SYNC_INTERVAL_SECONDS = 3


@database_sync_to_async
def _get_job_for_user(job_id: int, user):
    return TrainingJob.objects.filter(id=job_id, tenant=user).first()


@database_sync_to_async
def _refresh_job(job):
    from authentication.models import TrainingJob

    return TrainingJob.objects.filter(pk=job.pk).select_related("tenant").first()


@database_sync_to_async
def _do_refresh_status(job):

    try:
        if job.training_backend == "aws_batch":
            refresh_aws_batch_training_job(job)
        elif job.training_backend != "local":
            refresh_sagemaker_training_job(job)
    except Exception as exc:
        logger.warning("WS status refresh failed for job %s: %s", job.pk, exc)


@database_sync_to_async
def _get_logs(job):
    from training.aws_batch_service import (
        get_aws_batch_training_log_payload,
        strip_training_metric_lines,
    )

    try:
        if job.training_backend == "aws_batch":
            payload = get_aws_batch_training_log_payload(job)
            text = strip_training_metric_lines(payload.get("logs", "") or "")
            return {
                "text": text or "No training logs available yet.",
                "log_stream_name": payload.get("log_stream_name", ""),
            }
    except Exception as exc:
        logger.warning("WS logs fetch failed for job %s: %s", job.pk, exc)

    logs = (job.training_logs or "").strip()
    return {"text": logs or "No training logs available yet.", "log_stream_name": ""}


@database_sync_to_async
def _get_metrics(job):
    try:
        return get_training_metrics_payload(job)
    except Exception as exc:
        logger.warning("WS metrics fetch failed for job %s: %s", job.pk, exc)
        return {"metrics_available": False, "history": [], "latest": None, "message": str(exc)}


@database_sync_to_async
def _get_events(job):
    try:
        return [serialize_training_job_event(event) for event in job.events.order_by("created_at")]
    except Exception as exc:
        logger.warning("WS events fetch failed for job %s: %s", job.pk, exc)
        return []


def _serialize_job(job) -> dict:
    runtime_seconds = job.runtime_seconds or 0
    if job.status == "running" and job.started_at:
        elapsed = int((timezone.now() - job.started_at).total_seconds())
        runtime_seconds = max(elapsed, 0)

    return {
        "id": job.id,
        "name": job.name,
        "model_version": job.model_version,
        "entry_point": job.entry_point,
        "training_backend": job.training_backend,
        "vcpu": job.vcpu,
        "memory": job.memory,
        "max_runtime_seconds": job.max_runtime_seconds,
        "accelerator_type": job.accelerator_type,
        "accelerator_count": job.accelerator_count,
        "retry_of": job.retry_of_id,
        "status": job.status,
        "error_message": job.error_message,
        "stop_reason": job.stop_reason,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        "runtime_seconds": runtime_seconds,
        "is_deleted": bool(job.deleted_at),
        "deleted_at": job.deleted_at.isoformat() if job.deleted_at else None,
        "s3_source_uri": job.s3_source_uri,
        "output_s3_uri": job.output_s3_uri,
        "model_artifact_uri": job.model_artifact_uri,
        "external_job_id": job.external_job_id,
        "sagemaker_job_name": job.sagemaker_job_name,
    }


def _default_serializer(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


class TrainingJobConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if not user or isinstance(user, AnonymousUser) or not user.is_authenticated:
            await self.close(code=4001)
            return

        try:
            job_id = int(self.scope["url_route"]["kwargs"]["job_id"])
        except (KeyError, ValueError, TypeError):
            await self.close(code=4003)
            return

        job = await _get_job_for_user(job_id, user)
        if not job:
            await self.close(code=4003)
            return

        self._job_id = job_id
        self._user = user
        self._closed = False

        await self.accept()
        logger.info("WS connected: user=%s job=%s", user.pk, job_id)
        self._sync_task = asyncio.create_task(self._sync_loop())

    async def disconnect(self, close_code):
        self._closed = True
        sync_task = getattr(self, "_sync_task", None)
        if sync_task:
            sync_task.cancel()
        logger.info(
            "WS disconnected: user=%s job=%s code=%s",
            getattr(self, "_user", "?"),
            getattr(self, "_job_id", "?"),
            close_code,
        )

    async def receive(self, text_data=None, bytes_data=None):
        return None

    async def _sync_loop(self):
        terminal_sent = False
        cycle = 0

        while not self._closed:
            try:
                job = await _get_job_for_user(self._job_id, self._user)
                if not job:
                    await self._send_error("Training job no longer accessible.")
                    break

                if job.status in ACTIVE_STATUSES:
                    await _do_refresh_status(job)
                    job = await _refresh_job(job)

                await self._send_snapshot(job)

                if job.status in ACTIVE_STATUSES:
                    await self._send_logs(job)
                    if cycle % 2 == 0:
                        await self._send_metrics(job)
                    if cycle % 3 == 0:
                        await self._send_events(job)
                elif not terminal_sent:
                    terminal_sent = True
                    await self._send_logs(job)
                    await self._send_metrics(job)
                    await self._send_events(job)
                    await self._send_json({
                        "type": f"training.job.{job.status}",
                        "job_id": job.id,
                        "status": job.status,
                    })
                    await asyncio.sleep(60)
                    continue

                cycle += 1
                await asyncio.sleep(SYNC_INTERVAL_SECONDS)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                if self._closed:
                    break
                logger.exception("WS sync error for job %s: %s", self._job_id, exc)
                await self._send_error(f"Sync error: {exc}")
                await asyncio.sleep(SYNC_INTERVAL_SECONDS)

    async def _send_snapshot(self, job):
        serialized = _serialize_job(job)
        await self._send_json({
            "type": "training.job.snapshot",
            "job": serialized,
            "runtime_seconds": serialized["runtime_seconds"],
            "status": job.status,
            "updated_at": timezone.now().isoformat(),
        })

    async def _send_logs(self, job):
        logs_data = await _get_logs(job)
        await self._send_json({
            "type": "training.job.logs",
            "job_id": job.id,
            "text": logs_data["text"],
            "log_stream_name": logs_data["log_stream_name"],
            "updated_at": timezone.now().isoformat(),
        })

    async def _send_metrics(self, job):
        metrics = await _get_metrics(job)
        await self._send_json({
            "type": "training.job.metrics",
            "job_id": job.id,
            "metrics": metrics,
            "sampled_at": timezone.now().isoformat(),
        })

    async def _send_events(self, job):
        events = await _get_events(job)
        await self._send_json({
            "type": "training.job.events",
            "job_id": job.id,
            "events": events,
        })

    async def _send_error(self, message: str):
        if not self._closed:
            await self._send_json({"type": "training.error", "message": message})

    async def _send_json(self, data: dict):
        if self._closed:
            return
        try:
            await self.send(text_data=json.dumps(data, default=_default_serializer))
        except Exception:
            self._closed = True
