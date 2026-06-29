"""Typed configuration loading for Visual Actor.

Loads YAML config files from ``config/`` and resolves ``${ENV_VAR}`` references
against the process environment (after loading ``.env`` if present). Everything
is validated into Pydantic models so the rest of the codebase is fully typed.
"""

from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

try:  # optional, only used to populate os.environ from a local .env
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover - dotenv is optional
    pass

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"

_ENV_PATTERN = re.compile(r"\$\{([A-Z0-9_]+)(?::-(.*?))?\}")


def _resolve_env(value: Any) -> Any:
    """Recursively replace ``${VAR}`` tokens using environment variables.

    Unset variables resolve to an empty string. Pure-numeric results are coerced
    to int so YAML values like ``${RAINMETER_WIDTH}`` become real integers.
    """
    if isinstance(value, str):
        def repl(match: re.Match[str]) -> str:
            name = match.group(1)
            default = match.group(2)
            if name in os.environ and os.environ[name] != "":
                return os.environ[name]
            if default is not None:
                return default
            return ""

        resolved = _ENV_PATTERN.sub(repl, value)
        if resolved != value and _ENV_PATTERN.fullmatch(value):
            if resolved.lstrip("-").isdigit():
                return int(resolved)
            if resolved == "":
                return None
        return resolved
    if isinstance(value, list):
        return [_resolve_env(v) for v in value]
    if isinstance(value, dict):
        return {k: _resolve_env(v) for k, v in value.items()}
    return value


def load_yaml(name: str) -> dict[str, Any]:
    """Load ``config/<name>`` and resolve environment references."""
    path = CONFIG_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"Missing config file: {path}")
    with path.open("r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    return _resolve_env(raw)


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class ProviderConfig(BaseModel):
    type: str
    voice_id: str | None = None
    model_id: str | None = None
    api_key: str | None = None
    model_path: str | None = None
    sample_rate: int = 22050
    output_format: str | None = None
    optimize_streaming_latency: int = 4
    chunk_length_schedule: list[int] = Field(default_factory=list)
    length_scale: float = 1.0
    noise_scale: float = 0.667
    sentence_silence: float = 0.0
    reference_audio: str | None = None
    temperature: float = 0.7


class VoicesConfig(BaseModel):
    active: str
    fallback_order: list[str]
    providers: dict[str, ProviderConfig]

    def ordered_chain(self) -> list[str]:
        """Return the active provider first, then remaining fallbacks."""
        chain = [self.active]
        for name in self.fallback_order:
            if name not in chain:
                chain.append(name)
        return chain


class LatencyBudget(BaseModel):
    total_first_visible_frame_ms: float = 100
    first_audio_chunk_ms: float = 50
    first_mouth_motion_ms: float = 70
    audio_mouth_sync_offset_ms: float = 15
    fallback_switch_ms: float = 20
    min_fps: float = 30
    preferred_fps: float = 60


class FallbackConfig(BaseModel):
    first_chunk_timeout_ms: float = 45
    hard_timeout_ms: float = 120
    max_attempts: int = 3


class LatencyConfig(BaseModel):
    budget: LatencyBudget = Field(default_factory=LatencyBudget)
    fallback: FallbackConfig = Field(default_factory=FallbackConfig)
    stages: list[str] = Field(default_factory=list)


class AvatarAnchors(BaseModel):
    face_center: list[float]
    left_eye: list[float]
    right_eye: list[float]
    mouth_center: list[float]
    jaw: list[float]
    nose: list[float]


class AvatarDef(BaseModel):
    image: str
    anchors: AvatarAnchors


class MotionConfig(BaseModel):
    blink_rate_hz: float = 0.28
    saccade_rate_hz: float = 1.5
    breathing_rate_hz: float = 0.25
    head_sway_amplitude: float = 0.35
    micro_expression_amplitude: float = 0.25
    gaze_drift_amplitude: float = 0.4


class EmotionConfig(BaseModel):
    attack_s: float = 0.12
    release_s: float = 0.45
    neutral_bias: float = 0.6


class ActorConfig(BaseModel):
    avatar: str
    renderer: str = "blendshape"
    fps: int = 60
    width: int = 480
    height: int = 640
    avatars: dict[str, AvatarDef]
    motion: MotionConfig = Field(default_factory=MotionConfig)
    emotion: EmotionConfig = Field(default_factory=EmotionConfig)

    def active_avatar(self) -> AvatarDef:
        return self.avatars[self.avatar]


class RainmeterConfig(BaseModel):
    server_url: str = "http://127.0.0.1:8765/rainmeter"
    width: int = 480
    height: int = 640
    opacity: int = 255
    click_through: int = 0
    always_on_top: int = 1
    draggable: int = 1
    refresh_ms: int = 16
    transparent: int = 1


class ServerConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8765


class AppConfig(BaseModel):
    """Aggregate, fully-typed configuration for the whole application."""

    voices: VoicesConfig
    latency: LatencyConfig
    actor: ActorConfig
    rainmeter: RainmeterConfig
    server: ServerConfig

    @property
    def active_provider(self) -> ProviderConfig:
        return self.voices.providers[self.voices.active]


def load_config() -> AppConfig:
    """Load and validate the full application configuration."""
    server = ServerConfig(
        host=os.environ.get("VISUAL_ACTOR_HOST", "127.0.0.1"),
        port=int(os.environ.get("VISUAL_ACTOR_PORT", "8765")),
    )
    return AppConfig(
        voices=VoicesConfig(**load_yaml("voices.yaml")),
        latency=LatencyConfig(**load_yaml("latency.yaml")),
        actor=ActorConfig(**load_yaml("actor.yaml")),
        rainmeter=RainmeterConfig(**load_yaml("rainmeter.yaml")),
        server=server,
    )


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    """Cached configuration singleton."""
    return load_config()
