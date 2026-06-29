"""Sync controller: fuses every motion source into one blendshape frame.

On each animation tick (driven by the shared audio clock position) it samples:

* lip-sync mouth shapes (from streamed audio visemes),
* emotion expression (sentiment + prosody),
* eyes (blink / saccade / gaze),
* head motion (turns / nods),
* breathing,

and sums them into a single :class:`~app.avatar.blendshapes.Blendshapes` frame
that drives the renderer and is broadcast to clients. Because audio and
animation share one clock, the mouth stays aligned to the voice.
"""

from __future__ import annotations

import dataclasses

import numpy as np

from app.audio.vad import VAD
from app.avatar.blendshapes import Blendshapes
from app.avatar.breathing import BreathingController
from app.avatar.emotions import EmotionController
from app.avatar.eyes import EyeController
from app.avatar.head_motion import HeadController
from app.avatar.lipsync import LipSync
from app.config import AppConfig

# Channels that are additive expressions vs. mouth channels driven by lipsync.
_MOUTH_CHANNELS = {
    "jawOpen", "mouthClose", "mouthFunnel", "mouthPucker",
    "mouthStretchLeft", "mouthStretchRight", "mouthPressLeft", "mouthPressRight",
}


class SyncController:
    """Combines all motion controllers into synchronized blendshape frames."""

    def __init__(self, config: AppConfig) -> None:
        self.config = config
        motion = config.actor.motion
        self.lipsync = LipSync(lead_ms=10.0)
        self.emotion = EmotionController(config.actor.emotion)
        self.eyes = EyeController(motion)
        self.head = HeadController(motion)
        self.breathing = BreathingController(motion)
        self.vad = VAD(sample_rate=config.active_provider.sample_rate)
        self._last_energy = 0.0
        self._last_pitch = 0.0
        self._speaking = False
        self._mouth_started = False

    def set_sentiment(self, valence: float, arousal: float) -> None:
        self.emotion.set_sentiment(valence, arousal)

    def feed_audio_analysis(self, visemes, prosody) -> None:
        """Push freshly-analyzed audio frames into the controllers."""
        self.lipsync.add(visemes)
        if prosody:
            self._last_energy = prosody[-1].energy
            self._last_pitch = prosody[-1].pitch_hz
            if prosody[-1].energy > 0.6:
                self.head.emphasize()

    def punctuate(self) -> None:
        self.head.punctuate()

    @property
    def mouth_started(self) -> bool:
        return self._mouth_started

    def tick(self, position_ms: float, dt_s: float) -> Blendshapes:
        """Produce the combined blendshape frame for ``position_ms``."""
        speaking = self._last_energy > 0.08
        self._speaking = speaking

        mouth = self.lipsync.sample(position_ms)
        if not self._mouth_started and any(
            getattr(mouth, c) > 0.05 for c in _MOUTH_CHANNELS if c != "mouthClose"
        ):
            self._mouth_started = True

        expr = self.emotion.update(dt_s, self._last_energy, self._last_pitch)
        eye = self.eyes.update(dt_s, speaking)
        head = self.head.update(dt_s, self._last_energy)
        breath = self.breathing.update(dt_s, speaking)

        out = Blendshapes()
        for f in dataclasses.fields(Blendshapes):
            name = f.name
            if name in _MOUTH_CHANNELS:
                val = getattr(mouth, name)
            elif name in ("headYaw", "headPitch", "headRoll"):
                val = getattr(head, name) + getattr(breath, name) * (1 if name == "headPitch" else 0)
            elif name == "breath":
                val = getattr(breath, name)
            else:
                # expression + eyes are additive
                val = getattr(expr, name) + getattr(eye, name)
            if name not in ("headYaw", "headPitch", "headRoll"):
                val = float(np.clip(val, 0.0, 1.0))
            setattr(out, name, float(val))
        return out

    def reset(self) -> None:
        self.lipsync.clear()
        self._last_energy = 0.0
        self._last_pitch = 0.0
        self._mouth_started = False
