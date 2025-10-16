"""Base utilities for ClickUp API access."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import Enum
import json
from typing import Any, Awaitable, Callable, Dict, Generic, Optional, TypeVar

import httpx


class ErrorCode(str, Enum):
    UNKNOWN = "UNKNOWN"
    NETWORK = "NETWORK"
    AUTHENTICATION = "AUTHENTICATION"
    INVALID_PARAMETER = "INVALID_PARAMETER"
    WORKSPACE_ERROR = "WORKSPACE_ERROR"
    TASK_ERROR = "TASK_ERROR"
    LIST_ERROR = "LIST_ERROR"
    FOLDER_ERROR = "FOLDER_ERROR"
    TAG_ERROR = "TAG_ERROR"
    DOCUMENT_ERROR = "DOCUMENT_ERROR"
    TIME_TRACKING_ERROR = "TIME_TRACKING_ERROR"


class ClickUpServiceError(RuntimeError):
    def __init__(self, message: str, code: ErrorCode = ErrorCode.UNKNOWN, details: Any | None = None):
        super().__init__(message)
        self.code = code
        self.details = details

    def to_dict(self) -> Dict[str, Any]:
        data = {"message": str(self), "code": self.code.value}
        if self.details is not None:
            data["details"] = self.details
        return data


T = TypeVar("T")


@dataclass(slots=True)
class ServiceResponse(Generic[T]):
    success: bool
    data: Optional[T] = None
    error: Optional[ClickUpServiceError] = None


class AsyncClickUpClient:
    """Shared asynchronous HTTP client with retry support."""

    def __init__(self, api_key: str, base_url: str) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._client: Optional[httpx.AsyncClient] = None
        self._lock = asyncio.Lock()

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            async with self._lock:
                if self._client is None:
                    self._client = httpx.AsyncClient(
                        base_url=self._base_url,
                        headers={
                            "Authorization": self._api_key,
                        },
                        timeout=httpx.Timeout(30.0, read=60.0)
                    )
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        client = await self._get_client()
        try:
            response = await client.request(method, path, **kwargs)
        except httpx.HTTPStatusError as exc:  # pragma: no cover - httpx raises after raise_for_status
            raise ClickUpServiceError("ClickUp API request failed", ErrorCode.NETWORK, details=str(exc)) from exc
        except httpx.RequestError as exc:  # network level
            raise ClickUpServiceError("Unable to reach ClickUp API", ErrorCode.NETWORK, details=str(exc)) from exc

        if response.status_code == 401:
            raise ClickUpServiceError("Authentication with ClickUp failed", ErrorCode.AUTHENTICATION)

        if response.status_code >= 400:
            detail = _safe_json(response)
            raise ClickUpServiceError(
                f"ClickUp API responded with status {response.status_code}",
                ErrorCode.UNKNOWN,
                details=detail,
            )

        return _safe_json(response)


class BaseClickUpService:
    """Base class that provides access to the ClickUp API client."""

    def __init__(self, api_key: str, team_id: str, base_url: str | None = None, client: AsyncClickUpClient | None = None) -> None:
        base_url = base_url or "https://api.clickup.com/api/v2"
        self.team_id = team_id
        self.client = client or AsyncClickUpClient(api_key, base_url)

    async def make_request(self, fn: Callable[[], Awaitable[T]]) -> T:
        try:
            return await fn()
        except ClickUpServiceError:
            raise
        except Exception as exc:  # pragma: no cover - guard
            raise ClickUpServiceError("Unexpected ClickUp service error", ErrorCode.UNKNOWN, details=str(exc)) from exc


async def close_client(service: BaseClickUpService) -> None:
    await service.client.close()


def _safe_json(response: httpx.Response) -> Any:
    if not response.content:
        return None
    try:
        return response.json()
    except json.JSONDecodeError:
        return response.text


__all__ = [
    "BaseClickUpService",
    "AsyncClickUpClient",
    "ClickUpServiceError",
    "ErrorCode",
    "ServiceResponse",
    "close_client",
]
