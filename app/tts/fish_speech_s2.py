"""Fish Speech S2 local TTS provider (second local backup).

Fish Speech S2 is a high-quality open TTS that runs locally (PyTorch). When the
model directory is present and the runtime importable, this provider performs
chunked synthesis. As Fish Speech is distributed as a source checkout rather
than a stable wheel, ``scripts/`` / ``install.sh`` handle acquisition.

If the model is unavailable, the provider degrades to the same deterministic
formant synthesizer used by Piper (with a slightly different voice timbre via a
distinct speaking rate) so the full fallback chain remains exercisable offline.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import numpy as np

from app.config import ProviderConfig
from app.logging_setup import get_logger
from app.tts.base import AudioChunk, TTSProvider
from app.tts.piper_local import formant_synthesize

log = get_logger("tts.fish")


class FishSpeechS2Provider(TTSProvider):
    """Local Fish Speech S2 TTS with deterministic formant fallback."""

    name = "fish_speech_s2"

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self.model_path = config.model_path or ""
        self._engine = None
        self._tried_load = False

    def _load_engine(self):
        if self._tried_load:
            return self._engine
        self._tried_load = True
        path = Path(self.model_path)
        if not path.exists():
            log.warning(
                "Fish Speech S2 model not found at %s; using formant fallback", self.model_path
            )
            return None
        try:
            # Imported lazily; real Fish Speech S2 exposes a TTSInferenceEngine.
            from fish_speech.inference_engine import TTSInferenceEngine  # type: ignore

            self._engine = TTSInferenceEngine(checkpoint_path=str(path))
            log.info("Loaded Fish Speech S2 from %s", path)
        except Exception as exc:  # pragma: no cover - optional runtime
            log.warning("Fish Speech S2 runtime unavailable (%s); using formant fallback", exc)
            self._engine = None
        return self._engine

    async def is_available(self) -> bool:
        return True

    async def stream(self, text: str) -> AsyncIterator[AudioChunk]:
        engine = await asyncio.to_thread(self._load_engine)
        if engine is not None:
            pcm = await asyncio.to_thread(self._synth_engine, engine, text)
        else:
            pcm = await asyncio.to_thread(formant_synthesize, text, self.sample_rate, 150.0)
        async for chunk in self._emit_chunks(pcm, self.sample_rate):
            yield chunk

    def _synth_engine(self, engine, text: str) -> np.ndarray:  # pragma: no cover - optional runtime
        result = engine.inference(text=text, reference_audio=self.config.reference_audio)
        audio = np.asarray(result, dtype=np.float32).ravel()
        peak = float(np.max(np.abs(audio)) + 1e-9)
        return (audio / peak * 0.9).astype(np.float32) if peak > 1 else audio

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
            await asyncio.sleep(0)
        if index == 0:
            yield AudioChunk(
                pcm=np.zeros(0, dtype=np.float32), sample_rate=sample_rate, index=0, is_final=True
            )
