"""Member lookup helpers."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .base import BaseClickUpService


class MemberService(BaseClickUpService):
    def __init__(self, api_key: str, team_id: str, base_url: str | None = None, client=None) -> None:
        super().__init__(api_key, team_id, base_url, client)

    async def list_members(self) -> List[Dict[str, Any]]:
        response = await self.make_request(lambda: self.client.request("GET", f"/team/{self.team_id}/member"))
        return list(response.get("members", [])) if isinstance(response, dict) else []

    async def find_member_by_name(self, query: str) -> Optional[Dict[str, Any]]:
        query_lower = query.lower()
        for member in await self.list_members():
            name = str(member.get("username") or member.get("email") or "").lower()
            if query_lower in name:
                return member
        return None

    async def resolve_assignees(self, identifiers: List[str]) -> Dict[str, Any]:
        members = await self.list_members()
        resolved: List[Dict[str, Any]] = []
        for identifier in identifiers:
            for member in members:
                if str(member.get("id")) == identifier or member.get("email") == identifier or member.get("username") == identifier:
                    resolved.append(member)
                    break
        return {"resolved": resolved, "count": len(resolved)}


__all__ = ["MemberService"]
