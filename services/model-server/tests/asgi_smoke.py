"""Offline container smoke: two real Uvicorn workers, then graceful shutdown."""

import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            event = await receive()
            if event["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif event["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    else:
        await send({"type": "http.response.start", "status": 200})
        await send({"type": "http.response.body", "body": b"ready"})


def smoke():
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "src.uvicorn_entrypoint",
            "asgi_smoke:app",
            "--service",
            "logging-smoke",
            "--port",
            "8050",
            "--workers",
            "2",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        deadline = time.monotonic() + 15
        while True:
            try:
                with urllib.request.urlopen(
                    "http://127.0.0.1:8050/health", timeout=0.5
                ) as response:
                    assert response.read() == b"ready"
                break
            except (urllib.error.URLError, TimeoutError):
                if time.monotonic() >= deadline or process.poll() is not None:
                    raise AssertionError("Smoke server did not become ready")
                time.sleep(0.1)
    finally:
        process.send_signal(signal.SIGTERM)
        try:
            output, _ = process.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            output, _ = process.communicate()
            raise AssertionError("Smoke server did not stop")
    assert process.returncode == 0, output
    lines = [line for line in output.splitlines() if line]
    assert lines and all(
        line.startswith("ts=") and "service=logging-smoke" in line for line in lines
    ), output
    assert not any("GET /health" in line for line in lines), output
    print(
        f"Uvicorn smoke passed: {len(lines)} logfmt lifecycle lines, no health access log"
    )


if __name__ == "__main__":
    smoke()
