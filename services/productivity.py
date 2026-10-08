"""Owned SQLite/Postgres persistence for the migrated productivity tools."""
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4
import base64
import math
from contextlib import nullcontext

from core.database import SessionLocal, ProductivityRecord, ProductivityEvent

COLLECTIONS = {"calendar_items", "daily_entries", "ideas", "scripts", "learning_items",
               "learning_materials", "bookmarks", "shared_items", "shared_item_files"}
DEFAULTS = {
    "calendar_items": {"time": None, "done": False, "type": "task", "priority": "medium", "duration_min": 0,
                       "notify_minutes": 10, "notify_message": None, "reminder_time": None, "notes": "", "link": None, "sort_order": 0},
    "daily_entries": {"raw_notes": "", "ai_summary": ""},
    "ideas": {"description": "", "status": "new", "priority": "medium", "tags": [], "link": None, "sort_order": 0},
    "scripts": {"description": "", "language": "bash", "content": "", "favorite": False, "copy_count": 0, "tags": [], "sort_order": 0},
    "learning_items": {"status": "not_started", "progress_percent": 0, "category": "course", "priority": "medium", "tags": [], "favorite": False,
                       "hours_spent": 0, "estimated_hours": 0, "notes": "", "sort_order": 0},
    "learning_materials": {"kind": "link", "size_bytes": 0},
    "bookmarks": {"description": "", "category": "other", "tags": [], "pinned": False, "sort_order": 0},
    "shared_items": {"kind": "file", "size_bytes": 0, "sort_order": 0},
    "shared_item_files": {"size_bytes": 0},
}

def validate_record(collection, payload, db, owner):
    if len(str(payload)) > 15_000_000: raise ValueError("Record exceeds size limit")
    if 'tags' in payload and (not isinstance(payload['tags'],list) or len(payload['tags'])>100 or any(not isinstance(tag,str) or len(tag)>100 for tag in payload['tags'])):
        raise ValueError('Tags must be a bounded text list')
    for field in ('done','favorite','pinned'):
        if field in payload and type(payload[field]) is not bool:raise ValueError('Invalid boolean field')
    for field in ('sort_order','size_bytes','duration_min','notify_minutes','copy_count','progress_percent','hours_spent','estimated_hours'):
        if field in payload and (type(payload[field]) not in {int,float} or not math.isfinite(payload[field])):raise ValueError('Invalid numeric field')
    if collection in {'calendar_items','daily_entries'}:
        from datetime import date,time
        try:
            date.fromisoformat(payload.get('date',''))
            for field in ('time','reminder_time'):
                if payload.get(field):time.fromisoformat(payload[field])
        except (ValueError,TypeError):raise ValueError('Use a valid date and 24-hour clock time')
    for field in ("data_base64", "image_base64"):
        content = payload.get(field)
        if content:
            if not isinstance(content, str): raise ValueError("Invalid attachment")
            try: binary = base64.b64decode(content, validate=True)
            except ValueError as exc: raise ValueError("Invalid attachment encoding") from exc
            if len(binary) > 10 * 1024 * 1024: raise ValueError("Attachment exceeds 10 MiB")
            if field == "data_base64" and payload.get("size_bytes") not in {None, len(binary)}:
                raise ValueError("Attachment size mismatch")
    parent = {"shared_item_files": "shared_items", "learning_materials": "learning_items"}.get(collection)
    if parent and not db.get(ProductivityRecord, (owner, parent, payload.get("item_id"))):
        raise ValueError("Attachment parent does not belong to this account")
    if collection == "calendar_items" and not payload.get("date"): raise ValueError("Task date is required")
    if collection not in {"daily_entries", "shared_item_files"} and (not isinstance(payload.get("title"), str) or not payload['title'].strip() or len(payload['title'])>1000):
        raise ValueError("A title is required")


def record_key(collection, payload):
    value = payload.get("date" if collection == "daily_entries" else "id")
    if not isinstance(value, str) or not value or len(value) > 100:
        raise ValueError("A stable record ID is required")
    return value


def import_snapshot(owner, snapshot):
    """Insert only into empty collections; conflicting captures cannot overwrite edits."""
    if not owner or not isinstance(snapshot, dict) or set(snapshot) != COLLECTIONS:
        raise ValueError("A complete owned workspace capture is required")
    total = 0
    with SessionLocal.begin() as db:
        for collection, rows in snapshot.items():
            if not isinstance(rows, list) or len(rows) > 100_000:
                raise ValueError("Invalid collection capture")
            for payload in rows:
                if not isinstance(payload, dict):
                    raise ValueError("Invalid record")
                key = record_key(collection, payload)
                existing = db.get(ProductivityRecord, (owner, collection, key))
                if existing and existing.payload != payload:
                    raise ValueError("Capture conflicts with saved data; no records were replaced")
                if not existing:
                    db.add(ProductivityRecord(owner=owner, collection=collection, record_id=key, payload=deepcopy(payload)))
                total += 1
        db.add(ProductivityEvent(id=str(uuid4()), owner=owner, action="import", collection="all", record_ids=[]))
    return total


