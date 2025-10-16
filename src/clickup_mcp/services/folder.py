"""Folder operations for ClickUp."""
from __future__ import annotations

from typing import Any, Dict

from .base import BaseClickUpService, ClickUpServiceError, ErrorCode, ServiceResponse


class FolderService(BaseClickUpService):
    def __init__(self, api_key: str, team_id: str, base_url: str | None = None, client=None) -> None:
        super().__init__(api_key, team_id, base_url, client)

    async def create_folder(self, space_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not space_id:
            raise ClickUpServiceError("space_id is required", ErrorCode.INVALID_PARAMETER)
        return await self.make_request(
            lambda: self.client.request("POST", f"/space/{space_id}/folder", json=payload)
        )

    async def get_folder(self, folder_id: str) -> Dict[str, Any]:
        return await self.make_request(lambda: self.client.request("GET", f"/folder/{folder_id}"))

    async def update_folder(self, folder_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        return await self.make_request(
            lambda: self.client.request("PUT", f"/folder/{folder_id}", json=updates)
        )

    async def delete_folder(self, folder_id: str) -> ServiceResponse[None]:
        await self.make_request(lambda: self.client.request("DELETE", f"/folder/{folder_id}"))
        return ServiceResponse(success=True)


__all__ = ["FolderService"]
