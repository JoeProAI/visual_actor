"""Head-motion controller: turns and nods driven by prosody and punctuation.

Produces yaw/pitch/roll (degrees) from speech energy and a slow idle sway.
Emphasis (energy peaks) triggers small nods; sentence boundaries (detected from
punctuation events pushed via :meth:`punctuate`) trigger gentle turns.
"""

from __future__ import annotations

import numpy as np

from app.avatar.blendshapes import Blendshapes
from app.config import MotionConfig


class HeadController:
    """Procedural head pose from prosody + punctuation cues."""

    def __init__(self, config: MotionConfig, seed: int = 11) -> None:
        self.config = config
        self._rng = np.random.default_rng(seed)
        self._t = 0.0
        self._yaw = 0.0
        self._pitch = 0.0
        self._nod_phase = -1.0
        self._turn_target = 0.0

    def punctuate(self) -> None:
        """Signal a sentence boundary -> pick a new gentle turn target."""
        self._turn_target = float(self._rng.uniform(-1, 1)) * 6.0 * self.config.head_sway_amplitude

    def emphasize(self) -> None:
        """Trigger a small nod on an energy emphasis."""
        if self._nod_phase < 0:
            self._nod_phase = 0.0

    def update(self, dt_s: float, energy: float) -> Blendshapes:
        self._t += dt_s
        bs = Blendshapes()
        amp = self.config.head_sway_amplitude

        # idle sway (always present, subtle)
        sway_yaw = np.sin(self._t * 0.6) * 2.0 * amp
        sway_pitch = np.sin(self._t * 0.45 + 1.3) * 1.2 * amp

        # turn toward punctuation target
        self._yaw += (self._turn_target - self._yaw) * min(1.0, dt_s * 2.0)

        # energy-driven nod
        if energy > 0.6 and self._nod_phase < 0:
            self._nod_phase = 0.0
        if self._nod_phase >= 0:
            self._nod_phase += dt_s / 0.25
            if self._nod_phase >= 1.0:
                self._nod_phase = -1.0
            else:
                self._pitch = float(np.sin(np.pi * self._nod_phase)) * 4.0
        else:
            self._pitch *= 0.9

        bs.headYaw = float(self._yaw + sway_yaw + energy * 2.0 * np.sin(self._t * 3.0) * amp)
        bs.headPitch = float(self._pitch + sway_pitch)
        bs.headRoll = float(np.sin(self._t * 0.4) * 1.5 * amp)
        return bs
