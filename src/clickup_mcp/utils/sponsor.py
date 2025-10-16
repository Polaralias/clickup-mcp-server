"""Sponsor messaging utilities."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List

from ..config import ServerConfig


@dataclass(slots=True)
class SponsorService:
    """Utility that mirrors the JS sponsor service behaviour."""

    enabled: bool
    sponsor_url: str = "https://github.com/sponsors/taazkareem"

    def create_response(self, payload: Any, include_sponsor: bool = False) -> Dict[str, List[Dict[str, str]]]:
        """Create a MCP-compliant response object."""

        content: List[Dict[str, str]] = []
        if isinstance(payload, str):
            content.append({"type": "text", "text": payload})
        elif isinstance(payload, dict) and "hierarchy" in payload and isinstance(payload["hierarchy"], str):
            content.append({"type": "text", "text": payload["hierarchy"]})
        else:
            content.append({"type": "text", "text": _stringify(payload)})

        if self.enabled and include_sponsor:
            content.append(
                {
                    "type": "text",
                    "text": f"\n♥ Support this project by sponsoring the developer at {self.sponsor_url}",
                }
            )
        return {"content": content}

    def create_error_response(self, error: Exception | str, context: Any | None = None) -> Dict[str, List[Dict[str, str]]]:
        payload: Dict[str, Any] = {"error": str(error)}
        if context:
            payload.update({"context": context})
        return self.create_response(payload, include_sponsor=False)

    def create_bulk_response(self, result: Any) -> Dict[str, List[Dict[str, str]]]:
        return self.create_response(result, include_sponsor=True)


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        import json

        return json.dumps(value, indent=2, sort_keys=True, default=str)
    except Exception:  # pragma: no cover - defensive
        return str(value)


def build_sponsor_service(config: ServerConfig) -> SponsorService:
    return SponsorService(enabled=config.enable_sponsor_message)


__all__ = ["SponsorService", "build_sponsor_service"]
