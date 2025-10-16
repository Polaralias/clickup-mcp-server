"""Task operations for ClickUp."""
from __future__ import annotations

import asyncio
import base64
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import httpx

from .base import BaseClickUpService, ClickUpServiceError, ErrorCode
from .workspace import WorkspaceService, WorkspaceNode


@dataclass(slots=True)
class TaskIdentifier:
    task_id: Optional[str] = None
    custom_id: Optional[str] = None


class TaskService(BaseClickUpService):
    def __init__(
        self,
        api_key: str,
        team_id: str,
        base_url: str | None = None,
        workspace: WorkspaceService | None = None,
        client=None,
    ) -> None:
        super().__init__(api_key, team_id, base_url, client or (workspace.client if workspace else None))
        self.workspace = workspace

    # ------------------------------------------------------------------
    # Basic CRUD
    # ------------------------------------------------------------------
    async def create_task(self, list_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not list_id:
            raise ClickUpServiceError("list_id is required to create a task", ErrorCode.INVALID_PARAMETER)
        body = self._normalise_task_payload(payload)
        return await self.make_request(
            lambda: self.client.request("POST", f"/list/{list_id}/task", json=body)
        )

    async def get_task(self, identifier: TaskIdentifier) -> Dict[str, Any]:
        task_id = await self._resolve_task_id(identifier)
        return await self.make_request(lambda: self.client.request("GET", f"/task/{task_id}"))

    async def update_task(self, identifier: TaskIdentifier, updates: Dict[str, Any]) -> Dict[str, Any]:
        task_id = await self._resolve_task_id(identifier)
        body = self._normalise_task_payload(updates)
        return await self.make_request(
            lambda: self.client.request("PUT", f"/task/{task_id}", json=body)
        )

    async def delete_task(self, identifier: TaskIdentifier) -> Dict[str, Any]:
        task_id = await self._resolve_task_id(identifier)
        await self.make_request(lambda: self.client.request("DELETE", f"/task/{task_id}"))
        return {"success": True, "task_id": task_id}

    async def move_task(self, identifier: TaskIdentifier, destination_list_id: str) -> Dict[str, Any]:
        task_id = await self._resolve_task_id(identifier)
        payload = {"list_id": destination_list_id}
        return await self.make_request(
            lambda: self.client.request("POST", f"/task/{task_id}/move", json=payload)
        )

    async def duplicate_task(self, identifier: TaskIdentifier, destination_list_id: Optional[str] = None) -> Dict[str, Any]:
        task_id = await self._resolve_task_id(identifier)
        payload: Dict[str, Any] = {"include_subtasks": True, "include_assignees": True}
        if destination_list_id:
            payload["list_id"] = destination_list_id
        return await self.make_request(
            lambda: self.client.request("POST", f"/task/{task_id}/duplicate", json=payload)
        )

    # ------------------------------------------------------------------
    # Comments & attachments
    # ------------------------------------------------------------------
    async def get_task_comments(self, identifier: TaskIdentifier) -> List[Dict[str, Any]]:
        task_id = await self._resolve_task_id(identifier)
        response = await self.make_request(
            lambda: self.client.request("GET", f"/task/{task_id}/comment")
        )
        return list(response.get("comments", [])) if isinstance(response, dict) else []

    async def create_task_comment(
        self,
        identifier: TaskIdentifier,
        comment_text: str,
        *,
        notify_all: Optional[bool] = None,
        assignee: Optional[int] = None,
    ) -> Dict[str, Any]:
        task_id = await self._resolve_task_id(identifier)
        payload = {"comment_text": comment_text}
        if notify_all is not None:
            payload["notify_all"] = notify_all
        if assignee is not None:
            payload["assignee"] = assignee
        return await self.make_request(
            lambda: self.client.request("POST", f"/task/{task_id}/comment", json=payload)
        )

    async def attach_file(
        self,
        identifier: TaskIdentifier,
        *,
        attachment_url: Optional[str] = None,
        filename: Optional[str] = None,
        file_data: Optional[str] = None,
        file_path: Optional[str] = None,
        auth_header: Optional[str] = None,
    ) -> Dict[str, Any]:
        task_id = await self._resolve_task_id(identifier)

        if not any([attachment_url, file_data, file_path]):
            raise ClickUpServiceError(
                "Provide file_data, file_path, or attachment_url to upload an attachment",
                ErrorCode.INVALID_PARAMETER,
            )

        file_bytes: bytes
        resolved_name: str

        if file_data:
            try:
                file_bytes = base64.b64decode(file_data)
            except Exception as exc:  # pragma: no cover - defensive
                raise ClickUpServiceError("file_data must be valid base64", ErrorCode.INVALID_PARAMETER) from exc
            resolved_name = filename or "attachment"
        elif file_path:
            path = Path(file_path).expanduser()
            if not path.is_file():
                raise ClickUpServiceError(
                    f"File path does not exist: {file_path}",
                    ErrorCode.INVALID_PARAMETER,
                )
            file_bytes = await asyncio.to_thread(path.read_bytes)
            resolved_name = filename or path.name
        else:
            assert attachment_url is not None
            if attachment_url.startswith(("http://", "https://")):
                file_bytes, resolved_name = await self._download_remote_file(attachment_url, auth_header)
                if filename:
                    resolved_name = filename
            else:
                path = Path(attachment_url).expanduser()
                if not path.is_file():
                    raise ClickUpServiceError(
                        f"File path does not exist: {attachment_url}",
                        ErrorCode.INVALID_PARAMETER,
                    )
                file_bytes = await asyncio.to_thread(path.read_bytes)
                resolved_name = filename or path.name

        files = {"attachment": (resolved_name, file_bytes)}

        return await self.make_request(
            lambda: self.client.request(
                "POST",
                f"/task/{task_id}/attachment",
                files=files,
            )
        )

    # ------------------------------------------------------------------
    # Bulk helpers
    # ------------------------------------------------------------------
    async def bulk_create_tasks(self, list_id: str, tasks: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
        created: List[Dict[str, Any]] = []
        errors: List[Dict[str, Any]] = []
        for task in tasks:
            try:
                result = await self.create_task(list_id, task)
                created.append(result)
            except ClickUpServiceError as exc:
                errors.append({"task": task, "error": exc.to_dict()})
        return {"created": created, "errors": errors}

    async def bulk_update_tasks(self, updates: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
        updated: List[Dict[str, Any]] = []
        errors: List[Dict[str, Any]] = []
        for entry in updates:
            identifier = TaskIdentifier(
                task_id=entry.get("task_id") or entry.get("taskId"),
                custom_id=entry.get("custom_task_id") or entry.get("customTaskId"),
            )
            payload = {
                self._camel_to_snake(k): v
                for k, v in entry.items()
                if k not in {"task_id", "custom_task_id", "taskId", "customTaskId"}
            }
            try:
                result = await self.update_task(identifier, payload)
                updated.append(result)
            except ClickUpServiceError as exc:
                errors.append({"task": entry, "error": exc.to_dict()})
        return {"updated": updated, "errors": errors}

    async def bulk_delete_tasks(self, identifiers: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
        deleted: List[str] = []
        errors: List[Dict[str, Any]] = []
        for entry in identifiers:
            identifier = TaskIdentifier(
                task_id=entry.get("task_id") or entry.get("taskId"),
                custom_id=entry.get("custom_task_id") or entry.get("customTaskId"),
            )
            try:
                result = await self.delete_task(identifier)
                deleted.append(result["task_id"])
            except ClickUpServiceError as exc:
                errors.append({"task": entry, "error": exc.to_dict()})
        return {"deleted": deleted, "errors": errors}

    async def move_bulk_tasks(
        self,
        entries: Iterable[Dict[str, Any]],
        destination_list_id: Optional[str] = None,
        *,
        destination_list_name: Optional[str] = None,
        destination_space_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        target_list_id = await self._resolve_list_id(destination_list_id, destination_list_name, destination_space_name)
        moved: List[Dict[str, Any]] = []
        errors: List[Dict[str, Any]] = []
        for entry in entries:
            identifier = TaskIdentifier(
                task_id=entry.get("task_id") or entry.get("taskId"),
                custom_id=entry.get("custom_task_id") or entry.get("customTaskId"),
            )
            try:
                result = await self.move_task(identifier, target_list_id)
                moved.append({
                    "task_id": result.get("id") or identifier.task_id or identifier.custom_id,
                    "destination_list_id": target_list_id,
                })
            except ClickUpServiceError as exc:
                errors.append({"task": entry, "error": exc.to_dict()})
        return {"moved": moved, "errors": errors, "destination_list_id": target_list_id}

    # ------------------------------------------------------------------
    # Workspace queries
    # ------------------------------------------------------------------
    async def get_tasks(
        self,
        list_id: Optional[str] = None,
        *,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        resolved_list_id = await self._resolve_list_id(list_id, list_name, space_name)
        params = self._build_task_list_params(filters or {})
        response = await self.make_request(
            lambda: self.client.request("GET", f"/list/{resolved_list_id}/task", params=params)
        )
        tasks = response.get("tasks", []) if isinstance(response, dict) else []
        return {"tasks": tasks, "list_id": resolved_list_id, "params": params}

    async def list_workspace_tasks(self, query: Dict[str, Any]) -> Dict[str, Any]:
        params = {k: v for k, v in query.items() if v is not None}
        return await self.make_request(
            lambda: self.client.request("GET", f"/team/{self.team_id}/task", params=params)
        )

    async def get_task_time_entries(
        self,
        identifier: TaskIdentifier,
        *,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        task_id = await self._resolve_task_id(identifier)
        params = {
            key: value
            for key, value in {
                "start_date": start_date,
                "end_date": end_date,
            }.items()
            if value is not None
        }
        return await self.make_request(
            lambda: self.client.request("GET", f"/task/{task_id}/time", params=params or None)
        )

    async def start_time_tracking(
        self,
        identifier: TaskIdentifier,
        user_id: int | None = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        task_id = await self._resolve_task_id(identifier)
        payload: Dict[str, Any] = self._normalise_task_payload(details or {})
        payload["tid"] = task_id
        if user_id is not None:
            payload["assignee"] = user_id
        return await self.make_request(
            lambda: self.client.request("POST", f"/team/{self.team_id}/time_entries/start", json=payload)
        )

    async def stop_time_tracking(
        self,
        identifier: TaskIdentifier,
        details: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        task_id = await self._resolve_task_id(identifier)
        payload = self._normalise_task_payload(details or {})
        payload["task_id"] = task_id
        return await self.make_request(
            lambda: self.client.request("POST", f"/team/{self.team_id}/time_entries/stop", json=payload)
        )

    async def add_time_entry(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        body = self._normalise_task_payload(payload)
        return await self.make_request(
            lambda: self.client.request("POST", f"/team/{self.team_id}/time_entries", json=body)
        )

    async def delete_time_entry(self, entry_id: str) -> Dict[str, Any]:
        await self.make_request(
            lambda: self.client.request("DELETE", f"/time_entries/{entry_id}")
        )
        return {"success": True, "time_entry_id": entry_id}

    async def get_current_time_entry(self, user_id: Optional[int] = None) -> Dict[str, Any]:
        params = {"user_id": user_id} if user_id else None
        return await self.make_request(
            lambda: self.client.request("GET", f"/team/{self.team_id}/time_entries/current", params=params)
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    async def _resolve_task_id(self, identifier: TaskIdentifier) -> str:
        if identifier.task_id:
            return identifier.task_id
        if identifier.custom_id:
            response = await self.make_request(
                lambda: self.client.request("GET", f"/team/{self.team_id}/task", params={"custom_task_ids": identifier.custom_id})
            )
            tasks = response.get("tasks", []) if isinstance(response, dict) else []
            if tasks:
                return str(tasks[0].get("id"))
        raise ClickUpServiceError("A valid task identifier is required", ErrorCode.INVALID_PARAMETER)

    async def find_task_by_name(
        self,
        task_name: str,
        *,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        normalized = task_name.strip().lower()
        tasks: List[Dict[str, Any]] = []
        if list_name:
            list_id = await self._resolve_list_id(None, list_name, space_name)
            response = await self.make_request(
                lambda: self.client.request("GET", f"/list/{list_id}/task", params={"subtasks": True})
            )
            data = response.get("tasks", []) if isinstance(response, dict) else []
            tasks.extend(data)
        else:
            response = await self.list_workspace_tasks({"page": 0, "subtasks": True, "include_closed": True})
            data = response.get("tasks", []) if isinstance(response, dict) else []
            tasks.extend(data)

        matches = [task for task in tasks if str(task.get("name", "")).strip().lower() == normalized]
        if not matches:
            return None
        if len(matches) == 1:
            return matches[0]
        matches.sort(key=lambda item: int(item.get("date_updated", 0)), reverse=True)
        return matches[0]

    async def _resolve_list_id(
        self,
        list_id: Optional[str],
        list_name: Optional[str],
        space_name: Optional[str],
    ) -> str:
        if list_id:
            return list_id
        if not self.workspace or not list_name:
            raise ClickUpServiceError("List identifier is required", ErrorCode.INVALID_PARAMETER)
        node: Optional[WorkspaceNode] = await self.workspace.find_list_by_name(list_name, space_name=space_name)
        if node:
            return node.id
        raise ClickUpServiceError(
            f"Unable to resolve list named '{list_name}'", ErrorCode.WORKSPACE_ERROR
        )

    async def resolve_list_id(
        self,
        list_id: Optional[str],
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
    ) -> str:
        return await self._resolve_list_id(list_id, list_name, space_name)

    def _build_task_list_params(self, filters: Dict[str, Any]) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        if "subtasks" in filters:
            params["subtasks"] = filters["subtasks"]
        if statuses := filters.get("statuses"):
            if isinstance(statuses, (list, tuple)) and statuses:
                params["statuses[]"] = list(statuses)
        if filters.get("archived") is not None:
            params["archived"] = filters["archived"]
        if filters.get("page") is not None:
            params["page"] = filters["page"]
        if filters.get("order_by"):
            params["order_by"] = filters["order_by"]
        if filters.get("reverse") is not None:
            params["reverse"] = filters["reverse"]
        return params

    async def _download_remote_file(
        self,
        url: str,
        auth_header: Optional[str],
    ) -> tuple[bytes, str]:
        headers = {"Authorization": auth_header} if auth_header else None
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=60.0)) as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                filename = url.split("/")[-1] or "attachment"
                return response.content, filename
        except httpx.HTTPError as exc:
            raise ClickUpServiceError(
                f"Unable to download attachment from {url}",
                ErrorCode.NETWORK,
                details=str(exc),
            ) from exc

    def _normalise_task_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return {
            self._camel_to_snake(key): value
            for key, value in payload.items()
            if value is not None
        }

    @staticmethod
    def _camel_to_snake(value: str) -> str:
        if "_" in value:
            return value
        converted = re.sub(r"(?<!^)(?=[A-Z])", "_", value).lower()
        return converted


__all__ = ["TaskService", "TaskIdentifier"]
