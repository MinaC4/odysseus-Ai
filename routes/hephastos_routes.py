"""Owner-bound browser reads use the same provider as the agent."""
from fastapi import APIRouter, Request, HTTPException
from src.auth_helpers import get_current_user
from services.hephastos import read_hephastos, HephastosUnavailable

router = APIRouter(prefix="/api/hephastos", tags=["hephastos"])


@router.get("/{capability}")
async def read_source(capability: str, request: Request, cluster_id: str | None = None):
    owner = get_current_user(request)
    if not owner:
        raise HTTPException(401, "Authentication required")
    try:
        return await read_hephastos(capability, cluster_id, owner=owner)
    except PermissionError:
        raise HTTPException(403, "Hephastos is not connected to this account")
    except HephastosUnavailable:
        raise HTTPException(503, "Hephastos source unavailable")
    except ValueError:
        raise HTTPException(400, "Unsupported capability or missing cluster selection")
