import json
from services.productivity import query_collection
from services.productivity_proposals import propose


class ProductivityTool:
    async def execute(self, content, ctx):
        try:
            owner = ctx.get("owner")
            if not owner or owner in {"api", "internal-tool", "system", "demo"}: raise PermissionError()
            args = json.loads(content)
            if not isinstance(args, dict): raise ValueError()
            collection = args.get("collection")
            if args.get("action") in {"list","get"}:
                columns='id,date,title,status,priority,done,language,category,url,link,progress_percent,pinned,favorite,item_id,kind,file_name,size_bytes,created_at'
                query={"filters":args.get("filters",[]),"limit":50,"columns":columns}
                if args['action']=='get':
                    if not isinstance(args.get('record_id'),str):raise ValueError()
                    query={"filters":[{"field":"date" if collection=='daily_entries' else 'id','op':'eq','value':args['record_id']}],"limit":1}
                data = query_collection(owner, collection, query)
                for row in data:
                    for key in ("data_base64", "image_base64"): row.pop(key, None)
                    for key,value in list(row.items()):
                        if isinstance(value,str) and len(value)>40_000:row[key]=value[:40_000];row[f'{key}_truncated']=True
                output = {"source": "odysseus.productivity", "records": data, "bounded": True}
            elif args.get("action") == "propose": output = propose(owner, collection, args.get("operation"))
            else: raise ValueError()
            encoded = json.dumps(output, ensure_ascii=False)
            if len(encoded) > 100_000: raise ValueError("Narrow your record selection")
            return {"output": encoded, "exit_code": 0}
        except (ValueError, PermissionError, TypeError): return {"error": "Use an owned collection and list, get or propose. Edits require human review.", "exit_code": 1}
