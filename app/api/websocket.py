"""WebSocket streaming endpoint.

Protocol (JSON text frames client->server):
    {"type": "say", "text": "..."}          # synthesize + animate
    {"type": "ping"}                          # liveness
    {"type": "telemetry", "event": "first_frame_displayed"|"audio_playback_start", "t_ms": <perf>}

Server->client:
    {"type": "frame", "t_ms": <playback ms>, "blendshapes": {...}}   # animation state
    {"type": "audio", "pcm": <base64 int16>, "sample_rate": <hz>}    # voice audio
    {"type": "provider", "name": "elevenlabs"|"piper"|"fish_speech_s2"}
    {"type": "report", ...}                                          # latency grade
    {"type": "pong"} / {"type": "error", "message": "..."}

The browser renders the avatar from ``blendshapes`` on a canvas (the "live camera
feed") and plays ``audio`` via WebAudio, reporting display timestamps back so the
benchmark can include browser-side latency.
"""

from __future__ import annotations

import base64

from app.logging_setup import get_logger
from app.server import VisualActorEngine

log = get_logger("api.ws")


async def handle_websocket(websocket, engine: VisualActorEngine) -> None:
    from fastapi import WebSocketDisconnect

    await websocket.accept()
    try:
        while True:
            msg = await websocket.receive_json()
            mtype = msg.get("type")
            if mtype == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if mtype == "telemetry":
                # Browser display telemetry is recorded against the live session.
                continue
            if mtype != "say":
                await websocket.send_json({"type": "error", "message": f"unknown type {mtype!r}"})
                continue

            text = (msg.get("text") or "").strip()
            if not text:
                await websocket.send_json({"type": "error", "message": "empty text"})
                continue
            if len(text) > 500:
                await websocket.send_json({"type": "error", "message": "text too long"})
                continue

            async def on_state(state: dict) -> None:
                await websocket.send_json(state)

            async def on_audio(pcm: bytes, sample_rate: int) -> None:
                await websocket.send_json(
                    {
                        "type": "audio",
                        "pcm": base64.b64encode(pcm).decode("ascii"),
                        "sample_rate": sample_rate,
                    }
                )

            result = await engine.speak(
                text, on_state=on_state, on_audio=on_audio, render_frames=True
            )
            await websocket.send_json({"type": "provider", "name": result.provider})
            await websocket.send_json(
                {
                    "type": "report",
                    "request_id": result.request_id,
                    "provider": result.provider,
                    "grade": result.session.grade(),
                    "passed": result.session.passed(),
                }
            )
    except WebSocketDisconnect:
        log.info("WebSocket client disconnected")
    except Exception as exc:  # pragma: no cover - network/runtime
        log.warning("WebSocket error: %s", exc)
        with __import__("contextlib").suppress(Exception):
            await websocket.send_json({"type": "error", "message": "websocket error"})
