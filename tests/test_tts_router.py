"""TTS router fallback behavior tests."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import numpy as np
import pytest

from app.config import ProviderConfig, get_config
from app.latency_monitor import LatencySession
from app.tts.base import AudioChunk, TTSProvider
from app.tts.router import TTSRouter


class _FakeProvider(TTSProvider):
    def __init__(self, name, available=True, delay=0.0, chunks=2, empty=False):
        super().__init__(ProviderConfig(type="piper", sample_rate=22050))
        self.name = name
        self._available = available
        self._delay = delay
        self._chunks = chunks
        self._empty = empty

    async def is_available(self) -> bool:
        return self._available

    async def stream(self, text: str) -> AsyncIterator[AudioChunk]:
        if self._delay:
            await asyncio.sleep(self._delay)
        if self._empty:
            return
        for i in range(self._chunks):
            yield AudioChunk(
                pcm=np.ones(220, dtype=np.float32) * 0.1,
                sample_rate=22050,
                index=i,
                is_final=(i == self._chunks - 1),
            )


def _router(providers, chain) -> TTSRouter:
    cfg = get_config()
    cfg.latency.fallback.first_chunk_timeout_ms = 30
    router = TTSRouter(cfg, providers=providers)
    router.chain = chain
    router.first_chunk_timeout = 0.03
    return router


async def _collect(router, text, session=None):
    return [c async for c in router.synthesize(text, session=session)]


async def test_primary_used_when_fast():
    providers = {"a": _FakeProvider("a"), "b": _FakeProvider("b")}
    router = _router(providers, ["a", "b"])
    chunks = await _collect(router, "hello")
    assert router.last_provider == "a"
    assert len(chunks) == 2


async def test_fallback_on_timeout():
    providers = {
        "slow": _FakeProvider("slow", delay=0.2),
        "fast": _FakeProvider("fast"),
    }
    router = _router(providers, ["slow", "fast"])
    session = LatencySession(config=get_config().latency)
    session.mark("text_submitted")
    chunks = await _collect(router, "hi", session=session)
    assert router.last_provider == "fast"
    assert "fallback_trigger" in session.marks
    assert len(chunks) == 2


async def test_fallback_on_unavailable():
    providers = {
        "down": _FakeProvider("down", available=False),
        "up": _FakeProvider("up"),
    }
    router = _router(providers, ["down", "up"])
    chunks = await _collect(router, "hi")
    assert router.last_provider == "up"
    assert chunks


async def test_fallback_on_empty_stream():
    providers = {
        "empty": _FakeProvider("empty", empty=True),
        "real": _FakeProvider("real"),
    }
    router = _router(providers, ["empty", "real"])
    chunks = await _collect(router, "hi")
    assert router.last_provider == "real"
    assert chunks


async def test_chain_exhausted_raises():
    providers = {"only": _FakeProvider("only", empty=True)}
    router = _router(providers, ["only"])
    with pytest.raises(RuntimeError):
        await _collect(router, "hi")


def test_real_chain_has_local_backup():
    cfg = get_config()
    router = TTSRouter(cfg)
    # Piper + Fish are always available (formant fallback), so the chain can
    # always synthesize even with no ElevenLabs key.
    assert "piper" in router.chain
    assert "fish_speech_s2" in router.chain
