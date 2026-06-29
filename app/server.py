"""Visual Actor engine and FastAPI application factory.

The engine wires config -> TTS router -> audio clock -> avatar controllers and
exposes a single :meth:`VisualActorEngine.speak` coroutine that streams a fully
synchronized session. It is consumed by:

* the WebSocket endpoint (live browser / Rainmeter widget),
* the MJPEG ``/stream`` endpoint (server-rendered "live camera feed"),
* the benchmark harness (headless, records timings).

Everything on the streaming path is async; audio and animation are driven from
the same :class:`~app.audio.clock.AudioClock`.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import numpy as np
from fastapi import FastAPI

from app.audio.clock import AudioClock
from app.audio.prosody import sentiment_valence_arousal
from app.audio.stream import AudioStreamer
from app.avatar.renderer import create_renderer
from app.avatar.sync_controller import SyncController
from app.config import AppConfig, get_config
from app.event_bus import EventBus
from app.latency_monitor import LatencyMonitor, LatencySession
from app.logging_setup import get_logger
from app.tts.base import float32_to_pcm16
from app.tts.router import TTSRouter

log = get_logger("server")

StateCallback = Callable[[dict], Awaitable[None]]
AudioCallback = Callable[[bytes, int], Awaitable[None]]


@dataclass
class SpeechResult:
    """Outcome of a speech session, including frames for benchmarking."""

    request_id: str
    provider: str | None
    session: LatencySession
    frame_times_ms: list[float] = field(default_factory=list)
    frames: list[np.ndarray] = field(default_factory=list)
    sync_offset_ms: float | None = None


class VisualActorEngine:
    """Owns shared, long-lived components and runs speech sessions."""

    def __init__(self, config: AppConfig | None = None) -> None:
        self.config = config or get_config()
        self.bus = EventBus()
        self.router = TTSRouter(self.config)
        self.latency = LatencyMonitor(self.config.latency)
        self.renderer = create_renderer(self.config)
        self.fps = self.config.actor.fps
        self._latest_frame: np.ndarray | None = None
        self._latest_state: dict | None = None

    async def health(self) -> dict:
        providers = {}
        for name, p in self.router.providers.items():
            with contextlib.suppress(Exception):
                providers[name] = await p.is_available()
        return {
            "status": "ok",
            "active_provider": self.config.voices.active,
            "chain": self.router.chain,
            "providers": providers,
            "renderer": self.config.actor.renderer,
            "fps": self.fps,
        }

    @property
    def latest_frame(self) -> np.ndarray | None:
        return self._latest_frame

    @property
    def latest_state(self) -> dict | None:
        return self._latest_state

    async def speak(
        self,
        text: str,
        on_state: StateCallback | None = None,
        on_audio: AudioCallback | None = None,
        render_frames: bool = False,
        store_frames: bool = False,
        request_id: str | None = None,
    ) -> SpeechResult:
        """Run one synchronized speech session end to end."""
        request_id = request_id or uuid.uuid4().hex
        session = self.latency.start(request_id)
        valence, arousal = sentiment_valence_arousal(text)

        sync = SyncController(self.config)
        sync.set_sentiment(valence, arousal)
        clock = AudioClock(sample_rate=self.config.active_provider.sample_rate)
        streamer = AudioStreamer(clock)

        result = SpeechResult(request_id=request_id, provider=None, session=session)
        done = asyncio.Event()
        first_blendshape_marked = False
        audio_start_marked = False
        mouth_start_marked = False

        async def animation_loop() -> None:
            nonlocal first_blendshape_marked
            frame_dt = 1.0 / self.fps
            last = time.perf_counter()
            # Run until audio finished producing AND playback caught up.
            while not (done.is_set() and clock.position_ms() >= clock.duration_ms - frame_dt * 1000):
                now = time.perf_counter()
                dt = now - last
                last = now
                pos = clock.position_ms()
                bs = sync.tick(pos, dt)
                state = bs.to_dict()

                if not first_blendshape_marked:
                    session.mark("first_blendshape")
                    first_blendshape_marked = True

                if render_frames or store_frames:
                    frame = self.renderer.render(bs)
                    self._latest_frame = frame
                    if "first_video_frame" not in session.marks:
                        session.mark("first_video_frame")
                    if store_frames:
                        result.frames.append(frame)
                else:
                    if "first_video_frame" not in session.marks:
                        session.mark("first_video_frame")

                if sync.mouth_started and "mouth_motion_start" not in session.marks:
                    session.mark("mouth_motion_start")

                result.frame_times_ms.append(dt * 1000.0)
                self._latest_state = state
                if on_state:
                    await on_state({"type": "frame", "t_ms": pos, "blendshapes": state})

                # pace to target fps
                sleep = frame_dt - (time.perf_counter() - now)
                await asyncio.sleep(max(0.0, sleep))
                if done.is_set() and not clock.started:
                    break

        async def tts_loop() -> None:
            nonlocal audio_start_marked, mouth_start_marked
            async def _on_provider(name: str) -> None:
                result.provider = name

            try:
                chunks = self.router.synthesize(text, session=session, on_provider=_on_provider)
                async for sc in streamer.process(chunks):
                    if not audio_start_marked and len(sc.pcm):
                        session.mark("audio_playback_start")
                        audio_start_marked = True
                    if not mouth_start_marked and any(v.viseme != "sil" for v in sc.visemes):
                        session.mark("mouth_motion_start")
                        mouth_start_marked = True
                    sync.feed_audio_analysis(sc.visemes, sc.prosody)
                    if on_audio and len(sc.pcm):
                        await on_audio(float32_to_pcm16(sc.pcm), sc.sample_rate)
            except Exception as exc:  # pragma: no cover - surfaced to caller
                log.error("TTS loop failed: %s", exc)
            finally:
                done.set()

        anim = asyncio.create_task(animation_loop())
        await tts_loop()
        # let animation drain remaining playback
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(anim, timeout=max(2.0, clock.duration_ms / 1000.0 + 1.0))
        if not anim.done():
            anim.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await anim

        result.sync_offset_ms = session.sync_offset_ms()
        await self.bus.publish("session.complete", request_id=request_id, provider=result.provider)
        self.latency.finish(request_id)
        return result


def create_app(engine: VisualActorEngine | None = None) -> FastAPI:
    """Build the FastAPI application (imported lazily to keep core importable)."""
    from pathlib import Path

    from fastapi.staticfiles import StaticFiles

    from app.api.routes import build_router

    eng = engine or VisualActorEngine()
    app = FastAPI(title="Visual Actor", version="1.0.0")
    app.state.engine = eng
    app.include_router(build_router(eng))

    web_dir = Path(__file__).parent / "web"
    app.mount("/static", StaticFiles(directory=str(web_dir)), name="static")
    return app
