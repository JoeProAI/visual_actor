"""Monotonic-clock latency tracking for the end-to-end pipeline.

A :class:`LatencySession` records monotonic timestamps for named stages of a
single text-to-speaking-frame request. Offsets are computed relative to the
``text_submitted`` anchor and graded against the configured budget.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from app.config import LatencyConfig


def now_ms() -> float:
    """Current monotonic time in milliseconds (high resolution)."""
    return time.perf_counter() * 1000.0


@dataclass
class LatencySession:
    """Records stage timestamps for one request and grades them."""

    config: LatencyConfig
    anchor_stage: str = "text_submitted"
    marks: dict[str, float] = field(default_factory=dict)

    def mark(self, stage: str, at_ms: float | None = None) -> float:
        """Record ``stage`` at the given (or current) monotonic time."""
        ts = now_ms() if at_ms is None else at_ms
        self.marks.setdefault(stage, ts)
        return ts

    def offset_ms(self, stage: str) -> float | None:
        """Milliseconds from the anchor stage to ``stage`` (None if missing)."""
        if stage not in self.marks or self.anchor_stage not in self.marks:
            return None
        return self.marks[stage] - self.marks[self.anchor_stage]

    def sync_offset_ms(self) -> float | None:
        """Audio-to-mouth sync offset = mouth_motion_start - audio_playback_start."""
        a = self.marks.get("audio_playback_start")
        m = self.marks.get("mouth_motion_start")
        if a is None or m is None:
            return None
        return m - a

    def grade(self) -> dict[str, dict[str, float | bool | None]]:
        """Grade measured offsets against the latency budget.

        Returns a mapping of metric -> {value, target, pass}. Missing metrics
        report ``pass=None``.
        """
        b = self.config.budget
        results: dict[str, dict[str, float | bool | None]] = {}

        def add(metric: str, value: float | None, target: float, less_is_better: bool = True) -> None:
            ok: bool | None
            if value is None:
                ok = None
            elif less_is_better:
                ok = value <= target
            else:
                ok = value >= target
            results[metric] = {"value": value, "target": target, "pass": ok}

        add("total_first_visible_frame_ms", self.offset_ms("first_video_frame"),
            b.total_first_visible_frame_ms)
        add("first_audio_chunk_ms", self.offset_ms("first_audio_chunk"), b.first_audio_chunk_ms)
        add("first_mouth_motion_ms", self.offset_ms("mouth_motion_start"), b.first_mouth_motion_ms)

        sync = self.sync_offset_ms()
        results["audio_mouth_sync_offset_ms"] = {
            "value": sync,
            "target": b.audio_mouth_sync_offset_ms,
            "pass": None if sync is None else abs(sync) <= b.audio_mouth_sync_offset_ms,
        }
        return results

    def passed(self) -> bool:
        """True if all measured metrics pass (missing metrics are ignored)."""
        return all(m["pass"] is not False for m in self.grade().values())


class LatencyMonitor:
    """Factory + registry for per-request latency sessions."""

    def __init__(self, config: LatencyConfig) -> None:
        self.config = config
        self.sessions: dict[str, LatencySession] = {}

    def start(self, request_id: str) -> LatencySession:
        session = LatencySession(config=self.config)
        session.mark("text_submitted")
        self.sessions[request_id] = session
        return session

    def get(self, request_id: str) -> LatencySession | None:
        return self.sessions.get(request_id)

    def finish(self, request_id: str) -> None:
        self.sessions.pop(request_id, None)
