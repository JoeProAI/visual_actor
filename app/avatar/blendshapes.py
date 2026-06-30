"""Blendshape model and deterministic viseme -> blendshape mapping.

Uses an ARKit-style blendshape subset sufficient for expressive talking-head
animation. Mapping from visemes to mouth blendshapes is deterministic (a lookup
table), which guarantees zero diffusion / sampling and instant, repeatable
output. An optional ONNX audio->blendshape regressor can be plugged in via
:func:`regress_from_audio` when a model is provided, but the default path is the
deterministic table below.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields

import numpy as np

from app.audio.phonemes import VisemeFrame


@dataclass
class Blendshapes:
    """ARKit-style blendshape weights, each in [0, 1] (or [-1,1] for poses)."""

    # Mouth / jaw
    jawOpen: float = 0.0
    mouthClose: float = 0.0
    mouthFunnel: float = 0.0
    mouthPucker: float = 0.0
    mouthSmileLeft: float = 0.0
    mouthSmileRight: float = 0.0
    mouthFrownLeft: float = 0.0
    mouthFrownRight: float = 0.0
    mouthStretchLeft: float = 0.0
    mouthStretchRight: float = 0.0
    mouthPressLeft: float = 0.0
    mouthPressRight: float = 0.0
    cheekPuff: float = 0.0
    cheekSquintLeft: float = 0.0
    cheekSquintRight: float = 0.0
    # Eyes
    eyeBlinkLeft: float = 0.0
    eyeBlinkRight: float = 0.0
    eyeWideLeft: float = 0.0
    eyeWideRight: float = 0.0
    eyeLookInLeft: float = 0.0
    eyeLookOutLeft: float = 0.0
    eyeLookUpLeft: float = 0.0
    eyeLookDownLeft: float = 0.0
    eyeLookInRight: float = 0.0
    eyeLookOutRight: float = 0.0
    eyeLookUpRight: float = 0.0
    eyeLookDownRight: float = 0.0
    # Brows
    browInnerUp: float = 0.0
    browDownLeft: float = 0.0
    browDownRight: float = 0.0
    browOuterUpLeft: float = 0.0
    browOuterUpRight: float = 0.0
    # Head pose (degrees) and breathing
    headYaw: float = 0.0
    headPitch: float = 0.0
    headRoll: float = 0.0
    breath: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return {k: round(float(v), 5) for k, v in asdict(self).items()}

    def lerp(self, other: Blendshapes, t: float) -> Blendshapes:
        """Linear interpolate toward ``other`` by factor ``t`` in [0,1]."""
        t = float(np.clip(t, 0.0, 1.0))
        out = Blendshapes()
        for f in fields(self):
            a = getattr(self, f.name)
            b = getattr(other, f.name)
            setattr(out, f.name, a + (b - a) * t)
        return out


# Viseme -> mouth blendshape activations (deterministic, instant).
_VISEME_MAP: dict[str, dict[str, float]] = {
    "sil": {"jawOpen": 0.02, "mouthClose": 0.1},
    "PP": {"mouthClose": 1.0, "mouthPressLeft": 0.6, "mouthPressRight": 0.6},
    "FF": {"jawOpen": 0.15, "mouthStretchLeft": 0.3, "mouthStretchRight": 0.3, "mouthClose": 0.3},
    "TH": {"jawOpen": 0.2, "mouthFunnel": 0.2},
    "DD": {"jawOpen": 0.25, "mouthStretchLeft": 0.2, "mouthStretchRight": 0.2},
    "kk": {"jawOpen": 0.3},
    "CH": {"jawOpen": 0.2, "mouthFunnel": 0.5, "mouthPucker": 0.4},
    "SS": {"jawOpen": 0.12, "mouthStretchLeft": 0.5, "mouthStretchRight": 0.5},
    "nn": {"jawOpen": 0.18, "mouthClose": 0.2},
    "RR": {"jawOpen": 0.25, "mouthFunnel": 0.4, "mouthPucker": 0.3},
    "aa": {"jawOpen": 0.85, "mouthStretchLeft": 0.2, "mouthStretchRight": 0.2},
    "E": {"jawOpen": 0.45, "mouthStretchLeft": 0.5, "mouthStretchRight": 0.5},
    "I": {"jawOpen": 0.3, "mouthSmileLeft": 0.3, "mouthSmileRight": 0.3, "mouthStretchLeft": 0.4, "mouthStretchRight": 0.4},
    "O": {"jawOpen": 0.6, "mouthFunnel": 0.6, "mouthPucker": 0.3},
    "U": {"jawOpen": 0.35, "mouthPucker": 0.8, "mouthFunnel": 0.5},
}


def viseme_to_blendshapes(frame: VisemeFrame) -> Blendshapes:
    """Map a viseme frame to mouth/jaw blendshapes, scaled by openness weight."""
    bs = Blendshapes()
    mapping = _VISEME_MAP.get(frame.viseme, _VISEME_MAP["sil"])
    scale = 0.3 + 0.7 * float(np.clip(frame.weight, 0.0, 1.0))
    for key, value in mapping.items():
        setattr(bs, key, value * scale)
    return bs


def regress_from_audio(pcm: np.ndarray, sample_rate: int, model_path: str | None) -> Blendshapes | None:
    """Optional ONNX audio->blendshape regression (direct, single forward pass).

    Returns ``None`` when no model is configured or onnxruntime is unavailable,
    so callers fall back to the deterministic viseme map. This is a direct
    regression (one inference, no iterative denoising / sampling).
    """
    if not model_path:
        return None
    try:  # pragma: no cover - exercised only when a model + onnxruntime exist
        import onnxruntime as ort

        sess = regress_from_audio._session  # type: ignore[attr-defined]
        if sess is None:
            sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
            regress_from_audio._session = sess  # type: ignore[attr-defined]
        feats = pcm.astype(np.float32)[None, :]
        out = sess.run(None, {sess.get_inputs()[0].name: feats})[0].ravel()
        bs = Blendshapes()
        names = [f.name for f in fields(Blendshapes)]
        for name, val in zip(names, out, strict=False):
            setattr(bs, name, float(val))
        return bs
    except Exception:
        return None


regress_from_audio._session = None  # type: ignore[attr-defined]
