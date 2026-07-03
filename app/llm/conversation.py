"""Streaming LLM conversation over the OpenRouter chat completions API.

A :class:`Conversation` keeps per-connection chat history and yields the
assistant reply as complete sentences so each one can be fed into the TTS
pipeline as soon as it is ready (low first-audio latency for long replies).
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import AsyncIterator

import httpx

from app.logging_setup import get_logger

log = get_logger("llm.conversation")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "openai/gpt-4o-mini"
DEFAULT_PERSONA = (
    "You are Aria, a friendly realtime voice avatar. You speak out loud, so keep "
    "replies conversational and brief: one to three short sentences unless the "
    "user asks for detail. No markdown, no emoji, no lists — plain spoken prose."
)

_SENTENCE_END = re.compile(r"([.!?…]+[\"')\]]?)\s")
MAX_HISTORY_MESSAGES = 24
MAX_SENTENCE_BUFFER = 240


def split_complete_sentences(buffer: str) -> tuple[list[str], str]:
    """Split leading complete sentences off ``buffer``; return (sentences, rest)."""
    sentences: list[str] = []
    rest = buffer
    while True:
        match = _SENTENCE_END.search(rest)
        if match is None:
            break
        cut = match.end(1)
        sentence = rest[:cut].strip()
        if sentence:
            sentences.append(sentence)
        rest = rest[cut:].lstrip()
    if len(rest) > MAX_SENTENCE_BUFFER:
        sentences.append(rest.strip())
        rest = ""
    return sentences, rest


class ConversationError(RuntimeError):
    """Raised when the LLM backend cannot produce a reply."""


class Conversation:
    """One chat session: system persona plus rolling user/assistant history."""

    def __init__(self, persona: str | None = None, model: str | None = None) -> None:
        self.persona = persona or os.environ.get("VISUAL_ACTOR_PERSONA") or DEFAULT_PERSONA
        self.model = model or os.environ.get("OPENROUTER_MODEL") or DEFAULT_MODEL
        self.history: list[dict[str, str]] = []

    @staticmethod
    def api_key() -> str | None:
        return os.environ.get("OPENROUTER_API_KEY") or None

    @classmethod
    def available(cls) -> bool:
        return cls.api_key() is not None

    def _messages(self, user_text: str) -> list[dict[str, str]]:
        trimmed = self.history[-MAX_HISTORY_MESSAGES:]
        return [{"role": "system", "content": self.persona}, *trimmed, {"role": "user", "content": user_text}]

    async def reply_sentences(self, user_text: str) -> AsyncIterator[str]:
        """Stream the assistant reply, yielding one sentence at a time."""
        key = self.api_key()
        if not key:
            raise ConversationError("OPENROUTER_API_KEY is not set")

        payload = {
            "model": self.model,
            "messages": self._messages(user_text),
            "stream": True,
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

        buffer = ""
        full_reply: list[str] = []
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
                async with client.stream("POST", OPENROUTER_URL, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        body = (await response.aread()).decode("utf-8", "replace")[:300]
                        raise ConversationError(f"OpenRouter HTTP {response.status_code}: {body}")
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data or data == "[DONE]":
                            continue
                        try:
                            delta = json.loads(data)["choices"][0].get("delta", {}).get("content") or ""
                        except (json.JSONDecodeError, KeyError, IndexError):
                            continue
                        if not delta:
                            continue
                        buffer += delta
                        sentences, buffer = split_complete_sentences(buffer)
                        for sentence in sentences:
                            full_reply.append(sentence)
                            yield sentence
        except httpx.HTTPError as exc:
            raise ConversationError(f"OpenRouter request failed: {exc}") from exc

        tail = buffer.strip()
        if tail:
            full_reply.append(tail)
            yield tail

        if full_reply:
            self.history.append({"role": "user", "content": user_text})
            self.history.append({"role": "assistant", "content": " ".join(full_reply)})
            if len(self.history) > MAX_HISTORY_MESSAGES:
                del self.history[: len(self.history) - MAX_HISTORY_MESSAGES]
