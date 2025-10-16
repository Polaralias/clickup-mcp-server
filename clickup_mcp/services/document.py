"""Document operations for ClickUp."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .base import BaseClickUpService


class DocumentService(BaseClickUpService):
    def __init__(self, api_key: str, team_id: str, base_url: str | None = None, client=None) -> None:
        super().__init__(api_key, team_id, base_url, client)

    async def create_document(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return await self.make_request(
            lambda: self.client.request("POST", f"/team/{self.team_id}/doc", json=payload)
        )

    async def get_document(self, doc_id: str) -> Dict[str, Any]:
        return await self.make_request(lambda: self.client.request("GET", f"/doc/{doc_id}"))

    async def list_documents(self) -> List[Dict[str, Any]]:
        response = await self.make_request(lambda: self.client.request("GET", f"/team/{self.team_id}/doc"))
        return list(response.get("docs", [])) if isinstance(response, dict) else []

    async def list_document_pages(self, doc_id: str) -> List[Dict[str, Any]]:
        response = await self.make_request(lambda: self.client.request("GET", f"/doc/{doc_id}/page"))
        return list(response.get("pages", [])) if isinstance(response, dict) else []

    async def get_document_page(self, doc_id: str, page_id: str) -> Dict[str, Any]:
        return await self.make_request(lambda: self.client.request("GET", f"/doc/{doc_id}/page/{page_id}"))

    async def create_document_page(self, doc_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return await self.make_request(
            lambda: self.client.request("POST", f"/doc/{doc_id}/page", json=payload)
        )

    async def update_document_page(self, doc_id: str, page_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return await self.make_request(
            lambda: self.client.request("PUT", f"/doc/{doc_id}/page/{page_id}", json=payload)
        )


__all__ = ["DocumentService"]
