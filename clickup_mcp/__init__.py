"""ClickUp MCP server implementation for Python runtime."""

from importlib import metadata

try:
    __version__ = metadata.version("clickup-mcp")
except metadata.PackageNotFoundError:  # pragma: no cover - during local dev
    __version__ = "0.0.0"

__all__ = ["__version__"]
