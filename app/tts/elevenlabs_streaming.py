"""ElevenLabs streaming TTS provider (primary engine).

Uses the ElevenLabs **streaming** endpoint with the **Flash** low-latency model
(``eleven_flash_v2_5`` by default) and ``optimize_streaming_latency`` so the
first PCM chunk arrives as fast as possible. Audio is requested as raw PCM
(``pcm_22050``) and converted straight to float32 for the shared audio clock,
avoiding any decode step on the hot path.

The implementation talks directly to the HTTP streaming API via ``httpx`` (no
SDK dependency required), which gives us byte-level control over chunk timing.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx

from app.config import ProviderConfig
from app.logging_setup import get_logger
from app.tts.base import AudioChunk, TTSProvider, pcm16_to_float32

log = get_logger("tts.elevenlabs")

_API_ROOT = "https://api.elevenlabs.io/v1"


class ElevenLabsStreamingProvider(TTSProvider):
    """Primary low-latency voice provider backed by ElevenLabs Flash."""

    name = "elevenlabs"

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self.api_key = (config.api_key or "").strip()
        self.voice_id = config.voice_id or ""
        self.model_id = config.model_id or "eleven_flash_v2_5"
        # output_format like "pcm_22050" -> sample_rate 22050
        fmt = config.output_format or "pcm_22050"
        self.output_format = fmt
        if fmt.startswith("pcm_"):
            self.sample_rate = int(fmt.split("_", 1)[1])

    async def is_available(self) -> bool:
        """Available only when an API key and voice id are configured."""
        return bool(self.api_key and self.voice_id)

    def _request(self, client: httpx.AsyncClient, text: str):
        url = f"{_API_ROOT}/text-to-speech/{self.voice_id}/stream"
        params = {
            "output_format": self.output_format,
            "optimize_streaming_latency": str(self.config.optimize_streaming_latency),
        }
        body = {
            "text": text,
            "model_id": self.model_id,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        }
        if self.config.chunk_length_schedule:
            body["generation_config"] = {
                "chunk_length_schedule": self.config.chunk_length_schedule
            }
        headers = {"xi-api-key": self.api_key, "accept": "audio/pcm", "content-type": "application/json"}
        return client.stream("POST", url, params=params, json=body, headers=headers)

    async def stream(self, text: str) -> AsyncIterator[AudioChunk]:
        if not await self.is_available():
            log.warning("ElevenLabs not configured (missing API key / voice id)")
            return
        index = 0
        # Short connect timeout so the router can fail over fast if EL is slow.
        timeout = httpx.Timeout(connect=2.0, read=30.0, write=5.0, pool=2.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                async with self._request(client, text) as resp:
                    if resp.status_code != 200:
                        detail = (await resp.aread())[:200]
                        log.warning("ElevenLabs HTTP %s: %s", resp.status_code, detail)
                        return
                    carry = b""
                    async for raw in resp.aiter_bytes():
                        if not raw:
                            continue
                        buf = carry + raw
                        # keep even number of bytes (int16 frames)
                        usable = len(buf) - (len(buf) % 2)
                        carry = buf[usable:]
                        pcm = pcm16_to_float32(buf[:usable])
                        if len(pcm) == 0:
                            continue
                        yield AudioChunk(pcm=pcm, sample_rate=self.sample_rate, index=index)
                        index += 1
            except (httpx.HTTPError, OSError) as exc:
                log.warning("ElevenLabs stream error: %s", exc)
                return
        yield AudioChunk(
            pcm=pcm16_to_float32(b""), sample_rate=self.sample_rate, index=index, is_final=True
        )
