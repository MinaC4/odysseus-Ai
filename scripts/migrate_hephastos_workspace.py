"""Run inside Odysseus with configured server connection; source stays untouched."""
import asyncio
import hashlib
import json
import os
import sqlite3
from pathlib import Path
from datetime import datetime, timezone

import httpx
from services.hephastos import connection
from services.productivity import COLLECTIONS, import_snapshot, export_snapshot
from src.constants import DATA_DIR


def digest(snapshot):
    canonical={key: sorted(rows,key=lambda row:row.get('id',row.get('date',''))) for key,rows in snapshot.items()}
    return hashlib.sha256(json.dumps(canonical,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()


async def capture(owner, collections=COLLECTIONS):
    base,token=connection(owner)
    result={}
    total_bytes=0
    async with httpx.AsyncClient(timeout=30,follow_redirects=False,trust_env=False) as client:
        for collection in sorted(collections):
            rows=[]
            while True:
                async with client.stream('GET',f'{base}/api/assistant/workspace-export/{collection}',
                    headers={'Authorization':f'Bearer {token}'},params={'offset':len(rows)}) as response:
                    if response.status_code!=200: raise RuntimeError('Source capture failed; no data was imported')
                    payload=bytearray()
                    async for chunk in response.aiter_bytes():
                        payload.extend(chunk); total_bytes+=len(chunk)
                        if len(payload)>150_000_000 or total_bytes>256_000_000: raise RuntimeError('Capture exceeded migration limit')
                    page=json.loads(payload)
                batch=page.get('rows')
                if page.get('table')!=collection or not isinstance(batch,list): raise RuntimeError('Invalid source capture')
                if not batch: break
                rows.extend(batch)
                if len(rows)>100_000: raise RuntimeError('Record limit exceeded')
            result[collection]=rows
    return result


async def main():
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('--collection',choices=sorted(COLLECTIONS))
    options=parser.parse_args()
    collections={options.collection} if options.collection else COLLECTIONS
    owner=os.environ.get('HEPHASTOS_WORKSPACE_OWNER')
    if not owner: raise RuntimeError('Configure the exact workspace owner first')
    first=await capture(owner,collections)
    second=await capture(owner,collections)
    if digest(first)!=digest(second): raise RuntimeError('Source changed during capture; retry without editing either workspace')
    folder=Path(DATA_DIR)/'backups'; folder.mkdir(mode=0o700,exist_ok=True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup=folder/f'before-hephastos-{stamp}.db'
    with sqlite3.connect(str(Path(DATA_DIR)/'app.db')) as source, sqlite3.connect(str(backup)) as target:
        source.backup(target)
    os.chmod(backup,0o600)
    combined=export_snapshot(owner)
    combined.update(first)
    count=import_snapshot(owner,combined)
    saved={key:rows for key,rows in export_snapshot(owner).items() if key in collections}
    if digest(saved)!=digest(first): raise RuntimeError('Saved capture differs from source; keep source active and inspect the backup')
    from core.database import SessionLocal,ProductivityEvent
    from uuid import uuid4
    with SessionLocal.begin() as db:
        db.add(ProductivityEvent(id=str(uuid4()),owner=owner,action='migration.verified',collection='all',record_ids=[]))
    report={'owner':owner,'records':count,'collections':{key:len(rows) for key,rows in saved.items()},
            'sha256':digest(saved),'backup':str(backup),'source_deleted':False}
    print(json.dumps(report,indent=2))


if __name__=='__main__': asyncio.run(main())
