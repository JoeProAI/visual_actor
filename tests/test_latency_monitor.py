"""Latency monitor / session grading tests."""

from __future__ import annotations

from app.config import LatencyConfig
from app.latency_monitor import LatencyMonitor, LatencySession


def _session() -> LatencySession:
    return LatencySession(config=LatencyConfig())


def test_offset_computation():
    s = _session()
    s.mark("text_submitted", at_ms=1000.0)
    s.mark("first_audio_chunk", at_ms=1030.0)
    assert s.offset_ms("first_audio_chunk") == 30.0
    assert s.offset_ms("missing") is None


def test_sync_offset():
    s = _session()
    s.mark("audio_playback_start", at_ms=100.0)
    s.mark("mouth_motion_start", at_ms=108.0)
    assert s.sync_offset_ms() == 8.0


def test_grade_pass_and_fail():
    s = _session()
    s.mark("text_submitted", at_ms=0.0)
    s.mark("first_audio_chunk", at_ms=40.0)      # <= 50 -> pass
    s.mark("first_video_frame", at_ms=90.0)      # <= 100 -> pass
    s.mark("audio_playback_start", at_ms=60.0)
    s.mark("mouth_motion_start", at_ms=66.0)     # offset 6ms <= 15 -> pass
    grade = s.grade()
    assert grade["first_audio_chunk_ms"]["pass"] is True
    assert grade["total_first_visible_frame_ms"]["pass"] is True
    assert grade["audio_mouth_sync_offset_ms"]["pass"] is True
    assert s.passed() is True


def test_grade_fail_when_over_budget():
    s = _session()
    s.mark("text_submitted", at_ms=0.0)
    s.mark("first_video_frame", at_ms=250.0)     # over 100ms budget
    grade = s.grade()
    assert grade["total_first_visible_frame_ms"]["pass"] is False
    assert s.passed() is False


def test_monitor_starts_anchor():
    mon = LatencyMonitor(LatencyConfig())
    s = mon.start("req1")
    assert "text_submitted" in s.marks
    assert mon.get("req1") is s
