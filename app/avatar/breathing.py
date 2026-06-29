"""Breathing controller: subtle chest/shoulder/head motion synced to speech.

Breathing slows slightly while speaking (breath held on phrases) and deepens
during pauses (inhale before the next phrase). Output is a single ``breath``
scalar plus a small head-pitch contribution that the renderer uses to lift the
chest/shoulders and bob the head.
"""

from __future__ import annotations

import numpy as np

from app.avatar.blendshapes import Blendshapes
from app.config import MotionConfig


class BreathingController:
    """Procedural breathing cycle modulated by voice activity."""

    def __init__(self, config: MotionConfig) -> None:
        self.config = config
        self._phase = 0.0

    def update(self, dt_s: float, speaking: bool) -> Blendshapes:
        rate = self.config.breathing_rate_hz
        # inhale a touch faster when not speaking (catching breath)
        rate *= 0.85 if speaking else 1.15
        self._phase = (self._phase + dt_s * rate) % 1.0
        # smooth in/out breath curve
        breath = 0.5 * (1.0 - np.cos(2 * np.pi * self._phase))
        bs = Blendshapes()
        bs.breath = float(breath)
        bs.headPitch = float((breath - 0.5) * 1.0)  # gentle bob with breath
        return bs
