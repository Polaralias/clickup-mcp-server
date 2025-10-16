"""Tag operations for ClickUp."""
from __future__ import annotations

from typing import Any, Dict, List

from .base import BaseClickUpService


class ClickUpTagService(BaseClickUpService):
    def __init__(self, api_key: str, team_id: str, base_url: str | None = None, client=None) -> None:
        super().__init__(api_key, team_id, base_url, client)

    async def get_space_tags(self, space_id: str) -> List[Dict[str, Any]]:
        response = await self.make_request(
            lambda: self.client.request("GET", f"/space/{space_id}/tag")
        )
        return list(response.get("tags", [])) if isinstance(response, dict) else []

    async def add_tag_to_task(self, task_id: str, tag_name: str) -> Dict[str, Any]:
        payload = {"tag": tag_name}
        return await self.make_request(
            lambda: self.client.request("POST", f"/task/{task_id}/tag", json=payload)
        )

    async def remove_tag_from_task(self, task_id: str, tag_name: str) -> Dict[str, Any]:
        return await self.make_request(
            lambda: self.client.request("DELETE", f"/task/{task_id}/tag/{tag_name}")
        )


__all__ = ["ClickUpTagService"]
