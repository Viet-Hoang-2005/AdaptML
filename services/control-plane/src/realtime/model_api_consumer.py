"""
WebSocket consumer for ModelAPI realtime deployment sync.

Connects to: ws/models/<model_id>/?token=<access_token>

Sends model snapshot, build logs, and endpoint logs while the model
is in an active/transitioning state (building, deploying, unhealthy).
Slows to a heartbeat when terminal (ready/healthy/stopped/failed).
"""

import asyncio
import json
import logging

from datetime import datetime
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth.models import AnonymousUser
from django.utils import timezone
from integrations.hashid_utils import encode_model_id
from channels.db import database_sync_to_async
from deployment.deploy_adapter import get_deploy_adapter
from registry.views import serialize_model_api

logger = logging.getLogger(__name__)

SYNC_INTERVAL_SECONDS = 3

# Build statuses that mean "work in progress"
ACTIVE_BUILD_STATUSES = {"building"}
# Endpoint statuses that mean "work in progress"
ACTIVE_ENDPOINT_STATUSES = {"deploying", "unhealthy"}


@database_sync_to_async
def _get_model_for_user(model_id: int, user):
    from authentication.models import ModelAPI
    return ModelAPI.objects.filter(id=model_id, tenant=user).exclude(status="disabled").first()


@database_sync_to_async
def _refresh_model(model_id: int, user):
    from authentication.models import ModelAPI
    return ModelAPI.objects.filter(id=model_id, tenant=user).select_related("tenant").first()


@database_sync_to_async
def _get_build_logs(model_id: int) -> list:
    """Read build logs from Redis for the given model_id."""
    try:
        import redis as redis_lib
        from django.conf import settings
        redis_url = getattr(settings, "CACHES", {}).get("default", {}).get("LOCATION") or "redis://redis:6379/1"
        # Prefer explicit REDIS_URL env if set
        import os
        redis_url = os.environ.get("REDIS_URL", redis_url)
        r = redis_lib.from_url(redis_url, decode_responses=True)
        hashid_str = encode_model_id(model_id)
        log_key = f"build_logs:{hashid_str}"
        logs = r.lrange(log_key, 0, 499)  # max 500 lines
        return logs or []
    except Exception as exc:
        logger.warning("WS build logs fetch failed for model %s: %s", model_id, exc)
        return []


@database_sync_to_async
def _get_endpoint_logs(model_id: int) -> str:
    """Read recent Docker logs from the endpoint container."""
    try:
        return get_deploy_adapter().endpoint_logs(model_id, tail=100)
    except Exception as exc:
        # Container not running / not found — not an error worth spamming
        return f"[Container not available: {exc}]"


def _serialize_model(model_api) -> dict:
    """Lightweight serializer that avoids importing the whole views module."""
    try:
        return serialize_model_api(model_api)
    except Exception as exc:
        logger.warning("WS model serializer failed for model %s: %s", model_api.pk, exc)
        return {
            "id": model_api.pk,
            "status": model_api.status,
            "build_status": model_api.build_status,
            "endpoint_status": model_api.endpoint_status,
            "updated_at": model_api.updated_at.isoformat() if model_api.updated_at else None,
        }


def _default_serializer(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


class ModelApiConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if not user or isinstance(user, AnonymousUser) or not user.is_authenticated:
            await self.close(code=4001)
            return

        try:
            model_id = int(self.scope["url_route"]["kwargs"]["model_id"])
        except (KeyError, ValueError, TypeError):
            await self.close(code=4003)
            return

        model = await _get_model_for_user(model_id, user)
        if not model:
            await self.close(code=4003)
            return

        self._model_id = model_id
        self._user = user
        self._closed = False

        await self.accept()
        logger.info("ModelAPI WS connected: user=%s model=%s", user.pk, model_id)
        self._sync_task = asyncio.create_task(self._sync_loop())

    async def disconnect(self, close_code):
        self._closed = True
        sync_task = getattr(self, "_sync_task", None)
        if sync_task:
            sync_task.cancel()
        logger.info(
            "ModelAPI WS disconnected: user=%s model=%s code=%s",
            getattr(self, "_user", "?"),
            getattr(self, "_model_id", "?"),
            close_code,
        )

    async def receive(self, text_data=None, bytes_data=None):
        """No client→server messages are expected; ignore gracefully."""
        return None

    async def _sync_loop(self):
        terminal_sent = False
        cycle = 0

        while not self._closed:
            try:
                model = await _refresh_model(self._model_id, self._user)
                if not model:
                    await self._send_error("Model API no longer accessible.")
                    break

                serialized = _serialize_model(model)
                build_status = model.build_status or "not_started"
                endpoint_status = model.endpoint_status or "not_deployed"

                is_active = (
                    build_status in ACTIVE_BUILD_STATUSES
                    or endpoint_status in ACTIVE_ENDPOINT_STATUSES
                )

                # Always send snapshot
                await self._send_json({
                    "type": "model.snapshot",
                    "model_id": model.pk,
                    "model": serialized,
                    "status": model.status,
                    "build_status": build_status,
                    "endpoint_status": endpoint_status,
                    "updated_at": timezone.now().isoformat(),
                })

                if is_active:
                    terminal_sent = False
                    # Build logs while building
                    if build_status in ACTIVE_BUILD_STATUSES:
                        logs = await _get_build_logs(model.pk)
                        await self._send_json({
                            "type": "model.build_logs",
                            "model_id": model.pk,
                            "logs": logs,
                            "updated_at": timezone.now().isoformat(),
                        })
                    # Endpoint logs while deploying/unhealthy (every 2nd cycle to reduce noise)
                    if endpoint_status in ACTIVE_ENDPOINT_STATUSES and cycle % 2 == 0:
                        logs = await _get_endpoint_logs(model.pk)
                        await self._send_json({
                            "type": "model.endpoint_logs",
                            "model_id": model.pk,
                            "logs": logs,
                            "updated_at": timezone.now().isoformat(),
                        })
                elif not terminal_sent:
                    terminal_sent = True
                    # Final build logs burst when build ends
                    if build_status not in ACTIVE_BUILD_STATUSES and build_status != "not_started":
                        logs = await _get_build_logs(model.pk)
                        await self._send_json({
                            "type": "model.build_logs",
                            "model_id": model.pk,
                            "logs": logs,
                            "updated_at": timezone.now().isoformat(),
                        })
                    # Final endpoint logs burst
                    if endpoint_status not in {"not_deployed"}:
                        logs = await _get_endpoint_logs(model.pk)
                        await self._send_json({
                            "type": "model.endpoint_logs",
                            "model_id": model.pk,
                            "logs": logs,
                            "updated_at": timezone.now().isoformat(),
                        })
                    # Sleep longer in terminal state — still alive for manual health-check updates
                    await asyncio.sleep(60)
                    continue

                cycle += 1
                await asyncio.sleep(SYNC_INTERVAL_SECONDS)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                if self._closed:
                    break
                logger.exception("ModelAPI WS sync error for model %s: %s", self._model_id, exc)
                await self._send_error(f"Sync error: {exc}")
                await asyncio.sleep(SYNC_INTERVAL_SECONDS)

    async def _send_error(self, message: str):
        if not self._closed:
            await self._send_json({"type": "model.error", "message": message})

    async def _send_json(self, data: dict):
        if self._closed:
            return
        try:
            await self.send(text_data=json.dumps(data, default=_default_serializer))
        except Exception:
            self._closed = True
