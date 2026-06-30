"""Clean voice-provider interface.

Every TTS backend implements :class:`TTSProvider` and yields raw PCM audio
chunks (16-bit signed, mono) as an async stream. The router only depends on
this interface, so adding or swapping a provider is a one-line config change.
"""

from __future__ import annotations

import abc
from collections.abc import AsyncIterator
from dataclasses import dataclass

import numpy as np

from app.config import ProviderConfig


@dataclass(slots=True)
class AudioChunk:
    """A streamed slice of synthesized audio.

    ``pcm`` is mono float32 in [-1, 1]. ``sample_rate`` is Hz. ``index`` is the
    monotonically increasing chunk index from the producing provider.
    """

    pcm: np.ndarray
    sample_rate: int
    index: int
    is_final: bool = False

    @property
    def duration_ms(self) -> float:
        return 1000.0 * len(self.pcm) / self.sample_rate


def pcm16_to_float32(data: bytes) -> np.ndarray:
    """Convert little-endian int16 PCM bytes to float32 in [-1, 1]."""
    if not data:
        return np.zeros(0, dtype=np.float32)
    arr = np.frombuffer(data, dtype="<i2").astype(np.float32)
    return arr / 32768.0


def float32_to_pcm16(data: np.ndarray) -> bytes:
    """Convert float32 [-1, 1] to little-endian int16 PCM bytes."""
    clipped = np.clip(data, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


class TTSProvider(abc.ABC):
    """Abstract streaming voice provider."""

    name: str = "base"

    def __init__(self, config: ProviderConfig) -> None:
        self.config = config
        self.sample_rate = config.sample_rate

    @abc.abstractmethod
    async def is_available(self) -> bool:
        """Return True if this provider can currently synthesize."""

    @abc.abstractmethod
    def stream(self, text: str) -> AsyncIterator[AudioChunk]:
        """Yield :class:`AudioChunk` objects for ``text`` as they are produced.

        Implementations MUST yield the first chunk as early as possible to
        minimize time-to-first-audio, and set ``is_final=True`` on the last.
        """
        raise NotImplementedError


class ProviderUnavailable(RuntimeError):
    """Raised when a provider cannot synthesize (missing key, model, deps)."""
