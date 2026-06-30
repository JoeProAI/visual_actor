"""HTTP + WebSocket routes for the Visual Actor server.

Serves the web demo at ``/``, the Rainmeter widget page at ``/rainmeter``, a
health check at ``/health``, a server-rendered MJPEG "live camera feed" at
``/stream``, and the streaming WebSocket at ``/ws``.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from app.api.websocket import handle_websocket
from app.avatar.renderer import encode_jpeg
from app.server import VisualActorEngine

WEB_DIR = Path(__file__).parent.parent / "web"


def _read(name: str) -> str:
    return (WEB_DIR / name).read_text(encoding="utf-8")


def build_router(engine: VisualActorEngine):
    from fastapi import APIRouter, WebSocket
    from fastapi.responses import HTMLResponse, StreamingResponse

    router = APIRouter()

    @router.get("/", response_class=HTMLResponse)
    async def index() -> str:
        return _read("index.html")

    @router.get("/rainmeter", response_class=HTMLResponse)
    async def rainmeter() -> str:
        return _read("rainmeter.html")

    @router.get("/health")
    async def health() -> dict:
        return await engine.health()

    @router.get("/config")
    async def config() -> dict:
        return {
            "fps": engine.fps,
            "width": engine.config.actor.width,
            "height": engine.config.actor.height,
            "renderer": engine.config.actor.renderer,
        }

    @router.get("/stream")
    async def stream() -> StreamingResponse:
        """MJPEG stream of the latest server-rendered frame (live camera feed)."""

        async def gen():
            boundary = b"--frame\r\n"
            while True:
                frame = engine.latest_frame
                if frame is not None:
                    jpg = encode_jpeg(frame)
                    yield boundary + b"Content-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
                await asyncio.sleep(1.0 / max(1, engine.fps))

        return StreamingResponse(
            gen(), media_type="multipart/x-mixed-replace; boundary=frame"
        )

    @router.websocket("/ws")
    async def ws(websocket: WebSocket) -> None:
        await handle_websocket(websocket, engine)

    return router
