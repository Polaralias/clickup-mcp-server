"""List operations for ClickUp."""
from __future__ import annotations

from typing import Any, Dict, List

from .base import BaseClickUpService, ClickUpServiceError, ErrorCode, ServiceResponse


class ListService(BaseClickUpService):
    def __init__(self, api_key: str, team_id: str, base_url: str | None = None, client=None) -> None:
        super().__init__(api_key, team_id, base_url, client)

    async def create_list(self, space_or_folder_id: str, payload: Dict[str, Any], *, in_folder: bool = False) -> Dict[str, Any]:
        if not space_or_folder_id:
            raise ClickUpServiceError("A space or folder identifier is required", ErrorCode.INVALID_PARAMETER)
        path = "/folder/{}/list" if in_folder else "/space/{}/list"
        return await self.make_request(
            lambda: self.client.request("POST", path.format(space_or_folder_id), json=payload)
        )

    async def get_list(self, list_id: str) -> Dict[str, Any]:
        if not list_id:
            raise ClickUpServiceError("list_id is required", ErrorCode.INVALID_PARAMETER)
        return await self.make_request(lambda: self.client.request("GET", f"/list/{list_id}"))

    async def update_list(self, list_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        return await self.make_request(
            lambda: self.client.request("PUT", f"/list/{list_id}", json=updates)
        )

    async def delete_list(self, list_id: str) -> ServiceResponse[None]:
        await self.make_request(lambda: self.client.request("DELETE", f"/list/{list_id}"))
        return ServiceResponse(success=True)

    async def get_lists_in_space(self, space_id: str) -> List[Dict[str, Any]]:
        response = await self.make_request(
            lambda: self.client.request("GET", f"/space/{space_id}/list")
        )
        return list(response.get("lists", [])) if isinstance(response, dict) else []

    async def get_lists_in_folder(self, folder_id: str) -> List[Dict[str, Any]]:
        response = await self.make_request(
            lambda: self.client.request("GET", f"/folder/{folder_id}/list")
        )
        return list(response.get("lists", [])) if isinstance(response, dict) else []


__all__ = ["ListService"]
