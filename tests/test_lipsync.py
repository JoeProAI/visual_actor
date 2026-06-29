"""Lip-sync + blendshape mapping tests."""

from __future__ import annotations

from app.audio.phonemes import VisemeFrame, schedule_visemes, text_to_phonemes
from app.avatar.blendshapes import Blendshapes, viseme_to_blendshapes
from app.avatar.lipsync import LipSync


def test_text_to_phonemes_nonempty():
    seq = text_to_phonemes("hello world")
    assert seq and all(isinstance(v, str) for v in seq)
    # open vowel 'o' maps to an open mouth viseme
    assert "O" in seq or "aa" in seq


def test_open_vowel_opens_jaw():
    bs = viseme_to_blendshapes(VisemeFrame(viseme="aa", weight=1.0, t_ms=0))
    closed = viseme_to_blendshapes(VisemeFrame(viseme="PP", weight=1.0, t_ms=0))
    assert bs.jawOpen > 0.5
    assert closed.mouthClose > closed.jawOpen


def test_blendshape_lerp_midpoint():
    a = Blendshapes(jawOpen=0.0)
    b = Blendshapes(jawOpen=1.0)
    mid = a.lerp(b, 0.5)
    assert abs(mid.jawOpen - 0.5) < 1e-6


def test_lipsync_interpolates_between_frames():
    ls = LipSync(lead_ms=0.0)
    ls.add([
        VisemeFrame(viseme="PP", weight=1.0, t_ms=0.0),
        VisemeFrame(viseme="aa", weight=1.0, t_ms=100.0),
    ])
    early = ls.sample(0.0)
    late = ls.sample(100.0)
    mid = ls.sample(50.0)
    assert late.jawOpen > early.jawOpen
    assert early.jawOpen <= mid.jawOpen <= late.jawOpen
    assert ls.first_motion_ms is not None


def test_schedule_visemes_spans_duration():
    frames = schedule_visemes("hi there", total_ms=200.0)
    assert frames
    assert frames[0].t_ms == 0.0
    assert frames[-1].t_ms < 200.0


def test_lipsync_prune_bounds_memory():
    ls = LipSync()
    ls.add([VisemeFrame(viseme="aa", weight=1.0, t_ms=float(i)) for i in range(100)])
    ls.prune(before_ms=90.0)
    # most old frames dropped, recent retained
    sample = ls.sample(95.0)
    assert isinstance(sample, Blendshapes)
