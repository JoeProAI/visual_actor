"""Phoneme / viseme estimation.

Two complementary paths, both deterministic and diffusion-free:

* :func:`text_to_phonemes` — grapheme-to-phoneme approximation used to derive
  viseme timing directly from text (lowest latency; no audio needed).
* :func:`audio_to_visemes` — energy/spectral-band analysis of streamed PCM to
  estimate the dominant viseme per frame, keeping the mouth locked to the
  *actual* audio rather than predicted text.

Visemes follow the common 15-class Oculus/Preston-Blair-style set, collapsed to
a compact set sufficient for real-time 2D/3D mouth shaping.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# Compact viseme inventory -> canonical mouth shape id.
VISEMES = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"]
VISEME_INDEX = {v: i for i, v in enumerate(VISEMES)}

# Grapheme -> viseme approximation (English). Vowels carry openness; consonants
# carry closure/place of articulation. This is intentionally simple and fast.
_GRAPHEME_VISEME: dict[str, str] = {
    "a": "aa", "e": "E", "i": "I", "o": "O", "u": "U", "y": "I",
    "p": "PP", "b": "PP", "m": "PP",
    "f": "FF", "v": "FF",
    "t": "DD", "d": "DD", "n": "nn", "l": "nn",
    "k": "kk", "g": "kk", "c": "kk", "q": "kk",
    "s": "SS", "z": "SS", "x": "SS",
    "r": "RR", "w": "U", "h": "aa", "j": "CH",
    " ": "sil", ".": "sil", ",": "sil", "!": "sil", "?": "sil",
}

# Voiced/unvoiced + formant centers (Hz) used by the local formant synthesizer.
VISEME_FORMANTS: dict[str, tuple[float, float, bool]] = {
    "aa": (730, 1090, True), "E": (530, 1840, True), "I": (390, 1990, True),
    "O": (570, 840, True), "U": (440, 1020, True),
    "PP": (250, 800, True), "FF": (300, 1400, False), "TH": (300, 1600, False),
    "DD": (350, 1700, True), "kk": (350, 1600, True), "CH": (400, 1800, False),
    "SS": (320, 2200, False), "nn": (380, 1400, True), "RR": (420, 1300, True),
    "sil": (0, 0, False),
}


@dataclass(slots=True)
class VisemeFrame:
    """A viseme estimate at a point in time."""

    viseme: str
    weight: float          # 0..1 confidence / openness
    t_ms: float


def text_to_phonemes(text: str) -> list[str]:
    """Map text to a viseme sequence (one entry per significant grapheme)."""
    out: list[str] = []
    prev = "sil"
    for ch in text.lower():
        v = _GRAPHEME_VISEME.get(ch)
        if v is None:
            continue
        if v == "sil" and prev == "sil":
            continue
        out.append(v)
        prev = v
    return out or ["sil"]


def schedule_visemes(text: str, total_ms: float) -> list[VisemeFrame]:
    """Distribute text-derived visemes evenly across ``total_ms``."""
    seq = text_to_phonemes(text)
    if not seq:
        return []
    step = total_ms / len(seq)
    frames: list[VisemeFrame] = []
    for i, v in enumerate(seq):
        weight = 0.0 if v == "sil" else 1.0
        frames.append(VisemeFrame(viseme=v, weight=weight, t_ms=i * step))
    return frames


def audio_to_visemes(
    pcm: np.ndarray, sample_rate: int, t0_ms: float, hop_ms: float = 16.0
) -> list[VisemeFrame]:
    """Estimate visemes directly from audio energy + spectral centroid.

    Fast, deterministic, no ML: openness from RMS energy; vowel vs. fricative
    discrimination from spectral centroid / zero-crossing rate.
    """
    if len(pcm) == 0:
        return []
    hop = max(1, int(sample_rate * hop_ms / 1000.0))
    frames: list[VisemeFrame] = []
    for start in range(0, len(pcm), hop):
        seg = pcm[start : start + hop]
        if len(seg) < 4:
            break
        rms = float(np.sqrt(np.mean(seg**2)) + 1e-9)
        openness = float(np.clip(rms * 6.0, 0.0, 1.0))
        zcr = float(np.mean(np.abs(np.diff(np.sign(seg)))) / 2.0)
        spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
        freqs = np.fft.rfftfreq(len(seg), 1.0 / sample_rate)
        centroid = float(np.sum(freqs * spec) / (np.sum(spec) + 1e-9))
        if openness < 0.06:
            viseme = "sil"
        elif zcr > 0.25 or centroid > 3500:
            viseme = "SS" if centroid > 4500 else "FF"
        elif centroid > 1700:
            viseme = "E" if openness > 0.5 else "I"
        elif centroid > 900:
            viseme = "aa" if openness > 0.5 else "O"
        else:
            viseme = "U"
        frames.append(
            VisemeFrame(viseme=viseme, weight=openness, t_ms=t0_ms + 1000.0 * start / sample_rate)
        )
    return frames
