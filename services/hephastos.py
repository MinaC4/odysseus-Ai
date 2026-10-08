"""Server-only Hephastos connection; no arbitrary URL or method from model input."""
import json
import os
from urllib.parse import urlsplit

import httpx


class HephastosUnavailable(ValueError):
    pass


ASSISTANT_TOOLS = frozenset({"read_hephastos", "manage_productivity", "manage_notes", "manage_calendar",
    "manage_documents", "create_document", "edit_document", "update_document", "suggest_document",
    "manage_memory", "search_chats", "web_search", "web_fetch", "get_weather", "ask_user", "update_plan"})


def is_linked_assistant(owner, session_id):
    configured=os.environ.get("HEPHASTOS_WORKSPACE_OWNER", "")
    if not session_id or not configured:
        return False
    from core.database import SessionLocal, CrewMember
    with SessionLocal() as db:
        linked=db.query(CrewMember.id).filter_by(owner=configured, session_id=session_id, is_default_assistant=True).first() is not None
        if linked and owner!=configured:raise PermissionError('Assistant session owner mismatch')
        return linked


def require_owner(owner):
    expected = os.environ.get("HEPHASTOS_WORKSPACE_OWNER", "")
    if not expected or not owner or owner != expected:
        raise PermissionError("Hephastos is not connected to this account")


def connection(owner):
    require_owner(owner)
    base = os.environ.get("HEPHASTOS_URL", "").rstrip("/")
    token = os.environ.get("HEPHASTOS_BRIDGE_TOKEN", "")
    parsed = urlsplit(base)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment or parsed.path or len(token) < 32):
        raise HephastosUnavailable("Hephastos connection is not configured")
    return base, token


async def read_hephastos(capability, cluster_id=None, *, owner, project_id=None, file_path=None, start_line=1,character_offset=0):
    require_owner(owner)
    if capability == 'knowledge':
        from services.project_knowledge import read_knowledge
        return read_knowledge(owner,project_id,file_path,start_line,character_offset)
    if capability == 'context':
        from services.hephastos_context import work_context
        return work_context(owner)
    if capability not in {"clusters", "inventory", "projects", "tasks", "tools"}:
        raise ValueError("Unsupported Hephastos read capability")
    if capability == "inventory" and (not isinstance(cluster_id, str) or not cluster_id):
        raise ValueError("Select an explicit cluster from the clusters result")
    base, token = connection(owner)
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False) as client:
            async with client.stream("GET", f"{base}/api/assistant/{capability}",
                    headers={"Authorization": f"Bearer {token}"},
                    params={"clusterId": cluster_id} if capability == "inventory" else {}) as response:
                if response.status_code != 200:
                    raise HephastosUnavailable("Hephastos source is unavailable; do not infer runtime health")
                payload = bytearray()
                async for chunk in response.aiter_bytes():
                    payload.extend(chunk)
                    if len(payload) > 1_000_000:
                        raise HephastosUnavailable("Hephastos response exceeded the evidence limit")
                data = json.loads(payload)
                if not isinstance(data, dict) or not data.get("source") or not data.get("observedAt"):
                    raise HephastosUnavailable("Hephastos response has no verified provenance")
                return data
    except (httpx.HTTPError, json.JSONDecodeError) as exc:
        raise HephastosUnavailable("Hephastos source is unreachable or returned invalid evidence") from exc


async def create_project_task(values, *, owner):
    base, token = connection(owner)
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False) as client:
            response = await client.post(f"{base}/api/assistant/tasks", headers={"Authorization": f"Bearer {token}"}, json=values)
            if response.status_code != 200: raise HephastosUnavailable("Task could not be created")
            return response.json()
    except (httpx.HTTPError, json.JSONDecodeError) as exc:
        raise HephastosUnavailable("Project task source unavailable") from exc
