import json
from starlette.concurrency import run_in_threadpool
from services.hephastos import read_hephastos, create_project_task, HephastosUnavailable
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response
from src.auth_helpers import get_current_user
from src.agent_runtime.authority import is_internal_tool_request
from services.productivity import query_collection, export_snapshot
from services.productivity_proposals import pending, decide

router = APIRouter(prefix="/api/productivity", tags=["productivity"])

@router.get('/status')
def status(request:Request):
    from core.database import SessionLocal,ProductivityEvent,engine
    owner=owner_for(request)
    with SessionLocal() as db:
        ready=db.query(ProductivityEvent.id).filter_by(owner=owner,action='migration.verified',collection='all').first() is not None
    return {'ready':ready,'storage':engine.dialect.name,'owner':owner}


def owner_for(request):
    owner = get_current_user(request)
    if not owner or owner in {"api", "internal-tool", "system", "demo"}:
        raise HTTPException(401, "A personal session is required")
    return owner


@router.get("/export")
def export(request: Request):
    return Response(json.dumps(export_snapshot(owner_for(request)), ensure_ascii=False), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="personal-workspace.json"'})


@router.get("/proposals")
def proposals(request: Request):
    return pending(owner_for(request))


@router.post("/proposals/{identifier}/decision")
async def decision(identifier: str, request: Request):
    owner = owner_for(request)
    if is_internal_tool_request(request) or getattr(request.state, "api_token", False):
        raise HTTPException(403, "Only the human session can approve changes")
    if request.headers.get("origin") != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "Same-origin confirmation is required")
    body = await request.json()
    if not isinstance(body, dict) or type(body.get("approve")) is not bool: raise HTTPException(400, "Confirm approve or reject")
    try: return {"data": decide(owner, identifier, body["approve"])}
    except ValueError: raise HTTPException(409, "Proposal unavailable, expired or changed")


@router.post("/{collection}/query")
async def query(collection: str, request: Request):
    owner = owner_for(request)
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 15_000_000: raise HTTPException(413, "Workspace payload exceeds 15 MB")
    try:
        body = json.loads(data)
        if not isinstance(body, dict): raise ValueError("Invalid query")
        if body.get("action", "select") != "select":
            # A model cannot turn its generated request into human approval.
            if is_internal_tool_request(request) or getattr(request.state, "api_token", False):
                raise HTTPException(403, "Interactive confirmation is required for workspace changes")
            origin = request.headers.get("origin")
            if origin and origin != str(request.base_url).rstrip("/"):
                raise HTTPException(403, "Cross-origin changes are not allowed")
        if collection == "projects" and body.get("action", "select") == "select":
            result = await read_hephastos("projects", owner=owner)
            return {"data": result["projects"], "error": None}
        if collection == "tasks" and body.get("action") == "insert":
            result = await create_project_task(body.get("values"), owner=owner)
            result["data"] = result["data"][0] if body.get("single") else result["data"]
            return result
        return {"data": await run_in_threadpool(query_collection, owner, collection, body), "error": None}
    except (HephastosUnavailable, PermissionError):
        raise HTTPException(503, "The linked engineering project source is unavailable")
    except (ValueError, TypeError, KeyError):
        raise HTTPException(400, "Invalid workspace query or record")
