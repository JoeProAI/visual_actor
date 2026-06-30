"""Lock-free-ish ring buffer for streamed PCM audio.

A fixed-capacity float32 ring buffer used to decouple TTS production from the
audio clock consumer. Overruns drop the oldest samples (keeps latency bounded
rather than growing an unbounded queue).
"""

from __future__ import annotations

import threading

import numpy as np


class RingBuffer:
    """Single-producer / single-consumer float32 ring buffer."""

    def __init__(self, capacity: int) -> None:
        self.capacity = int(capacity)
        self._buf = np.zeros(self.capacity, dtype=np.float32)
        self._read = 0
        self._write = 0
        self._size = 0
        self._lock = threading.Lock()

    def __len__(self) -> int:
        return self._size

    @property
    def available(self) -> int:
        """Samples available to read."""
        return self._size

    def write(self, data: np.ndarray) -> int:
        """Write samples; drops oldest on overflow. Returns samples written."""
        data = np.asarray(data, dtype=np.float32).ravel()
        n = len(data)
        if n == 0:
            return 0
        with self._lock:
            if n > self.capacity:
                data = data[-self.capacity :]
                n = self.capacity
            end = self._write + n
            if end <= self.capacity:
                self._buf[self._write : end] = data
            else:
                first = self.capacity - self._write
                self._buf[self._write :] = data[:first]
                self._buf[: n - first] = data[first:]
            self._write = (self._write + n) % self.capacity
            self._size += n
            if self._size > self.capacity:
                overflow = self._size - self.capacity
                self._read = (self._read + overflow) % self.capacity
                self._size = self.capacity
            return n

    def read(self, n: int) -> np.ndarray:
        """Read up to ``n`` samples; returns fewer if buffer underflows."""
        with self._lock:
            n = min(n, self._size)
            if n == 0:
                return np.zeros(0, dtype=np.float32)
            end = self._read + n
            if end <= self.capacity:
                out = self._buf[self._read : end].copy()
            else:
                first = self.capacity - self._read
                out = np.concatenate([self._buf[self._read :], self._buf[: n - first]])
            self._read = (self._read + n) % self.capacity
            self._size -= n
            return out

    def clear(self) -> None:
        with self._lock:
            self._read = 0
            self._write = 0
            self._size = 0
