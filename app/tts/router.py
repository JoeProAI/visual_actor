"""Automatic fallback TTS router.

Tries the active provider first (ElevenLabs Flash), and if it does not produce a
first audio chunk within ``first_chunk_timeout_ms`` — or errors / is unavailable
— it immediately advances to the next provider in the chain (Piper, then Fish
Speech S2). The switch decision is taken on a monotonic clock and reported via
the latency session so the benchmark can measure fallback activation time.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable

from app.config import AppConfig
from app.latency_monitor import LatencySession, now_ms
from app.logging_setup import get_logger
from app.tts.base import AudioChunk, TTSProvider
from app.tts.elevenlabs_streaming import ElevenLabsStreamingProvider
from app.tts.fish_speech_s2 import FishSpeechS2Provider
from app.tts.piper_local import PiperProvider

log = get_logger("tts.router")

_PROVIDER_TYPES: dict[str, type[TTSProvider]] = {
    "elevenlabs": ElevenLabsStreamingProvider,
    "piper": PiperProvider,
    "fish_speech_s2": FishSpeechS2Provider,
}


def build_providers(config: AppConfig) -> dict[str, TTSProvider]:
    """Instantiate every configured provider keyed by its config name."""
    providers: dict[str, TTSProvider] = {}
    for name, pcfg in config.voices.providers.items():
        cls = _PROVIDER_TYPES.get(pcfg.type)
        if cls is None:
            log.warning("Unknown provider type %r for %r; skipping", pcfg.type, name)
            continue
        providers[name] = cls(pcfg)
    return providers


class TTSRouter:
    """Routes synthesis through the fallback chain with latency-aware switching."""

    def __init__(self, config: AppConfig, providers: dict[str, TTSProvider] | None = None) -> None:
        self.config = config
        self.providers = providers if providers is not None else build_providers(config)
        self.chain = [n for n in config.voices.ordered_chain() if n in self.providers]
        fb = config.latency.fallback
        self.first_chunk_timeout = fb.first_chunk_timeout_ms / 1000.0
        self.max_attempts = fb.max_attempts
        self.last_provider: str | None = None

    async def synthesize(
        self,
        text: str,
        session: LatencySession | None = None,
        on_provider: Callable[[str], Awaitable[None]] | None = None,
    ) -> AsyncIterator[AudioChunk]:
        """Yield audio chunks from the first provider that responds in time."""
        attempts = 0
        for name in self.chain:
            if attempts >= self.max_attempts:
                break
            provider = self.providers[name]
            attempts += 1
            if not await provider.is_available():
                log.info("Provider %s unavailable; trying next", name)
                if session:
                    session.mark("fallback_trigger")
                continue

            iterator = provider.stream(text).__aiter__()
            if session and name == self.chain[0]:
                session.mark("first_tts_request")

            first: AudioChunk | None = None
            switch_start = now_ms()
            try:
                first = await asyncio.wait_for(iterator.__anext__(), timeout=self.first_chunk_timeout)
            except (TimeoutError, StopAsyncIteration) as exc:
                kind = "timeout" if isinstance(exc, asyncio.TimeoutError) else "empty"
                log.warning("Provider %s %s after %.0fms; failing over", name, kind, self.first_chunk_timeout * 1000)
                if session:
                    session.mark("fallback_trigger")
                await _aclose(iterator)
                continue
            except Exception as exc:  # pragma: no cover - provider-specific
                log.warning("Provider %s error (%s); failing over", name, exc)
                if session:
                    session.mark("fallback_trigger")
                await _aclose(iterator)
                continue

            # Success: this provider produced first audio in time.
            self.last_provider = name
            if session:
                session.mark("first_audio_chunk")
                if "fallback_trigger" in session.marks:
                    # Record how long the switch itself took.
                    session.marks.setdefault("fallback_switch_ms_value", now_ms() - switch_start)
            if on_provider:
                await on_provider(name)
            log.info("TTS provider selected: %s", name)

            if first is not None and len(first.pcm):
                yield first
            try:
                async for chunk in iterator:
                    yield chunk
            finally:
                await _aclose(iterator)
            return

        raise RuntimeError("No TTS provider could synthesize audio (chain exhausted)")


async def _aclose(iterator) -> None:
    aclose = getattr(iterator, "aclose", None)
    if aclose is not None:
        try:
            await aclose()
        except Exception:  # pragma: no cover
            pass
