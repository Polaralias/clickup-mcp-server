"""Shared service registry for runtime access."""
from __future__ import annotations

from typing import Optional

from ..config import ServerConfig
from . import ClickUpServices, create_services


_services: Optional[ClickUpServices] = None


def init_services(config: ServerConfig) -> ClickUpServices:
    global _services
    _services = create_services(config.clickup_api_key, config.clickup_team_id)
    return _services


def get_services() -> ClickUpServices:
    if _services is None:
        raise RuntimeError("Services have not been initialised")
    return _services


def get_workspace_service():
    return get_services().workspace


def get_task_service():
    return get_services().task


def get_list_service():
    return get_services().list


def get_folder_service():
    return get_services().folder


def get_tag_service():
    return get_services().tag


def get_document_service():
    return get_services().document


def get_member_service():
    return get_services().member


__all__ = [
    "init_services",
    "get_services",
    "get_workspace_service",
    "get_task_service",
    "get_list_service",
    "get_folder_service",
    "get_tag_service",
    "get_document_service",
    "get_member_service",
]
