"""Entry point for the ClickUp MCP server."""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, Optional

from mcp.server.fastmcp import FastMCP

from .config import ServerConfig, load_config
from .logger import Logger, setup_logging
from .services.base import ClickUpServiceError, ErrorCode
from .services.task import TaskIdentifier
from .services.shared import (
    get_document_service,
    get_folder_service,
    get_list_service,
    get_member_service,
    get_tag_service,
    get_task_service,
    get_workspace_service,
    init_services,
)
from .utils.sponsor import build_sponsor_service


logger = Logger("Server")


def create_server() -> FastMCP:
    config = load_config()
    setup_logging(config.log_level)
    logger.info("Loading ClickUp MCP server configuration", {"team": config.clickup_team_id})
    init_services(config)
    sponsor = build_sponsor_service(config)

    server = FastMCP("clickup-mcp-server", version="0.9.0")

    def is_tool_enabled(tool_name: str) -> bool:
        if config.enabled_tools:
            return tool_name in config.enabled_tools
        if config.disabled_tools:
            return tool_name not in config.disabled_tools
        return True

    def register_tool(
        name: str,
        description: str,
        *,
        schema: Optional[Dict[str, Any]] = None,
        include_sponsor: bool = False,
    ) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
        def decorator(func: Callable[..., Awaitable[Any]]):
            if not is_tool_enabled(name):
                logger.info("Skipping disabled tool", {"tool": name})
                return func

            async def wrapper(**kwargs: Any) -> Dict[str, Any]:
                try:
                    result = await func(**kwargs)
                    add_sponsor = include_sponsor
                    if isinstance(result, tuple) and len(result) == 2:
                        result, add_sponsor = result  # type: ignore[assignment]
                    return sponsor.create_response(result, add_sponsor)
                except ClickUpServiceError as exc:
                    return sponsor.create_error_response(exc.to_dict(), kwargs)
                except Exception as exc:  # pragma: no cover - defensive logging
                    logger.error(f"Unhandled exception in tool {name}: {exc}")
                    return sponsor.create_error_response(str(exc), kwargs)

            return server.tool(name=name, description=description, schema=schema)(wrapper)

        return decorator

    # ------------------------------------------------------------------
    # Workspace tools
    # ------------------------------------------------------------------
    @register_tool(
        "get_workspace_hierarchy",
        "Gets the workspace hierarchy including spaces, folders, and lists.",
        include_sponsor=True,
    )
    async def get_workspace_hierarchy() -> Dict[str, Any]:
        service = get_workspace_service()
        tree = await service.get_workspace_hierarchy()
        return {"hierarchy": _format_workspace_tree(tree.root)}

    # ------------------------------------------------------------------
    # Task tools
    # ------------------------------------------------------------------
    @register_tool("create_task", "Create a ClickUp task in a list.")
    async def create_task(
        list_id: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        task: Dict[str, Any] | None = None,
        **fields: Any,
    ) -> Any:
        list_id = list_id or fields.pop("listId", None) or fields.pop("list_id", None)
        list_name = list_name or fields.pop("listName", None)
        space_name = space_name or fields.pop("spaceName", None)
        payload = dict(task or {})
        for key, value in fields.items():
            if value is not None:
                payload[key] = value
        service = get_task_service()
        resolved_list_id = await service.resolve_list_id(list_id, list_name, space_name)
        return await service.create_task(resolved_list_id, payload)

    @register_tool("get_task", "Fetch a task by identifier or name.")
    async def get_task(
        task_id: Optional[str] = None,
        custom_task_id: Optional[str] = None,
        task_name: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
        task_id = task_id or kwargs.get("taskId")
        custom_task_id = custom_task_id or kwargs.get("customTaskId")
        task_name = task_name or kwargs.get("taskName")
        list_name = list_name or kwargs.get("listName")
        space_name = space_name or kwargs.get("spaceName")
        identifier = await _resolve_task_identifier(task_id, custom_task_id, task_name, list_name, space_name)
        return await get_task_service().get_task(identifier)

    @register_tool("update_task", "Update a ClickUp task.")
    async def update_task(
        task_id: Optional[str] = None,
        custom_task_id: Optional[str] = None,
        task_name: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        updates: Dict[str, Any] | None = None,
        **fields: Any,
    ) -> Any:
        task_id = task_id or fields.pop("taskId", None)
        custom_task_id = custom_task_id or fields.pop("customTaskId", None)
        task_name = task_name or fields.pop("taskName", None)
        list_name = list_name or fields.pop("listName", None)
        space_name = space_name or fields.pop("spaceName", None)
        payload = dict(updates or {})
        for key, value in fields.items():
            if value is not None:
                payload[key] = value
        identifier = await _resolve_task_identifier(task_id, custom_task_id, task_name, list_name, space_name)
        return await get_task_service().update_task(identifier, payload)

    @register_tool("move_task", "Move a task to another list.")
    async def move_task(
        task_id: Optional[str] = None,
        custom_task_id: Optional[str] = None,
        task_name: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        destination_list_id: Optional[str] = None,
        destination_list_name: Optional[str] = None,
        destination_space_name: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
        service = get_task_service()
        task_id = task_id or kwargs.get("taskId")
        custom_task_id = custom_task_id or kwargs.get("customTaskId")
        task_name = task_name or kwargs.get("taskName")
        list_name = list_name or kwargs.get("listName")
        space_name = space_name or kwargs.get("spaceName")
        destination_list_id = destination_list_id or kwargs.get("destinationListId")
        destination_list_name = destination_list_name or kwargs.get("destinationListName")
        destination_space_name = destination_space_name or kwargs.get("destinationSpaceName")
        if not (destination_list_id or destination_list_name):
            raise ClickUpServiceError("Destination list information is required", ErrorCode.INVALID_PARAMETER)
        identifier = await _resolve_task_identifier(task_id, custom_task_id, task_name, list_name, space_name)
        target_list_id = await service.resolve_list_id(destination_list_id, destination_list_name, destination_space_name)
        return await service.move_task(identifier, target_list_id)

    @register_tool("duplicate_task", "Duplicate a task optionally into another list.")
    async def duplicate_task(
        task_id: Optional[str] = None,
        custom_task_id: Optional[str] = None,
        task_name: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        destination_list_id: Optional[str] = None,
        destination_list_name: Optional[str] = None,
        destination_space_name: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
        service = get_task_service()
        task_id = task_id or kwargs.get("taskId")
        custom_task_id = custom_task_id or kwargs.get("customTaskId")
        task_name = task_name or kwargs.get("taskName")
        list_name = list_name or kwargs.get("listName")
        space_name = space_name or kwargs.get("spaceName")
        destination_list_id = destination_list_id or kwargs.get("destinationListId")
        destination_list_name = destination_list_name or kwargs.get("destinationListName")
        destination_space_name = destination_space_name or kwargs.get("destinationSpaceName")
        identifier = await _resolve_task_identifier(task_id, custom_task_id, task_name, list_name, space_name)
        target_list_id = None
        if destination_list_id or destination_list_name:
            target_list_id = await service.resolve_list_id(destination_list_id, destination_list_name, destination_space_name)
        return await service.duplicate_task(identifier, target_list_id)

    @register_tool("delete_task", "Delete a ClickUp task.")
    async def delete_task(
        task_id: Optional[str] = None,
        custom_task_id: Optional[str] = None,
        task_name: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
        task_id = task_id or kwargs.get("taskId")
        custom_task_id = custom_task_id or kwargs.get("customTaskId")
        task_name = task_name or kwargs.get("taskName")
        list_name = list_name or kwargs.get("listName")
        space_name = space_name or kwargs.get("spaceName")
        identifier = await _resolve_task_identifier(task_id, custom_task_id, task_name, list_name, space_name)
        return await get_task_service().delete_task(identifier)

    @register_tool("get_task_comments", "List comments for a task.")
    async def get_task_comments(
        task_id: Optional[str] = None,
        custom_task_id: Optional[str] = None,
        task_name: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        start: Optional[int] = None,
        start_id: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
        task_id = task_id or kwargs.get("taskId")
        custom_task_id = custom_task_id or kwargs.get("customTaskId")
        task_name = task_name or kwargs.get("taskName")
        list_name = list_name or kwargs.get("listName")
        space_name = space_name or kwargs.get("spaceName")
        start = start if start is not None else kwargs.get("start")
        start_id = start_id or kwargs.get("startId")
        identifier = await _resolve_task_identifier(task_id, custom_task_id, task_name, list_name, space_name)
        comments = await get_task_service().get_task_comments(identifier)
        if start is not None or start_id is not None:
            start_ts = _safe_int(start) if start is not None else None
            start_identifier = str(start_id) if start_id is not None else None
            comments = [
                comment
                for comment in comments
                if (
                    start_ts is None
                    or _safe_int(comment.get("date")) >= start_ts
                )
                and (
                    start_identifier is None
                    or str(comment.get("id")) >= start_identifier
                )
            ]
        return {"comments": comments, "count": len(comments)}

    @register_tool("create_task_comment", "Add a comment to a task.")
    async def create_task_comment(
        task_id: Optional[str] = None,
        custom_task_id: Optional[str] = None,
        task_name: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        comment_text: str = "",
        notify_all: Optional[bool] = None,
        assignee: Optional[int] = None,
        **kwargs: Any,
    ) -> Any:
        task_id = task_id or kwargs.get("taskId")
        custom_task_id = custom_task_id or kwargs.get("customTaskId")
        task_name = task_name or kwargs.get("taskName")
        list_name = list_name or kwargs.get("listName")
        space_name = space_name or kwargs.get("spaceName")
        comment_text = comment_text or kwargs.get("commentText", "")
        notify_all = notify_all if notify_all is not None else kwargs.get("notifyAll")
        assignee = assignee if assignee is not None else kwargs.get("assignee")
        if not comment_text:
            raise ClickUpServiceError("comment_text is required", ErrorCode.INVALID_PARAMETER)
        identifier = await _resolve_task_identifier(task_id, custom_task_id, task_name, list_name, space_name)
        return await get_task_service().create_task_comment(
            identifier,
            comment_text,
            notify_all=notify_all,
            assignee=assignee,
        )

    @register_tool("attach_task_file", "Attach a file to a task from base64, URL, or local path.")
    async def attach_task_file(
        task_id: Optional[str] = None,
        custom_task_id: Optional[str] = None,
        task_name: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        attachment_url: Optional[str] = None,
        file_path: Optional[str] = None,
        file_data: Optional[str] = None,
        filename: Optional[str] = None,
        auth_header: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
        task_id = task_id or kwargs.get("taskId")
        custom_task_id = custom_task_id or kwargs.get("customTaskId")
        task_name = task_name or kwargs.get("taskName")
        list_name = list_name or kwargs.get("listName")
        space_name = space_name or kwargs.get("spaceName")
        attachment_url = attachment_url or kwargs.get("attachmentUrl") or kwargs.get("fileUrl")
        file_path = file_path or kwargs.get("filePath")
        file_data = file_data or kwargs.get("fileData")
        filename = filename or kwargs.get("fileName")
        auth_header = auth_header or kwargs.get("authHeader")
        identifier = await _resolve_task_identifier(task_id, custom_task_id, task_name, list_name, space_name)
        return await get_task_service().attach_file(
            identifier,
            attachment_url=attachment_url,
            file_path=file_path,
            file_data=file_data,
            filename=filename,
            auth_header=auth_header,
        )

    @register_tool("get_tasks", "Retrieve tasks in a list with optional filters.")
    async def get_tasks(
        list_id: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        subtasks: Optional[bool] = None,
        statuses: Optional[list[str]] = None,
        archived: Optional[bool] = None,
        page: Optional[int] = None,
        order_by: Optional[str] = None,
        reverse: Optional[bool] = None,
        **kwargs: Any,
    ) -> Any:
        service = get_task_service()
        list_id = list_id or kwargs.get("listId") or kwargs.get("list_id")
        list_name = list_name or kwargs.get("listName")
        space_name = space_name or kwargs.get("spaceName")
        filters: Dict[str, Any] = {
            "subtasks": kwargs.get("include_subtasks", subtasks),
            "archived": archived if archived is not None else kwargs.get("archived"),
            "page": page if page is not None else kwargs.get("page"),
            "order_by": order_by or kwargs.get("orderBy") or kwargs.get("order_by"),
            "reverse": reverse if reverse is not None else kwargs.get("reverse"),
        }
        statuses_value = statuses or kwargs.get("statuses")
        if isinstance(statuses_value, str):
            filters["statuses"] = [item.strip() for item in statuses_value.split(",") if item.strip()]
        elif statuses_value:
            filters["statuses"] = statuses_value
        filters = {key: value for key, value in filters.items() if value is not None}
        result = await service.get_tasks(
            list_id,
            list_name=list_name,
            space_name=space_name,
            filters=filters,
        )
        return result

    @register_tool("create_bulk_tasks", "Create multiple tasks in bulk.")
    async def create_bulk_tasks(
        list_id: Optional[str] = None,
        tasks: Optional[list[Dict[str, Any]]] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
        task_items = tasks or kwargs.get("entries") or kwargs.get("tasks")
        if not task_items:
            raise ClickUpServiceError("tasks array is required", ErrorCode.INVALID_PARAMETER)
        service = get_task_service()
        resolved_list_id = await service.resolve_list_id(
            list_id or kwargs.get("listId") or kwargs.get("list_id"),
            list_name or kwargs.get("listName"),
            space_name or kwargs.get("spaceName"),
        )
        return await service.bulk_create_tasks(resolved_list_id, task_items)

    @register_tool("update_bulk_tasks", "Update multiple tasks.")
    async def update_bulk_tasks(entries: Optional[list[Dict[str, Any]]] = None, **kwargs: Any) -> Any:
        task_items = entries or kwargs.get("tasks") or kwargs.get("updates")
        if not task_items:
            raise ClickUpServiceError("entries array is required", ErrorCode.INVALID_PARAMETER)
        return await get_task_service().bulk_update_tasks(task_items)

    @register_tool("delete_bulk_tasks", "Delete multiple tasks.")
    async def delete_bulk_tasks(entries: Optional[list[Dict[str, Any]]] = None, **kwargs: Any) -> Any:
        task_items = entries or kwargs.get("tasks")
        if not task_items:
            raise ClickUpServiceError("entries array is required", ErrorCode.INVALID_PARAMETER)
        return await get_task_service().bulk_delete_tasks(task_items)

    @register_tool("move_bulk_tasks", "Move multiple tasks to a destination list.")
    async def move_bulk_tasks(
        tasks: Optional[list[Dict[str, Any]]] = None,
        target_list_id: Optional[str] = None,
        target_list_name: Optional[str] = None,
        target_space_name: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
        entries = tasks or kwargs.get("entries") or kwargs.get("tasks")
        if not entries:
            raise ClickUpServiceError("tasks array is required", ErrorCode.INVALID_PARAMETER)
        service = get_task_service()
        destination_id = await service.resolve_list_id(
            target_list_id or kwargs.get("targetListId"),
            target_list_name or kwargs.get("targetListName"),
            target_space_name or kwargs.get("targetSpaceName"),
        )
        return await service.move_bulk_tasks(entries, destination_id)

    @register_tool("get_workspace_tasks", "Retrieve workspace tasks with optional filters.")
    async def get_workspace_tasks(filters: Dict[str, Any] | None = None, **kwargs: Any) -> Any:
        payload = dict(filters or {})
        for key, value in kwargs.items():
            if value is not None:
                payload[key] = value
        return await get_task_service().list_workspace_tasks(payload)

    @register_tool("get_task_time_entries", "List time entries for a task.")
    async def get_task_time_entries(
        task_id: Optional[str] = None,
        custom_task_id: Optional[str] = None,
        task_name: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
        task_id = task_id or kwargs.get("taskId")
        custom_task_id = custom_task_id or kwargs.get("customTaskId")
        task_name = task_name or kwargs.get("taskName")
        list_name = list_name or kwargs.get("listName")
        space_name = space_name or kwargs.get("spaceName")
        start_date = start_date or kwargs.get("startDate") or kwargs.get("start_date")
        end_date = end_date or kwargs.get("endDate") or kwargs.get("end_date")
        identifier = await _resolve_task_identifier(task_id, custom_task_id, task_name, list_name, space_name)
        return await get_task_service().get_task_time_entries(
            identifier,
            start_date=start_date,
            end_date=end_date,
        )

    @register_tool("start_time_tracking", "Start time tracking for a task.")
    async def start_time_tracking(
        task_id: Optional[str] = None,
        custom_task_id: Optional[str] = None,
        task_name: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        user_id: Optional[int] = None,
        description: Optional[str] = None,
        billable: Optional[bool] = None,
        tags: Optional[list[str]] = None,
        **kwargs: Any,
    ) -> Any:
        task_id = task_id or kwargs.get("taskId")
        custom_task_id = custom_task_id or kwargs.get("customTaskId")
        task_name = task_name or kwargs.get("taskName")
        list_name = list_name or kwargs.get("listName")
        space_name = space_name or kwargs.get("spaceName")
        user_id = user_id if user_id is not None else kwargs.get("userId")
        description = description or kwargs.get("description")
        billable = billable if billable is not None else kwargs.get("billable")
        tags = tags or kwargs.get("tags")
        identifier = await _resolve_task_identifier(task_id, custom_task_id, task_name, list_name, space_name)
        details: Dict[str, Any] = {}
        if description:
            details["description"] = description
        if billable is not None:
            details["billable"] = billable
        if tags:
            details["tags"] = tags
        return await get_task_service().start_time_tracking(
            identifier,
            user_id,
            details=details,
        )

    @register_tool("stop_time_tracking", "Stop time tracking for a task.")
    async def stop_time_tracking(
        task_id: Optional[str] = None,
        custom_task_id: Optional[str] = None,
        task_name: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        description: Optional[str] = None,
        tags: Optional[list[str]] = None,
        **kwargs: Any,
    ) -> Any:
        task_id = task_id or kwargs.get("taskId")
        custom_task_id = custom_task_id or kwargs.get("customTaskId")
        task_name = task_name or kwargs.get("taskName")
        list_name = list_name or kwargs.get("listName")
        space_name = space_name or kwargs.get("spaceName")
        description = description or kwargs.get("description")
        tags = tags or kwargs.get("tags")
        identifier = await _resolve_task_identifier(task_id, custom_task_id, task_name, list_name, space_name)
        details: Dict[str, Any] = {}
        if description:
            details["description"] = description
        if tags:
            details["tags"] = tags
        return await get_task_service().stop_time_tracking(identifier, details=details)

    @register_tool("add_time_entry", "Add a manual time entry.")
    async def add_time_entry(
        entry: Optional[Dict[str, Any]] = None,
        task_id: Optional[str] = None,
        custom_task_id: Optional[str] = None,
        task_name: Optional[str] = None,
        list_name: Optional[str] = None,
        space_name: Optional[str] = None,
        **fields: Any,
    ) -> Any:
        task_id = task_id or fields.pop("taskId", None)
        custom_task_id = custom_task_id or fields.pop("customTaskId", None)
        task_name = task_name or fields.pop("taskName", None)
        list_name = list_name or fields.pop("listName", None)
        space_name = space_name or fields.pop("spaceName", None)
        payload = dict(entry or {})
        for key, value in fields.items():
            if value is not None:
                payload[key] = value
        service = get_task_service()
        if any([task_id, custom_task_id, task_name]) and "task_id" not in payload and "task" not in payload:
            identifier = await _resolve_task_identifier(task_id, custom_task_id, task_name, list_name, space_name)
            payload["task_id"] = await service._resolve_task_id(identifier)
        return await service.add_time_entry(payload)

    @register_tool("delete_time_entry", "Delete a time entry by ID.")
    async def delete_time_entry(time_entry_id: str, **kwargs: Any) -> Any:
        time_entry_id = time_entry_id or kwargs.get("timeEntryId")
        if not time_entry_id:
            raise ClickUpServiceError("time_entry_id is required", ErrorCode.INVALID_PARAMETER)
        return await get_task_service().delete_time_entry(time_entry_id)

    @register_tool("get_current_time_entry", "Get the active time entry for a user.")
    async def get_current_time_entry(user_id: Optional[int] = None) -> Any:
        return await get_task_service().get_current_time_entry(user_id)

    # ------------------------------------------------------------------
    # List & folder tools
    # ------------------------------------------------------------------
    @register_tool("create_list", "Create a list in a space.")
    async def create_list(space_id: str, data: Optional[Dict[str, Any]] = None, **fields: Any) -> Any:
        payload = dict(data or {})
        for key, value in fields.items():
            if value is not None:
                payload[key] = value
        return await get_list_service().create_list(space_id, payload)

    @register_tool("create_list_in_folder", "Create a list inside a folder.")
    async def create_list_in_folder(folder_id: str, data: Optional[Dict[str, Any]] = None, **fields: Any) -> Any:
        payload = dict(data or {})
        for key, value in fields.items():
            if value is not None:
                payload[key] = value
        return await get_list_service().create_list(folder_id, payload, in_folder=True)

    @register_tool("get_list", "Fetch a list by ID.")
    async def get_list(list_id: str) -> Any:
        return await get_list_service().get_list(list_id)

    @register_tool("update_list", "Update list details.")
    async def update_list(list_id: str, updates: Optional[Dict[str, Any]] = None, **fields: Any) -> Any:
        payload = dict(updates or {})
        for key, value in fields.items():
            if value is not None:
                payload[key] = value
        return await get_list_service().update_list(list_id, payload)

    @register_tool("delete_list", "Delete a list.")
    async def delete_list(list_id: str) -> Any:
        response = await get_list_service().delete_list(list_id)
        return {"success": response.success}

    @register_tool("create_folder", "Create a folder within a space.")
    async def create_folder(space_id: str, data: Optional[Dict[str, Any]] = None, **fields: Any) -> Any:
        payload = dict(data or {})
        for key, value in fields.items():
            if value is not None:
                payload[key] = value
        return await get_folder_service().create_folder(space_id, payload)

    @register_tool("get_folder", "Retrieve a folder by ID.")
    async def get_folder(folder_id: str) -> Any:
        return await get_folder_service().get_folder(folder_id)

    @register_tool("update_folder", "Update folder details.")
    async def update_folder(folder_id: str, updates: Optional[Dict[str, Any]] = None, **fields: Any) -> Any:
        payload = dict(updates or {})
        for key, value in fields.items():
            if value is not None:
                payload[key] = value
        return await get_folder_service().update_folder(folder_id, payload)

    @register_tool("delete_folder", "Delete a folder.")
    async def delete_folder(folder_id: str) -> Any:
        response = await get_folder_service().delete_folder(folder_id)
        return {"success": response.success}

    # ------------------------------------------------------------------
    # Tag tools
    # ------------------------------------------------------------------
    @register_tool("get_space_tags", "List all tags in a space.")
    async def get_space_tags(space_id: str) -> Any:
        return await get_tag_service().get_space_tags(space_id)

    @register_tool("add_tag_to_task", "Add a tag to a task.")
    async def add_tag_to_task(task_id: str, tag_name: str) -> Any:
        return await get_tag_service().add_tag_to_task(task_id, tag_name)

    @register_tool("remove_tag_from_task", "Remove a tag from a task.")
    async def remove_tag_from_task(task_id: str, tag_name: str) -> Any:
        return await get_tag_service().remove_tag_from_task(task_id, tag_name)

    # ------------------------------------------------------------------
    # Document tools (optional)
    # ------------------------------------------------------------------
    if config.document_support.lower() == "true":
        @register_tool("create_document", "Create a ClickUp document.", include_sponsor=True)
        async def create_document(data: Dict[str, Any]) -> Any:
            return await get_document_service().create_document(data)

        @register_tool("get_document", "Get a ClickUp document by ID.")
        async def get_document(document_id: str) -> Any:
            return await get_document_service().get_document(document_id)

        @register_tool("list_documents", "List documents in the workspace.")
        async def list_documents() -> Any:
            return await get_document_service().list_documents()

        @register_tool("list_document_pages", "List pages for a document.")
        async def list_document_pages(document_id: str) -> Any:
            return await get_document_service().list_document_pages(document_id)

        @register_tool("get_document_pages", "Alias for list_document_pages.")
        async def get_document_pages(document_id: str) -> Any:
            return await get_document_service().list_document_pages(document_id)

        @register_tool("create_document_page", "Create a page inside a document.")
        async def create_document_page(document_id: str, data: Dict[str, Any]) -> Any:
            return await get_document_service().create_document_page(document_id, data)

        @register_tool("update_document_page", "Update a document page.")
        async def update_document_page(document_id: str, page_id: str, data: Dict[str, Any]) -> Any:
            return await get_document_service().update_document_page(document_id, page_id, data)

    # ------------------------------------------------------------------
    # Member helpers
    # ------------------------------------------------------------------
    @register_tool("get_workspace_members", "List members of the workspace.")
    async def get_workspace_members() -> Any:
        return await get_member_service().list_members()

    @register_tool("find_member_by_name", "Find a workspace member by partial name.")
    async def find_member_by_name(query: str) -> Any:
        member = await get_member_service().find_member_by_name(query)
        return {"member": member}

    @register_tool("resolve_assignees", "Resolve member identifiers to ClickUp users.")
    async def resolve_assignees(identifiers: Optional[list[str]] = None, **kwargs: Any) -> Any:
        values = identifiers or kwargs.get("assignees") or []
        return await get_member_service().resolve_assignees(list(values))

    return server


async def _resolve_task_identifier(
    task_id: Optional[str],
    custom_task_id: Optional[str],
    task_name: Optional[str],
    list_name: Optional[str],
    space_name: Optional[str],
) -> TaskIdentifier:
    if task_id or custom_task_id:
        return _make_identifier(task_id, custom_task_id)
    if not task_name:
        raise ClickUpServiceError("A task identifier or name is required", ErrorCode.INVALID_PARAMETER)
    service = get_task_service()
    task = await service.find_task_by_name(task_name, list_name=list_name, space_name=space_name)
    if not task:
        raise ClickUpServiceError(
            f"Unable to locate task named '{task_name}'",
            ErrorCode.TASK_ERROR,
        )
    return _make_identifier(str(task.get("id")), None)


def _make_identifier(task_id: Optional[str], custom_task_id: Optional[str]) -> TaskIdentifier:
    return TaskIdentifier(task_id=task_id, custom_id=custom_task_id)


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _format_workspace_tree(node) -> str:
    lines: list[str] = []

    def walk(current, prefix: str, is_last: bool, is_root: bool = False) -> None:
        connector = "" if is_root else ("└── " if is_last else "├── ")
        lines.append(f"{prefix}{connector}{current.name} ({current.type.title()} ID: {current.id})")
        child_prefix = prefix if is_root else prefix + ("    " if is_last else "│   ")
        for index, child in enumerate(current.children):
            walk(child, child_prefix, index == len(current.children) - 1)

    walk(node, "", True, True)
    return "\n".join(lines)


__all__ = ["create_server"]
