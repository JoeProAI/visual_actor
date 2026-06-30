"""Centralized logging configuration using Rich for readable console output."""

from __future__ import annotations

import logging

from rich.logging import RichHandler

_CONFIGURED = False


def setup_logging(level: str = "INFO") -> logging.Logger:
    """Configure root logging once and return the application logger.

    Idempotent: repeated calls do not stack handlers.
    """
    global _CONFIGURED
    if not _CONFIGURED:
        logging.basicConfig(
            level=level,
            format="%(message)s",
            datefmt="[%X]",
            handlers=[RichHandler(rich_tracebacks=True, show_path=False)],
        )
        _CONFIGURED = True
    logger = logging.getLogger("visual_actor")
    logger.setLevel(level)
    return logger


def get_logger(name: str = "visual_actor") -> logging.Logger:
    """Return a namespaced child logger."""
    return logging.getLogger(name)
