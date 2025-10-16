"""Service factory for ClickUp MCP server."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .base import AsyncClickUpClient
from .document import DocumentService
from .folder import FolderService
from .list import ListService
from .member import MemberService
from .tag import ClickUpTagService
from .task import TaskService
from .workspace import WorkspaceService


@dataclass(slots=True)
class ClickUpServices:
    workspace: WorkspaceService
    task: TaskService
    list: ListService
    folder: FolderService
    tag: ClickUpTagService
    document: DocumentService
    member: MemberService


def create_services(api_key: str, team_id: str, base_url: str | None = None) -> ClickUpServices:
    client = AsyncClickUpClient(api_key, base_url or "https://api.clickup.com/api/v2")
    workspace = WorkspaceService(api_key, team_id, base_url, client)
    task = TaskService(api_key, team_id, base_url, workspace, client)
    list_service = ListService(api_key, team_id, base_url, client)
    folder_service = FolderService(api_key, team_id, base_url, client)
    tag_service = ClickUpTagService(api_key, team_id, base_url, client)
    document_service = DocumentService(api_key, team_id, base_url, client)
    member_service = MemberService(api_key, team_id, base_url, client)

    return ClickUpServices(
        workspace=workspace,
        task=task,
        list=list_service,
        folder=folder_service,
        tag=tag_service,
        document=document_service,
        member=member_service,
    )


__all__ = ["ClickUpServices", "create_services"]
