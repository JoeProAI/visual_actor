"""Lightweight async pub/sub event bus.

Decouples producers (TTS router, audio clock, avatar controllers) from
consumers (websocket broadcaster, latency monitor, benchmark harness). All
streaming paths are async; handlers are awaited concurrently.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

Handler = Callable[["Event"], Awaitable[None]]


@dataclass(slots=True)
class Event:
    """A single bus event with a topic and arbitrary typed payload."""

    topic: str
    payload: dict[str, Any] = field(default_factory=dict)


class EventBus:
    """Topic-based async event bus with wildcard (``*``) subscriptions."""

    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = defaultdict(list)

    def subscribe(self, topic: str, handler: Handler) -> Callable[[], None]:
        """Register ``handler`` for ``topic`` (use ``*`` for all). Returns an
        unsubscribe callable."""
        self._handlers[topic].append(handler)

        def _unsubscribe() -> None:
            if handler in self._handlers[topic]:
                self._handlers[topic].remove(handler)

        return _unsubscribe

    async def publish(self, topic: str, **payload: Any) -> None:
        """Publish an event to ``topic`` subscribers and ``*`` subscribers."""
        event = Event(topic=topic, payload=payload)
        handlers = list(self._handlers.get(topic, ())) + list(self._handlers.get("*", ()))
        if not handlers:
            return
        await asyncio.gather(*(h(event) for h in handlers), return_exceptions=True)
