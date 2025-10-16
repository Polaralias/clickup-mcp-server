"""Workspace operations for ClickUp."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .base import BaseClickUpService, ClickUpServiceError, ErrorCode


@dataclass(slots=True)
class WorkspaceNode:
    id: str
    name: str
    type: str
    children: List["WorkspaceNode"]


@dataclass(slots=True)
class WorkspaceTree:
    root: WorkspaceNode


class WorkspaceService(BaseClickUpService):
    def __init__(self, api_key: str, team_id: str, base_url: str | None = None, client=None) -> None:
        super().__init__(api_key, team_id, base_url, client)
        self._cached_hierarchy: Optional[WorkspaceTree] = None

    async def get_spaces(self) -> List[Dict[str, Any]]:
        response = await self.make_request(
            lambda: self.client.request("GET", f"/team/{self.team_id}/space")
        )
        return list(response.get("spaces", [])) if isinstance(response, dict) else []

    async def get_space(self, space_id: str) -> Dict[str, Any]:
        if not space_id:
            raise ClickUpServiceError("Space ID is required", ErrorCode.INVALID_PARAMETER)
        return await self.make_request(lambda: self.client.request("GET", f"/space/{space_id}"))

    async def get_folders_in_space(self, space_id: str) -> List[Dict[str, Any]]:
        response = await self.make_request(
            lambda: self.client.request("GET", f"/space/{space_id}/folder")
        )
        return list(response.get("folders", [])) if isinstance(response, dict) else []

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

    async def find_list_by_name(
        self,
        list_name: str,
        *,
        space_name: Optional[str] = None,
    ) -> Optional[WorkspaceNode]:
        tree = await self.get_workspace_hierarchy()
        target = list_name.strip().lower()
        space_filter = space_name.strip().lower() if space_name else None

        def walk(node: WorkspaceNode, current_space: Optional[str]) -> Optional[WorkspaceNode]:
            next_space = current_space
            if node.type == "space":
                next_space = node.name.strip().lower()
            if node.type == "list":
                if node.name.strip().lower() == target:
                    if space_filter is None or current_space == space_filter:
                        return node
            for child in node.children:
                found = walk(child, next_space)
                if found:
                    return found
            return None

        return walk(tree.root, None)

    async def find_list_id_by_name(self, space_id: str, list_name: str) -> Optional[str]:
        lists = await self.get_lists_in_space(space_id)
        for item in lists:
            if item.get("name") == list_name:
                return str(item.get("id"))
        folders = await self.get_folders_in_space(space_id)
        for folder in folders:
            folder_lists = await self.get_lists_in_folder(str(folder.get("id")))
            for item in folder_lists:
                if item.get("name") == list_name:
                    return str(item.get("id"))
        return None

    async def get_workspace_hierarchy(self, force_refresh: bool = False) -> WorkspaceTree:
        if self._cached_hierarchy and not force_refresh:
            return self._cached_hierarchy

        spaces = await self.get_spaces()
        root = WorkspaceNode(id=self.team_id, name="Workspace", type="workspace", children=[])

        for space in spaces:
            space_node = WorkspaceNode(
                id=str(space.get("id")),
                name=str(space.get("name", "Unnamed Space")),
                type="space",
                children=[],
            )

            folders = await self.get_folders_in_space(space_node.id)
            for folder in folders:
                folder_node = WorkspaceNode(
                    id=str(folder.get("id")),
                    name=str(folder.get("name", "Unnamed Folder")),
                    type="folder",
                    children=[],
                )
                lists = await self.get_lists_in_folder(folder_node.id)
                for list_item in lists:
                    folder_node.children.append(
                        WorkspaceNode(
                            id=str(list_item.get("id")),
                            name=str(list_item.get("name", "Unnamed List")),
                            type="list",
                            children=[],
                        )
                    )
                space_node.children.append(folder_node)

            loose_lists = await self.get_lists_in_space(space_node.id)
            for list_item in loose_lists:
                space_node.children.append(
                    WorkspaceNode(
                        id=str(list_item.get("id")),
                        name=str(list_item.get("name", "Unnamed List")),
                        type="list",
                        children=[],
                    )
                )

            root.children.append(space_node)

        self._cached_hierarchy = WorkspaceTree(root=root)
        return self._cached_hierarchy


__all__ = ["WorkspaceService", "WorkspaceTree", "WorkspaceNode"]
