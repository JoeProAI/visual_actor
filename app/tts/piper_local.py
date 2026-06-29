"""Piper local TTS provider (first local backup).

Piper is a fast, fully-offline neural TTS that runs on CPU. When the Piper
runtime and a voice model (``.onnx`` + ``.onnx.json``) are present, this
provider streams synthesized audio in near-real-time chunks.

If the Piper model is not installed, the provider degrades to a built-in,
fully-deterministic formant synthesizer (:func:`formant_synthesize`) so the
pipeline remains operable completely offline with zero downloads. The degraded
mode is logged clearly and is intentionally simple intelligible speech-like
audio that still drives lip-sync, prosody and benchmarking end to end.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import numpy as np

from app.audio.phonemes import VISEME_FORMANTS, text_to_phonemes
from app.config import ProviderConfig
from app.logging_setup import get_logger
from app.tts.base import AudioChunk, TTSProvider

log = get_logger("tts.piper")


def formant_synthesize(text: str, sample_rate: int = 22050, wpm: float = 170.0) -> np.ndarray:
    """Deterministic formant speech synthesis from text.

    Maps text to visemes (see :mod:`app.audio.phonemes`) and renders each as a
    short two-formant voiced/unvoiced segment with an amplitude envelope. This
    is a real signal-generating synthesizer (not a stub): it produces audible,
    prosodically-varying, lip-syncable audio with no external models.
    """
    visemes = text_to_phonemes(text)
    if not visemes:
        return np.zeros(0, dtype=np.float32)
    # ~ average phones per minute from words-per-minute (≈5 phones/word).
    seg_s = 60.0 / (wpm * 5.0)
    seg_n = max(1, int(sample_rate * seg_s))
    out = np.zeros(len(visemes) * seg_n, dtype=np.float32)
    rng = np.random.default_rng(1234)
    t = np.arange(seg_n) / sample_rate
    for i, v in enumerate(visemes):
        f1, f2, voiced = VISEME_FORMANTS.get(v, (0.0, 0.0, False))
        if v == "sil" or (f1 == 0 and f2 == 0):
            continue
        # gentle declination so pitch falls across the utterance (natural prosody)
        f0 = 120.0 * (1.0 - 0.15 * i / max(1, len(visemes)))
        if voiced:
            sig = (
                0.6 * np.sin(2 * np.pi * f0 * t)
                + 0.3 * np.sin(2 * np.pi * f1 * t)
                + 0.2 * np.sin(2 * np.pi * f2 * t)
            )
        else:
            noise = rng.standard_normal(seg_n)
            # crude bandpass around the fricative formant
            sig = np.convolve(noise, np.hanning(31), mode="same")
            sig *= np.sin(2 * np.pi * f2 * t) * 0.5
        env = np.hanning(seg_n)
        out[i * seg_n : (i + 1) * seg_n] = sig * env * 0.5
    peak = float(np.max(np.abs(out)) + 1e-9)
    return (out / peak * 0.9).astype(np.float32)


class PiperProvider(TTSProvider):
    """Local Piper TTS with deterministic formant fallback."""

    name = "piper"

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self.model_path = config.model_path or ""
        self._voice = None
        self._tried_load = False

    def _load_voice(self):
        if self._tried_load:
            return self._voice
        self._tried_load = True
        path = Path(self.model_path)
        if not path.exists():
            log.warning("Piper model not found at %s; using formant fallback", self.model_path)
            return None
        try:
            from piper.voice import PiperVoice  # type: ignore

            self._voice = PiperVoice.load(str(path))
            log.info("Loaded Piper voice: %s", path.name)
        except Exception as exc:  # pragma: no cover - depends on optional runtime
            log.warning("Piper runtime unavailable (%s); using formant fallback", exc)
            self._voice = None
        return self._voice

    async def is_available(self) -> bool:
        # Always available: real model if present, else deterministic fallback.
        return True

    async def stream(self, text: str) -> AsyncIterator[AudioChunk]:
        if not Path(self.model_path).exists():
            async for chunk in self._stream_fallback(text):
                yield chunk
            return
        voice = await asyncio.to_thread(self._load_voice)
        if voice is not None:
            async for chunk in self._stream_piper(voice, text):
                yield chunk
            return
        async for chunk in self._stream_fallback(text):
            yield chunk

    async def _stream_piper(self, voice, text: str) -> AsyncIterator[AudioChunk]:
        def _synth() -> np.ndarray:
            pcm_parts: list[np.ndarray] = []
            for audio_bytes in voice.synthesize_stream_raw(text):
                pcm_parts.append(np.frombuffer(audio_bytes, dtype="<i2").astype(np.float32) / 32768.0)
            if not pcm_parts:
                return np.zeros(0, dtype=np.float32)
            return np.concatenate(pcm_parts)

        pcm = await asyncio.to_thread(_synth)
        sr = getattr(getattr(voice, "config", None), "sample_rate", self.sample_rate)
        async for chunk in self._emit_chunks(pcm, sr):
            yield chunk

    async def _stream_fallback(self, text: str) -> AsyncIterator[AudioChunk]:
        visemes = text_to_phonemes(text)
        if not visemes:
            yield AudioChunk(pcm=np.zeros(0, dtype=np.float32), sample_rate=self.sample_rate, index=0, is_final=True)
            return
        seg_s = 60.0 / (170.0 * 5.0)
        seg_n = max(1, int(self.sample_rate * seg_s))
        rng = np.random.default_rng(1234)
        t = np.arange(seg_n) / self.sample_rate
        index = 0
        for i, v in enumerate(visemes):
            f1, f2, voiced = VISEME_FORMANTS.get(v, (0.0, 0.0, False))
            if v == "sil" or (f1 == 0 and f2 == 0):
                pcm = np.zeros(seg_n, dtype=np.float32)
            else:
                f0 = 120.0 * (1.0 - 0.15 * i / max(1, len(visemes)))
                if voiced:
                    sig = (
                        0.6 * np.sin(2 * np.pi * f0 * t)
                        + 0.3 * np.sin(2 * np.pi * f1 * t)
                        + 0.2 * np.sin(2 * np.pi * f2 * t)
                    )
                else:
                    noise = rng.standard_normal(seg_n)
                    sig = np.convolve(noise, np.hanning(31), mode="same")
                    sig *= np.sin(2 * np.pi * f2 * t) * 0.5
                env = np.hanning(seg_n)
                pcm = (sig * env * 0.5).astype(np.float32)
                peak = float(np.max(np.abs(pcm)) + 1e-9)
                pcm = (pcm / peak * 0.9).astype(np.float32)
            # Yield the first chunk immediately; downstream code only needs a
            # tiny audible head-start to anchor the shared audio clock.
            yield AudioChunk(
                pcm=pcm,
                sample_rate=self.sample_rate,
                index=index,
                is_final=index == len(visemes) - 1,
            )
            index += 1
            await asyncio.sleep(0)

    async def _emit_chunks(
        self, pcm: np.ndarray, sample_rate: int, chunk_ms: float = 40.0
    ) -> AsyncIterator[AudioChunk]:
        n = max(1, int(sample_rate * chunk_ms / 1000.0))
        index = 0
        for start in range(0, len(pcm), n):
            seg = pcm[start : start + n]
            is_final = start + n >= len(pcm)
            yield AudioChunk(pcm=seg, sample_rate=sample_rate, index=index, is_final=is_final)
            index += 1
            # pace slightly so downstream sees a true stream, not a burst
            await asyncio.sleep(0)
        if index == 0:
            yield AudioChunk(
                pcm=np.zeros(0, dtype=np.float32), sample_rate=sample_rate, index=0, is_final=True
            )
