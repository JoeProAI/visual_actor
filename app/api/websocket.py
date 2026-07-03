"""WebSocket streaming endpoint.

Protocol (JSON text frames client->server):
    {"type": "say", "text": "..."}          # synthesize + animate the exact text
    {"type": "chat", "text": "..."}         # LLM conversation turn, reply is spoken
    {"type": "stop"}                          # barge-in: cancel current speech/reply
    {"type": "ping"}                          # liveness
    {"type": "telemetry", "event": "first_frame_displayed"|"audio_playback_start", "t_ms": <perf>}

Server->client:
    {"type": "frame", "t_ms": <playback ms>, "blendshapes": {...}}   # animation state
    {"type": "audio", "pcm": <base64 int16>, "sample_rate": <hz>}    # voice audio
    {"type": "provider", "name": "elevenlabs"|"piper"|"fish_speech_s2"}
    {"type": "chat_delta", "text": "..."}                            # assistant sentence
    {"type": "chat_done", "text": "<full reply>"}
    {"type": "stopped"}                                              # barge-in acknowledged
    {"type": "report", ...}                                          # latency grade
    {"type": "pong"} / {"type": "error", "message": "..."}

Speech runs as a background task so the receive loop stays responsive: a new
``say``/``chat`` or an explicit ``stop`` cancels the in-flight session
(barge-in). The browser renders the avatar from ``blendshapes`` on a canvas and
plays ``audio`` via WebAudio.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib

from app.llm.conversation import Conversation, ConversationError
from app.logging_setup import get_logger
from app.server import VisualActorEngine

log = get_logger("api.ws")

MAX_TEXT_LEN = 500


async def handle_websocket(websocket, engine: VisualActorEngine) -> None:
    from fastapi import WebSocketDisconnect

    await websocket.accept()
    conversation = Conversation()
    current: asyncio.Task | None = None
    send_lock = asyncio.Lock()

    async def send(payload: dict) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    async def on_state(state: dict) -> None:
        await send(state)

    async def on_audio(pcm: bytes, sample_rate: int) -> None:
        await send(
            {
                "type": "audio",
                "pcm": base64.b64encode(pcm).decode("ascii"),
                "sample_rate": sample_rate,
            }
        )

    async def speak(text: str) -> None:
        result = await engine.speak(text, on_state=on_state, on_audio=on_audio, render_frames=True)
        await send({"type": "provider", "name": result.provider})
        await send(
            {
                "type": "report",
                "request_id": result.request_id,
                "provider": result.provider,
                "grade": result.session.grade(),
                "passed": result.session.passed(),
            }
        )

    async def chat(text: str) -> None:
        spoken: list[str] = []
        try:
            async for sentence in conversation.reply_sentences(text):
                await send({"type": "chat_delta", "text": sentence})
                spoken.append(sentence)
                result = await engine.speak(
                    sentence, on_state=on_state, on_audio=on_audio, render_frames=True
                )
                await send({"type": "provider", "name": result.provider})
        except ConversationError as exc:
            log.warning("Conversation failed: %s", exc)
            await send({"type": "error", "message": str(exc)})
            return
        await send({"type": "chat_done", "text": " ".join(spoken)})

    async def cancel_current() -> None:
        nonlocal current
        if current and not current.done():
            current.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await current
        current = None

    try:
        while True:
            msg = await websocket.receive_json()
            mtype = msg.get("type")
            if mtype == "ping":
                await send({"type": "pong"})
                continue
            if mtype == "telemetry":
                # Browser display telemetry is recorded against the live session.
                continue
            if mtype == "stop":
                await cancel_current()
                await send({"type": "stopped"})
                continue
            if mtype not in ("say", "chat"):
                await send({"type": "error", "message": f"unknown type {mtype!r}"})
                continue

            text = (msg.get("text") or "").strip()
            if not text:
                await send({"type": "error", "message": "empty text"})
                continue
            if len(text) > MAX_TEXT_LEN:
                await send({"type": "error", "message": "text too long"})
                continue
            if mtype == "chat" and not Conversation.available():
                await send(
                    {"type": "error", "message": "conversation disabled: OPENROUTER_API_KEY not set"}
                )
                continue

            await cancel_current()
            current = asyncio.create_task(chat(text) if mtype == "chat" else speak(text))
    except WebSocketDisconnect:
        log.info("WebSocket client disconnected")
    except Exception as exc:  # pragma: no cover - network/runtime
        log.warning("WebSocket error: %s", exc)
        with contextlib.suppress(Exception):
            await websocket.send_json({"type": "error", "message": "websocket error"})
    finally:
        if current and not current.done():
            current.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await current
