"""Eye controller: blinks, saccades, gaze drift, attention shifts.

Generates natural-looking eye motion procedurally on the shared clock. Blinks
follow a Poisson-like cadence; saccades jump gaze to new targets with smooth
settle; gaze drifts slowly between saccades. No randomness leaks into render
timing — only into target selection — so motion stays smooth and deterministic
per seed.
"""

from __future__ import annotations

import numpy as np

from app.avatar.blendshapes import Blendshapes
from app.config import MotionConfig


class EyeController:
    """Procedural eye + gaze animation."""

    def __init__(self, config: MotionConfig, seed: int = 7) -> None:
        self.config = config
        self._rng = np.random.default_rng(seed)
        self._next_blink_s = self._sample_blink_interval()
        self._blink_phase = -1.0  # <0 means not blinking
        self._next_saccade_s = self._sample_saccade_interval()
        self._gaze = np.zeros(2, dtype=np.float32)       # current gaze (x,y) in [-1,1]
        self._gaze_target = np.zeros(2, dtype=np.float32)
        self._t = 0.0

    def _sample_blink_interval(self) -> float:
        rate = max(0.05, self.config.blink_rate_hz)
        return float(self._rng.exponential(1.0 / rate))

    def _sample_saccade_interval(self) -> float:
        rate = max(0.05, self.config.saccade_rate_hz)
        return float(self._rng.exponential(1.0 / rate))

    def update(self, dt_s: float, speaking: bool) -> Blendshapes:
        self._t += dt_s
        bs = Blendshapes()

        # --- blinking ---
        self._next_blink_s -= dt_s
        if self._blink_phase >= 0:
            self._blink_phase += dt_s / 0.12  # ~120ms full blink
            if self._blink_phase >= 1.0:
                self._blink_phase = -1.0
            else:
                # 0..1..0 envelope
                amt = float(np.sin(np.pi * self._blink_phase))
                bs.eyeBlinkLeft = amt
                bs.eyeBlinkRight = amt
        elif self._next_blink_s <= 0:
            self._blink_phase = 0.0
            self._next_blink_s = self._sample_blink_interval()

        # --- saccades + gaze drift ---
        self._next_saccade_s -= dt_s
        if self._next_saccade_s <= 0:
            spread = 0.6 if speaking else 1.0
            self._gaze_target = self._rng.uniform(-spread, spread, size=2).astype(np.float32)
            self._next_saccade_s = self._sample_saccade_interval()
        # smooth settle toward target (saccade) + slow drift
        self._gaze += (self._gaze_target - self._gaze) * min(1.0, dt_s * 12.0)
        drift = self.config.gaze_drift_amplitude * 0.05
        self._gaze += np.array(
            [np.sin(self._t * 0.7), np.cos(self._t * 0.5)], dtype=np.float32
        ) * drift * dt_s

        gx = float(np.clip(self._gaze[0], -1, 1))
        gy = float(np.clip(self._gaze[1], -1, 1))
        if gx >= 0:
            bs.eyeLookOutLeft = gx
            bs.eyeLookInRight = gx
        else:
            bs.eyeLookInLeft = -gx
            bs.eyeLookOutRight = -gx
        if gy >= 0:
            bs.eyeLookUpLeft = gy
            bs.eyeLookUpRight = gy
        else:
            bs.eyeLookDownLeft = -gy
            bs.eyeLookDownRight = -gy
        return bs
