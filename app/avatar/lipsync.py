"""Lip-sync controller.

Maintains a time-ordered queue of viseme frames produced from streamed audio and
samples the active mouth blendshapes for any playback position, with smooth
coarticulation (blending between adjacent visemes). Driven by the shared audio
clock so the mouth stays aligned to the voice within the configured tolerance.
"""

from __future__ import annotations

import bisect

from app.audio.phonemes import VisemeFrame
from app.avatar.blendshapes import Blendshapes, viseme_to_blendshapes


class LipSync:
    """Time-indexed viseme buffer with coarticulation smoothing."""

    def __init__(self, lead_ms: float = 0.0) -> None:
        # lead_ms: positive shifts mouth slightly ahead of audio to compensate
        # for downstream render/display latency, keeping sync offset near zero.
        self.lead_ms = lead_ms
        self._times: list[float] = []
        self._frames: list[VisemeFrame] = []
        self._first_motion_ms: float | None = None

    def add(self, frames: list[VisemeFrame]) -> None:
        """Insert new viseme frames, keeping the buffer time-sorted."""
        for f in frames:
            idx = bisect.bisect_left(self._times, f.t_ms)
            self._times.insert(idx, f.t_ms)
            self._frames.insert(idx, f)
            if self._first_motion_ms is None and f.weight > 0.05:
                self._first_motion_ms = f.t_ms

    @property
    def first_motion_ms(self) -> float | None:
        return self._first_motion_ms

    def sample(self, position_ms: float) -> Blendshapes:
        """Return the interpolated mouth blendshapes at ``position_ms``."""
        if not self._frames:
            return Blendshapes()
        t = position_ms + self.lead_ms
        idx = bisect.bisect_right(self._times, t) - 1
        if idx < 0:
            return viseme_to_blendshapes(self._frames[0])
        if idx >= len(self._frames) - 1:
            return viseme_to_blendshapes(self._frames[-1])
        cur, nxt = self._frames[idx], self._frames[idx + 1]
        span = max(1e-6, nxt.t_ms - cur.t_ms)
        alpha = float((t - cur.t_ms) / span)
        return viseme_to_blendshapes(cur).lerp(viseme_to_blendshapes(nxt), alpha)

    def prune(self, before_ms: float) -> None:
        """Drop frames older than ``before_ms`` to bound memory."""
        cut = bisect.bisect_left(self._times, before_ms)
        if cut > 1:
            del self._times[: cut - 1]
            del self._frames[: cut - 1]

    def clear(self) -> None:
        self._times.clear()
        self._frames.clear()
        self._first_motion_ms = None
