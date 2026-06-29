"""Emotion controller.

Maps text sentiment (valence/arousal) and live audio prosody (energy/pitch) to
expression-target blendshapes, with attack/release smoothing so expressions
ease in and out naturally rather than snapping.
"""

from __future__ import annotations

from app.avatar.blendshapes import Blendshapes
from app.config import EmotionConfig


class EmotionController:
    """Produces expression blendshapes from sentiment + prosody, smoothed."""

    def __init__(self, config: EmotionConfig) -> None:
        self.config = config
        self._current = Blendshapes()
        self._valence = 0.0
        self._arousal = 0.0

    def set_sentiment(self, valence: float, arousal: float) -> None:
        self._valence = valence
        self._arousal = arousal

    def _target(self, energy: float, pitch_hz: float) -> Blendshapes:
        """Compute the instantaneous expression target."""
        bs = Blendshapes()
        v, a = self._valence, self._arousal
        # Positive valence -> smile + cheek raise; negative -> frown + brow down.
        if v >= 0:
            smile = 0.15 + 0.5 * v + 0.2 * energy
            bs.mouthSmileLeft = smile
            bs.mouthSmileRight = smile
            bs.cheekSquintLeft = 0.3 * v
            bs.cheekSquintRight = 0.3 * v
            bs.browInnerUp = 0.2 * v
        else:
            bs.mouthFrownLeft = -0.5 * v
            bs.mouthFrownRight = -0.5 * v
            bs.browDownLeft = -0.4 * v
            bs.browDownRight = -0.4 * v
        # Arousal / energy widen eyes and raise outer brows.
        wide = 0.2 * max(a, 0.0) + 0.25 * energy
        bs.eyeWideLeft = wide
        bs.eyeWideRight = wide
        bs.browOuterUpLeft = 0.3 * max(a, 0.0)
        bs.browOuterUpRight = 0.3 * max(a, 0.0)
        # High pitch nudges brows up a touch (surprise-like).
        if pitch_hz > 220:
            bs.browInnerUp = min(1.0, bs.browInnerUp + 0.2)
        return bs

    def update(self, dt_s: float, energy: float, pitch_hz: float) -> Blendshapes:
        """Advance the smoothed expression state by ``dt_s`` seconds."""
        target = self._target(energy, pitch_hz)
        # exponential smoothing with separate attack/release per channel
        import dataclasses

        for f in dataclasses.fields(Blendshapes):
            cur = getattr(self._current, f.name)
            tgt = getattr(target, f.name)
            tau = self.config.attack_s if tgt > cur else self.config.release_s
            alpha = 1.0 - pow(2.718281828, -dt_s / max(1e-3, tau))
            setattr(self._current, f.name, cur + (tgt - cur) * alpha)
        return self._current
