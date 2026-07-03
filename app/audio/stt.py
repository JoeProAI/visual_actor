"""Speech-to-text for the conversation mic input.

Uses ``faster-whisper`` when installed; degrades to an explicit "unavailable"
error otherwise so the frontend can fall back to typed input. The model is
loaded lazily on first use and cached for the process lifetime.
"""

from __future__ import annotations

import asyncio
import io
import os
from functools import lru_cache

import numpy as np
import soundfile as sf

from app.logging_setup import get_logger

log = get_logger("audio.stt")

DEFAULT_WHISPER_MODEL = "base.en"


class STTUnavailableError(RuntimeError):
    """Raised when no STT backend is installed."""


@lru_cache(maxsize=1)
def _load_model():
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise STTUnavailableError(
            "faster-whisper is not installed; run: pip install faster-whisper"
        ) from exc
    name = os.environ.get("WHISPER_MODEL", DEFAULT_WHISPER_MODEL)
    log.info("Loading whisper model %r", name)
    return WhisperModel(name, device="cpu", compute_type="int8")


def _transcribe_sync(wav_bytes: bytes) -> str:
    model = _load_model()
    data, sample_rate = sf.read(io.BytesIO(wav_bytes), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sample_rate != 16000:
        # Whisper expects 16 kHz; simple linear resample is adequate for speech.
        n_out = int(len(data) * 16000 / sample_rate)
        data = np.interp(
            np.linspace(0, len(data) - 1, max(1, n_out)),
            np.arange(len(data)),
            data,
        ).astype(np.float32)
    segments, _info = model.transcribe(data, language="en", beam_size=1, vad_filter=True)
    return " ".join(seg.text.strip() for seg in segments).strip()


async def transcribe_wav(wav_bytes: bytes) -> str:
    """Transcribe a WAV payload off the event loop."""
    return await asyncio.to_thread(_transcribe_sync, wav_bytes)
