"""Shared monotonic audio clock.

Audio and animation are driven from the *same* clock so the mouth never drifts
from the voice. The clock advances in real time once playback starts; consumers
query :meth:`position_ms` to know exactly how much audio has elapsed and align
viseme/blendshape frames to it.
"""

from __future__ import annotations

import threading
import time

import numpy as np

from app.tts.audio_buffer import RingBuffer


class AudioClock:
    """Monotonic playback clock fed by streamed PCM.

    Tracks total samples ingested and a wall-clock start anchor. Animation
    controllers read :meth:`position_ms` to sample synchronized motion.
    """

    def __init__(self, sample_rate: int = 22050, buffer_seconds: float = 10.0) -> None:
        self.sample_rate = sample_rate
        self.buffer = RingBuffer(int(sample_rate * buffer_seconds))
        self._start_perf: float | None = None
        self._samples_in = 0
        self._lock = threading.Lock()

    def reset(self, sample_rate: int | None = None) -> None:
        with self._lock:
            if sample_rate:
                self.sample_rate = sample_rate
            self.buffer.clear()
            self._start_perf = None
            self._samples_in = 0

    def feed(self, pcm: np.ndarray) -> float:
        """Push PCM into the clock. Starts the clock on first non-empty feed.

        Returns the playback timestamp (ms) at which this chunk begins.
        """
        with self._lock:
            begin_ms = 1000.0 * self._samples_in / self.sample_rate
            if len(pcm) and self._start_perf is None:
                self._start_perf = time.perf_counter()
            self._samples_in += len(pcm)
        self.buffer.write(pcm)
        return begin_ms

    @property
    def started(self) -> bool:
        return self._start_perf is not None

    def position_ms(self) -> float:
        """Elapsed playback position in ms since the clock started."""
        with self._lock:
            if self._start_perf is None:
                return 0.0
            return (time.perf_counter() - self._start_perf) * 1000.0

    @property
    def duration_ms(self) -> float:
        """Total audio ingested, in ms."""
        with self._lock:
            return 1000.0 * self._samples_in / self.sample_rate
