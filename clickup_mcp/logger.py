"""Simple structured logger used across the server."""
from __future__ import annotations

import logging
from typing import Any, Dict, Mapping

from .config import LogLevel


def _level_to_logging(level: LogLevel) -> int:
    return {
        LogLevel.TRACE: logging.DEBUG,
        LogLevel.DEBUG: logging.DEBUG,
        LogLevel.INFO: logging.INFO,
        LogLevel.WARN: logging.WARNING,
        LogLevel.ERROR: logging.ERROR,
    }[level]


def setup_logging(level: LogLevel) -> None:
    logging.basicConfig(
        level=_level_to_logging(level),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )


class Logger:
    """Lightweight wrapper around :mod:`logging` to mirror the TS API."""

    def __init__(self, name: str) -> None:
        self._logger = logging.getLogger(name)

    def debug(self, message: str, extra: Mapping[str, Any] | None = None) -> None:
        if extra:
            self._logger.debug("%s | %s", message, dict(extra))
        else:
            self._logger.debug(message)

    def info(self, message: str, extra: Mapping[str, Any] | None = None) -> None:
        if extra:
            self._logger.info("%s | %s", message, dict(extra))
        else:
            self._logger.info(message)

    def warning(self, message: str, extra: Mapping[str, Any] | None = None) -> None:
        if extra:
            self._logger.warning("%s | %s", message, dict(extra))
        else:
            self._logger.warning(message)

    warn = warning

    def error(self, message: str, extra: Mapping[str, Any] | None = None) -> None:
        if isinstance(message, Exception):
            self._logger.error(str(message), exc_info=message)
            return
        if extra:
            self._logger.error("%s | %s", message, dict(extra))
        else:
            self._logger.error(message)


__all__ = ["Logger", "setup_logging"]