def export_snapshot(owner):
    with SessionLocal() as db:
        result = {collection: [] for collection in sorted(COLLECTIONS)}
        for row in db.query(ProductivityRecord).filter_by(owner=owner).filter(ProductivityRecord.collection.in_(COLLECTIONS)).order_by(ProductivityRecord.collection, ProductivityRecord.record_id):
            result[row.collection].append(deepcopy(row.payload))
        return result


def query_collection(owner, collection, query, db_session=None):
    if collection not in COLLECTIONS:
        raise ValueError("Unknown collection")
    action = query.get("action", "select")
    if action not in {"select", "insert", "update", "delete", "upsert"}:
        raise ValueError("Unknown action")
    filters = query.get("filters", [])
    if not isinstance(filters, list) or len(filters) > 10:
        raise ValueError("Invalid filters")
    for condition in filters:
        if (not isinstance(condition, dict) or condition.get("op") not in {"eq", "in", "gte", "lte", "not_null"}
                or not isinstance(condition.get("field"), str)):
            raise ValueError("Invalid filter")
    if action in {"update", "delete"} and not filters:
        raise ValueError("An explicit record selection is required")
    def matches(payload):
        for condition in filters:
            value, wanted = payload.get(condition["field"]), condition.get("value")
            op = condition["op"]
            if op == 'not_null' and value is None:return False
            if op == "eq" and value != wanted: return False
            if op == "in" and (not isinstance(wanted, list) or value not in wanted): return False
            if op in {"gte", "lte"} and (value is None or wanted is None): return False
            if op == "gte" and value < wanted: return False
            if op == "lte" and value > wanted: return False
        return True
    with (nullcontext(db_session) if db_session is not None else SessionLocal.begin()) as db:
        rows = db.query(ProductivityRecord).filter_by(owner=owner, collection=collection).all()
        selected = [row for row in rows if matches(row.payload)]
        result = []
        if action in {"insert", "upsert"}:
            payloads = query.get("values", {})
            payloads = payloads if isinstance(payloads, list) else [payloads]
            if not payloads or len(payloads) > 1000: raise ValueError("Invalid batch size")
            for supplied in payloads:
                if not isinstance(supplied, dict): raise ValueError("Invalid record")
                payload = {**deepcopy(DEFAULTS[collection]), **supplied}
                now = datetime.now(timezone.utc).isoformat()
                payload.setdefault("created_at", now); payload.setdefault("updated_at", now)
                if collection != "daily_entries": payload.setdefault("id", str(uuid4()))
                key = record_key(collection, payload)
                existing = db.get(ProductivityRecord, (owner, collection, key))
                if existing:
                    if action != "upsert": raise ValueError("Record already exists")
                    updated = {**existing.payload, **supplied}
                    validate_record(collection, updated, db, owner)
                    existing.payload = updated
                    result.append(deepcopy(existing.payload))
                else:
                    validate_record(collection, payload, db, owner)
                    db.add(ProductivityRecord(owner=owner, collection=collection, record_id=key, payload=payload))
                    result.append(deepcopy(payload))
                db.flush()
        elif action == "update":
            patch = query.get("values")
            if not isinstance(patch, dict) or set(patch) & ({"id", "owner"} | ({"date"} if collection == "daily_entries" else set())):
                raise ValueError("Record identity cannot change")
            for row in selected:
                payload = {**row.payload, **patch}
                validate_record(collection, payload, db, owner)
                row.payload = payload
                result.append(deepcopy(row.payload))
        elif action == "delete":
            children = {"shared_items": "shared_item_files", "learning_items": "learning_materials"}
            for row in selected:
                result.append(deepcopy(row.payload))
                if collection in children:
                    for child in db.query(ProductivityRecord).filter_by(owner=owner, collection=children[collection]).all():
                        if child.payload.get("item_id") == row.record_id: db.delete(child)
                db.delete(row)
        else:
            result = [deepcopy(row.payload) for row in selected]
        if action != "select":
            db.add(ProductivityEvent(id=str(uuid4()), owner=owner, action=action, collection=collection,
                                     record_ids=[record_key(collection, row) for row in result]))
        orders = query.get("orders", [])
        if not isinstance(orders, list) or len(orders) > 4: raise ValueError("Invalid ordering")
        for order in reversed(orders):
            field = order.get("field")
            result.sort(key=lambda payload: (payload.get(field) is None, payload.get(field)), reverse=not order.get("ascending", True))
        offset, limit = query.get("offset", 0), query.get("limit", 1000)
        if not isinstance(offset, int) or not isinstance(limit, int) or offset < 0 or not 1 <= limit <= 1000:
            raise ValueError("Invalid pagination")
        result = result[offset:offset + limit]
        columns = query.get("columns", "*")
        if not isinstance(columns, str) or len(columns) > 2000: raise ValueError("Invalid columns")
        if columns != "*": result = [{field: row.get(field) for field in columns.split(",")} for row in result]
        if query.get("single"):
            if len(result) > 1 or (not result and query["single"] == "required"): raise ValueError("Expected one saved record")
            return result[0] if result else None
        return result
