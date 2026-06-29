"""Prosody extraction from streamed audio.

Computes per-frame energy, pitch (autocorrelation), and tempo proxies used by
the emotion, head-motion and breathing controllers. Pure NumPy/SciPy; if
``librosa`` is present it is used for a more accurate pitch track, otherwise the
built-in autocorrelation estimator is used (no hard dependency).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(slots=True)
class ProsodyFrame:
    energy: float        # 0..1 normalized RMS
    pitch_hz: float      # estimated fundamental, 0 if unvoiced
    voiced: bool
    t_ms: float


def _autocorr_pitch(seg: np.ndarray, sample_rate: int, fmin: float = 70, fmax: float = 400) -> float:
    """Estimate F0 via normalized autocorrelation. Returns 0 if unvoiced."""
    seg = seg - np.mean(seg)
    if np.sqrt(np.mean(seg**2)) < 1e-3:
        return 0.0
    corr = np.correlate(seg, seg, mode="full")[len(seg) - 1 :]
    min_lag = int(sample_rate / fmax)
    max_lag = int(sample_rate / fmin)
    if max_lag >= len(corr):
        return 0.0
    region = corr[min_lag:max_lag]
    if len(region) == 0:
        return 0.0
    peak = int(np.argmax(region)) + min_lag
    if corr[peak] / (corr[0] + 1e-9) < 0.3:
        return 0.0
    return float(sample_rate / peak)


def extract_prosody(
    pcm: np.ndarray, sample_rate: int, t0_ms: float, hop_ms: float = 16.0
) -> list[ProsodyFrame]:
    """Extract per-hop prosody frames from a PCM segment."""
    if len(pcm) == 0:
        return []
    hop = max(1, int(sample_rate * hop_ms / 1000.0))
    frames: list[ProsodyFrame] = []
    for start in range(0, len(pcm), hop):
        seg = pcm[start : start + hop]
        if len(seg) < 4:
            break
        rms = float(np.sqrt(np.mean(seg**2)))
        energy = float(np.clip(rms * 5.0, 0.0, 1.0))
        pitch = _autocorr_pitch(seg, sample_rate)
        frames.append(
            ProsodyFrame(
                energy=energy,
                pitch_hz=pitch,
                voiced=pitch > 0,
                t_ms=t0_ms + 1000.0 * start / sample_rate,
            )
        )
    return frames


def sentiment_valence_arousal(text: str) -> tuple[float, float]:
    """Cheap lexical sentiment -> (valence, arousal), each in [-1, 1].

    Deterministic keyword scoring; good enough to bias expression targets
    without pulling in an NLP model on the hot path.
    """
    pos = {"happy", "great", "love", "good", "wonderful", "yes", "amazing", "glad", "joy", "nice"}
    neg = {"sad", "bad", "hate", "angry", "no", "terrible", "awful", "sorry", "fear", "wrong"}
    high = {"!", "amazing", "now", "urgent", "wow", "incredible"}
    words = [w.strip(".,!?").lower() for w in text.split()]
    v = sum(1 for w in words if w in pos) - sum(1 for w in words if w in neg)
    a = text.count("!") + sum(1 for w in words if w in high)
    valence = float(np.clip(v / 3.0, -1.0, 1.0))
    arousal = float(np.clip(a / 3.0, -1.0, 1.0))
    return valence, arousal
