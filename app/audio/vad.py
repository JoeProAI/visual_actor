"""Voice activity detection.

Lightweight energy + zero-crossing VAD with hysteresis. Used to gate breathing
(inhale during silence) and to detect speech onset for mouth-open timing. No
model dependency; deterministic and frame-synchronous.
"""

from __future__ import annotations

import numpy as np


class VAD:
    """Energy-based VAD with attack/release hysteresis."""

    def __init__(
        self,
        sample_rate: int = 22050,
        frame_ms: float = 16.0,
        energy_threshold: float = 0.02,
        attack_frames: int = 1,
        release_frames: int = 6,
    ) -> None:
        self.sample_rate = sample_rate
        self.frame = max(1, int(sample_rate * frame_ms / 1000.0))
        self.energy_threshold = energy_threshold
        self.attack_frames = attack_frames
        self.release_frames = release_frames
        self._active = False
        self._above = 0
        self._below = 0

    def is_speech(self, pcm: np.ndarray) -> bool:
        """Update state with a frame of PCM; return current speech activity."""
        if len(pcm) == 0:
            return self._active
        rms = float(np.sqrt(np.mean(pcm**2)))
        if rms >= self.energy_threshold:
            self._above += 1
            self._below = 0
            if self._above >= self.attack_frames:
                self._active = True
        else:
            self._below += 1
            self._above = 0
            if self._below >= self.release_frames:
                self._active = False
        return self._active

    @property
    def active(self) -> bool:
        return self._active
