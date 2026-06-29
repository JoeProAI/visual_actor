"""Audio stream plumbing: bridges TTS chunks into the shared audio clock.

Provides :class:`AudioStreamer`, which consumes an async iterator of
:class:`~app.tts.base.AudioChunk` and feeds the :class:`~app.audio.clock.AudioClock`,
emitting per-chunk metadata (playback start ms, prosody, visemes) that the sync
controller turns into animation. Everything here is async and non-blocking.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

import numpy as np

from app.audio.clock import AudioClock
from app.audio.phonemes import VisemeFrame, audio_to_visemes
from app.audio.prosody import ProsodyFrame, extract_prosody
from app.tts.base import AudioChunk


@dataclass(slots=True)
class StreamedChunk:
    """An audio chunk after analysis, aligned to clock playback time."""

    pcm: np.ndarray
    sample_rate: int
    playback_start_ms: float
    visemes: list[VisemeFrame]
    prosody: list[ProsodyFrame]
    is_final: bool


class AudioStreamer:
    """Feeds streamed audio into the clock and yields analyzed chunks."""

    def __init__(self, clock: AudioClock) -> None:
        self.clock = clock

    async def process(self, chunks: AsyncIterator[AudioChunk]) -> AsyncIterator[StreamedChunk]:
        async for chunk in chunks:
            if chunk.sample_rate != self.clock.sample_rate and len(chunk.pcm):
                self.clock.sample_rate = chunk.sample_rate
            start_ms = self.clock.feed(chunk.pcm)
            visemes = audio_to_visemes(chunk.pcm, chunk.sample_rate, start_ms)
            prosody = extract_prosody(chunk.pcm, chunk.sample_rate, start_ms)
            yield StreamedChunk(
                pcm=chunk.pcm,
                sample_rate=chunk.sample_rate,
                playback_start_ms=start_ms,
                visemes=visemes,
                prosody=prosody,
                is_final=chunk.is_final,
            )
