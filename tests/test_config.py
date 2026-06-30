"""Config loading + environment resolution tests."""

from __future__ import annotations

import os

from app.config import load_config, load_yaml


def test_load_config_smoke():
    cfg = load_config()
    assert cfg.voices.active in cfg.voices.providers
    assert cfg.actor.fps >= 1
    assert cfg.actor.width > 0 and cfg.actor.height > 0
    assert cfg.latency.budget.total_first_visible_frame_ms == 100


def test_ordered_chain_starts_with_active():
    cfg = load_config()
    chain = cfg.voices.ordered_chain()
    assert chain[0] == cfg.voices.active
    # no duplicates
    assert len(chain) == len(set(chain))


def test_env_resolution(monkeypatch):
    monkeypatch.setenv("RAINMETER_WIDTH", "777")
    data = load_yaml("rainmeter.yaml")
    assert data["width"] == 777  # numeric coercion of pure ${VAR}


def test_active_provider_accessor():
    cfg = load_config()
    assert cfg.active_provider.type in {"elevenlabs", "piper", "fish_speech_s2"}


def test_avatar_selection():
    cfg = load_config()
    avatar = cfg.actor.active_avatar()
    assert avatar.image.endswith(".png")
    assert len(avatar.anchors.mouth_center) == 2


def test_renderer_choice_is_direct():
    cfg = load_config()
    assert cfg.actor.renderer in {"blendshape", "mesh", "liveportrait"}
    # sanity: config must never select a diffusion backend
    assert "diffusion" not in cfg.actor.renderer
    _ = os.environ  # ensure import used
