"""Configuration loading for the ClickUp MCP server."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum
import os
import sys
from typing import Dict, Iterable, List, Optional


class LogLevel(IntEnum):
    """Log level values mirrored from the legacy TypeScript implementation."""

    TRACE = 0
    DEBUG = 1
    INFO = 2
    WARN = 3
    ERROR = 4


@dataclass(slots=True)
class SecurityConfig:
    enable_security_features: bool = False
    enable_origin_validation: bool = False
    enable_rate_limit: bool = False
    enable_cors: bool = False
    allowed_origins: List[str] = field(default_factory=list)
    rate_limit_max: int = 60
    rate_limit_window_ms: int = 60_000
    max_request_size: str = "1mb"


@dataclass(slots=True)
class HttpsConfig:
    enable_https: bool = False
    https_port: Optional[str] = None
    ssl_key_path: Optional[str] = None
    ssl_cert_path: Optional[str] = None
    ssl_ca_path: Optional[str] = None


@dataclass(slots=True)
class ServerConfig:
    clickup_api_key: str
    clickup_team_id: str
    document_support: str = "false"
    enable_sponsor_message: bool = True
    log_level: LogLevel = LogLevel.ERROR
    disabled_tools: List[str] = field(default_factory=list)
    enabled_tools: List[str] = field(default_factory=list)
    enable_sse: bool = False
    sse_port: int = 3000
    enable_stdio: bool = True
    port: Optional[str] = None
    host: str = "127.0.0.1"
    https_host: Optional[str] = None
    security: SecurityConfig = field(default_factory=SecurityConfig)
    https: HttpsConfig = field(default_factory=HttpsConfig)


def _parse_cli_env_arguments(argv: Iterable[str]) -> Dict[str, str]:
    """Parse ``--env KEY=value`` flags from CLI arguments.

    Smithery forwards environment values using the same convention as the
    original Node implementation so we preserve compatibility.
    """

    iterator = iter(argv)
    parsed: Dict[str, str] = {}
    for token in iterator:
        if token != "--env":
            continue
        try:
            assignment = next(iterator)
        except StopIteration:  # pragma: no cover - defensive guard
            break
        if "=" not in assignment:
            continue
        key, value = assignment.split("=", 1)
        parsed[key] = value
    return parsed


def _parse_bool(value: Optional[str], default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_int(value: Optional[str], default: int) -> int:
    if not value:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):  # pragma: no cover - validation safeguard
        return default


def _parse_list(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _parse_log_level(value: Optional[str]) -> LogLevel:
    if not value:
        return LogLevel.ERROR
    name = value.strip().upper()
    return getattr(LogLevel, name, LogLevel.ERROR)


def load_config(overrides: Optional[Dict[str, object]] = None) -> ServerConfig:
    """Load configuration from CLI arguments, environment variables, and overrides."""

    overrides = overrides or {}
    cli_env = _parse_cli_env_arguments(sys.argv[1:])

    def pick(*keys: str, default: Optional[str] = None) -> Optional[str]:
        for key in keys:
            if key in cli_env and cli_env[key].strip():
                return cli_env[key].strip()
            env_value = os.getenv(key)
            if env_value and env_value.strip():
                return env_value.strip()
        return default

    clickup_api_key = str(
        overrides.get("clickup_api_key")
        or pick("CLICKUP_API_KEY")
        or ""
    ).strip()
    clickup_team_id = str(
        overrides.get("clickup_team_id")
        or pick("CLICKUP_TEAM_ID")
        or ""
    ).strip()

    if not clickup_api_key or not clickup_team_id:
        raise ValueError(
            "Both CLICKUP_API_KEY and CLICKUP_TEAM_ID must be provided via environment variables or --env flags."
        )

    document_support = str(
        overrides.get("document_support")
        or pick("DOCUMENT_SUPPORT", "DOCUMENT_MODULE", "DOCUMENT_MODEL", default="false")
    )

    enabled_tools = list(
        overrides.get("enabled_tools")  # type: ignore[arg-type]
        or _parse_list(pick("ENABLED_TOOLS"))
    )
    disabled_tools = list(
        overrides.get("disabled_tools")  # type: ignore[arg-type]
        or _parse_list(pick("DISABLED_TOOLS", "DISABLED_COMMANDS"))
    )

    enable_sse = bool(
        overrides.get("enable_sse")
        if "enable_sse" in overrides
        else _parse_bool(pick("ENABLE_SSE"), False)
    )
    sse_port = int(
        overrides.get("sse_port")
        if "sse_port" in overrides
        else _parse_int(pick("SSE_PORT"), 3000)
    )
    enable_stdio = bool(
        overrides.get("enable_stdio")
        if "enable_stdio" in overrides
        else _parse_bool(pick("ENABLE_STDIO"), True)
    )

    port = overrides.get("port") or pick("PORT")
    host = str(overrides.get("host") or pick("HOST", default="127.0.0.1"))
    https_host = overrides.get("https_host") or pick("HTTPS_HOST")

    enable_sponsor_message = bool(
        overrides.get("enable_sponsor_message")
        if "enable_sponsor_message" in overrides
        else _parse_bool(os.getenv("ENABLE_SPONSOR_MESSAGE"), True)
    )

    log_level = LogLevel(
        overrides.get("log_level")
        if "log_level" in overrides
        else _parse_log_level(pick("LOG_LEVEL"))
    )

    security = SecurityConfig(
        enable_security_features=bool(
            overrides.get("enable_security_features")
            if "enable_security_features" in overrides
            else _parse_bool(os.getenv("ENABLE_SECURITY_FEATURES"), False)
        ),
        enable_origin_validation=bool(
            overrides.get("enable_origin_validation")
            if "enable_origin_validation" in overrides
            else _parse_bool(os.getenv("ENABLE_ORIGIN_VALIDATION"), False)
        ),
        enable_rate_limit=bool(
            overrides.get("enable_rate_limit")
            if "enable_rate_limit" in overrides
            else _parse_bool(os.getenv("ENABLE_RATE_LIMIT"), False)
        ),
        enable_cors=bool(
            overrides.get("enable_cors")
            if "enable_cors" in overrides
            else _parse_bool(os.getenv("ENABLE_CORS"), False)
        ),
        allowed_origins=list(
            overrides.get("allowed_origins")  # type: ignore[arg-type]
            or _parse_list(os.getenv("ALLOWED_ORIGINS"))
        ),
        rate_limit_max=int(
            overrides.get("rate_limit_max")
            if "rate_limit_max" in overrides
            else _parse_int(os.getenv("RATE_LIMIT_MAX"), 60)
        ),
        rate_limit_window_ms=int(
            overrides.get("rate_limit_window_ms")
            if "rate_limit_window_ms" in overrides
            else _parse_int(os.getenv("RATE_LIMIT_WINDOW_MS"), 60_000)
        ),
        max_request_size=str(
            overrides.get("max_request_size")
            if "max_request_size" in overrides
            else os.getenv("MAX_REQUEST_SIZE", "1mb")
        ),
    )

    https = HttpsConfig(
        enable_https=bool(
            overrides.get("enable_https")
            if "enable_https" in overrides
            else _parse_bool(os.getenv("ENABLE_HTTPS"), False)
        ),
        https_port=str(
            overrides.get("https_port")
            if "https_port" in overrides
            else pick("HTTPS_PORT")
        ),
        ssl_key_path=str(
            overrides.get("ssl_key_path")
            if "ssl_key_path" in overrides
            else pick("SSL_KEY_PATH")
        )
        if overrides.get("ssl_key_path") is not None or pick("SSL_KEY_PATH")
        else None,
        ssl_cert_path=str(
            overrides.get("ssl_cert_path")
            if "ssl_cert_path" in overrides
            else pick("SSL_CERT_PATH")
        )
        if overrides.get("ssl_cert_path") is not None or pick("SSL_CERT_PATH")
        else None,
        ssl_ca_path=str(
            overrides.get("ssl_ca_path")
            if "ssl_ca_path" in overrides
            else pick("SSL_CA_PATH")
        )
        if overrides.get("ssl_ca_path") is not None or pick("SSL_CA_PATH")
        else None,
    )

    return ServerConfig(
        clickup_api_key=clickup_api_key,
        clickup_team_id=clickup_team_id,
        document_support=document_support,
        enable_sponsor_message=enable_sponsor_message,
        log_level=log_level,
        disabled_tools=disabled_tools,
        enabled_tools=enabled_tools,
        enable_sse=enable_sse,
        sse_port=sse_port,
        enable_stdio=enable_stdio,
        port=port,
        host=host,
        https_host=https_host,
        security=security,
        https=https,
    )


__all__ = ["ServerConfig", "SecurityConfig", "HttpsConfig", "LogLevel", "load_config"]
