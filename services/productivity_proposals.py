import hashlib
import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from core.database import SessionLocal, ProductivityProposal
from services.productivity import query_collection, COLLECTIONS


def revision(owner, collection, operation, db=None):
    rows = query_collection(owner, collection, {"filters": operation.get("filters", []), "limit": 1000}, db_session=db)
    return hashlib.sha256(json.dumps(rows, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def propose(owner, collection, operation):
    if collection not in COLLECTIONS or not owner or not isinstance(operation, dict): raise ValueError("Invalid proposal")
    if operation.get("action") not in {"insert", "update", "delete", "upsert"}: raise ValueError("Invalid proposal action")
    if len(json.dumps(operation)) > 50_000: raise ValueError("Proposal exceeds review limit")
    if operation["action"] in {"update", "delete"}:
        filters = operation.get("filters", [])
        field = "date" if collection == "daily_entries" else "id"
        if not filters or any(f.get("field") != field or f.get("op") not in {"eq", "in"} for f in filters):
            raise ValueError("Select explicit record IDs")
        if any(f.get("op") == "in" and (not isinstance(f.get("value"), list) or len(f["value"]) > 20) for f in filters):
            raise ValueError("Review at most 20 records")
    identifier = str(uuid4())
    with SessionLocal.begin() as db:
        db.add(ProductivityProposal(id=identifier, owner=owner, collection=collection, operation=operation,
                                    revision=revision(owner, collection, operation, db)))
    return {"proposal_id": identifier, "state": "pending human confirmation", "destination": "Personal workspace → Review assistant changes"}


def pending(owner):
    with SessionLocal() as db:
        return [{"id": row.id, "collection": row.collection, "operation": row.operation, "created_at": row.created_at.isoformat()}
                for row in db.query(ProductivityProposal).filter_by(owner=owner, status="pending").order_by(ProductivityProposal.created_at.desc()).limit(20)]


def decide(owner, identifier, approve):
    with SessionLocal.begin() as db:
        claimed = db.query(ProductivityProposal).filter_by(id=identifier, owner=owner, status="pending").update({"status": "processing"})
        if claimed != 1: raise ValueError("Proposal is not available")
        row = db.get(ProductivityProposal, identifier)
        result = None
        if approve:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            if row.created_at < now - timedelta(minutes=30) or row.revision != revision(owner, row.collection, row.operation, db):
                raise ValueError("Proposal expired or records changed")
            result = query_collection(owner, row.collection, row.operation, db_session=db)
        row.status = "approved" if approve else "rejected"
        return result
