"""Application entrypoint.

Loads config, initializes logging, builds the engine (TTS providers + fallback
router + audio clock + avatar controllers), starts the FastAPI server with
health checks and WebSocket streaming, serves both ``/`` and ``/rainmeter``,
exposes benchmark hooks, and shuts down cleanly.

Run with::

    python -m app.main            # or: visual-actor
"""

from __future__ import annotations

import argparse
import signal
import sys

from fastapi import FastAPI

from app.config import get_config
from app.logging_setup import setup_logging
from app.server import VisualActorEngine, create_app


def build() -> tuple[VisualActorEngine, FastAPI]:
    """Construct the engine and FastAPI app (used by servers and tests)."""
    config = get_config()
    logger = setup_logging()
    logger.info(
        "Visual Actor starting | provider=%s renderer=%s fps=%d %dx%d",
        config.voices.active,
        config.actor.renderer,
        config.actor.fps,
        config.actor.width,
        config.actor.height,
    )
    engine = VisualActorEngine(config)
    app = create_app(engine)

    @app.get("/benchmark/quick")
    async def benchmark_quick(text: str = "Hello, this is a low latency visual actor test."):
        """Benchmark hook: run one headless session and return its grade."""
        result = await engine.speak(text, render_frames=True, store_frames=False)
        return {
            "provider": result.provider,
            "grade": result.session.grade(),
            "passed": result.session.passed(),
            "frames": len(result.frame_times_ms),
        }

    return engine, app


def main() -> int:
    parser = argparse.ArgumentParser(description="Visual Actor local server")
    config = get_config()
    parser.add_argument("--host", default=config.server.host)
    parser.add_argument("--port", type=int, default=config.server.port)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    import uvicorn

    _, app = build()

    def _graceful(*_: object) -> None:
        sys.exit(0)

    signal.signal(signal.SIGINT, _graceful)
    signal.signal(signal.SIGTERM, _graceful)

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
