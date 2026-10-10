import json
from services.productivity import query_collection
from services.productivity_proposals import propose


_COLUMNS = {
    "calendar_items": "id,date,time,title,type,link,done,priority,duration_min,notify_minutes,notify_message,reminder_time,notes,sort_order,created_at,updated_at",
    "daily_entries": "date,raw_notes,ai_summary,updated_at",
    "ideas": "id,title,description,status,priority,tags,link,sort_order,created_at,updated_at",
    "scripts": "id,title,description,language,content,favorite,copy_count,tags,sort_order,created_at,updated_at",
    "learning_items": "id,title,provider,status,progress_percent,start_date,target_end_date,link,notes,created_at,updated_at,category,priority,tags,favorite,estimated_hours,hours_spent,completed_at,score,image_mime_type,sort_order",
    "learning_materials": "id,item_id,kind,title,url,file_name,mime_type,size_bytes,created_at",
    "bookmarks": "id,title,url,description,category,tags,pinned,sort_order,created_at,updated_at",
    "shared_items": "id,kind,title,file_name,mime_type,size_bytes,content,note,created_at,sort_order",
    "shared_item_files": "id,item_id,file_name,mime_type,size_bytes,created_at",
    "quick_links": "id,title,url,type,icon,category,description,tags,favorite,sort_order,created_at,updated_at",
}


def _write_result(collection, row, changed):
    key = "date" if collection == "daily_entries" else "id"
    summary_fields = ("title", "date", "time", "status", "priority", "done", "progress_percent", "url")
    return {"saved": True, "collection": collection, "record_id": row.get(key),
            "changed_fields": list(changed), **{field: row[field] for field in summary_fields if field in row}}


class ProductivityTool:
    async def execute(self, content, ctx):
        try:
            owner = ctx.get("owner")
            if not owner or owner in {"api", "internal-tool", "system", "demo"}: raise PermissionError()
            args = json.loads(content)
            if not isinstance(args, dict): raise ValueError()
            collection = args.get("collection")
            action = args.get("action")
            if collection not in _COLUMNS: raise ValueError()
            key_field = "date" if collection == "daily_entries" else "id"
            if action in {"list", "get"}:
                limit = args.get("limit", 20)
                offset = args.get("offset", 0)
                if type(limit) is not int or not 1 <= limit <= 50 or type(offset) is not int or offset < 0: raise ValueError()
                query = {"filters": args.get("filters", []), "limit": 1 if action == "get" else limit, "offset": offset if action == "list" else 0, "columns": _COLUMNS[collection]}
                if action == "get":
                    if not isinstance(args.get("record_id"), str): raise ValueError()
                    query["filters"] = [{"field": key_field, "op": "eq", "value": args["record_id"]}]
                data = query_collection(owner, collection, query)
                for row in data:
                    for key, value in list(row.items()):
                        if isinstance(value, str) and len(value) > 4_000:
                            row[key] = value[:4_000]
                            row[f"{key}_truncated"] = True
                output = {"source": "odysseus.productivity", "records": data, "bounded": True}
                if action == "list": output.update({"limit": limit, "next_offset": offset + limit if len(data) == limit else None})
            elif action == "create":
                values = args.get("values")
                if not isinstance(values, dict) or set(values) & {"data_base64", "image_base64"}: raise ValueError()
                row = query_collection(owner, collection, {"action": "insert", "values": values, "limit": 1})[0]
                output = _write_result(collection, row, values)
            elif action == "update":
                values = args.get("values")
                blocked = {"id", "owner", "data_base64", "image_base64"} | ({"date"} if collection == "daily_entries" else set())
                if not isinstance(values, dict) or not values or set(values) & blocked: raise ValueError()
                record_id = args.get("record_id")
                if not isinstance(record_id, str) or not record_id: raise ValueError()
                rows = query_collection(owner, collection, {"action": "update", "filters": [{"field": key_field, "op": "eq", "value": record_id}], "values": values, "limit": 1})
                if len(rows) != 1: raise ValueError()
                output = _write_result(collection, rows[0], values)
            elif action == "delete":
                record_id = args.get("record_id")
                if not isinstance(record_id, str) or not record_id: raise ValueError()
                rows = query_collection(owner, collection, {"action": "delete", "filters": [{"field": key_field, "op": "eq", "value": record_id}], "limit": 1})
                if len(rows) != 1: raise ValueError()
                output = {"deleted": True, "record_id": record_id, "collection": collection}
            elif action == "propose": output = propose(owner, collection, args.get("operation"))
            else: raise ValueError()
            encoded = json.dumps(output, ensure_ascii=False)
            record_count = len(output["records"]) if action == "list" else 0
            while action == "list" and len(encoded) > 100_000 and output["records"]:
                output["records"].pop()
                output["next_offset"] = offset + len(output["records"])
                encoded = json.dumps(output, ensure_ascii=False)
            if record_count and not output["records"]: raise ValueError("Narrow your record selection")
            if len(encoded) > 100_000: raise ValueError("Narrow your record selection")
            return {"output": encoded, "exit_code": 0}
        except (ValueError, PermissionError, TypeError, IndexError): return {"error": "Use an owned collection; list/get records, create with values, update/delete by exact record_id, or propose a reviewed change. File bytes are not exposed or writable here.", "exit_code": 1}
