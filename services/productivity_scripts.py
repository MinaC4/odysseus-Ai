"""Human-only execution of saved scripts on server-provisioned SSH profiles."""
import asyncio
import hashlib
import json
import os
import re
from pathlib import Path
from uuid import uuid4
from core.database import SessionLocal, ProductivityRecord, ProductivityEvent

def profiles():
    filename=os.environ.get('ODYSSEUS_SCRIPT_DEVICES_FILE')
    if not filename: return []
    path=Path(filename)
    if not path.is_absolute() or not path.is_file() or path.stat().st_size>131072: raise ValueError('Invalid device configuration')
    items=json.loads(path.read_text())
    if not isinstance(items,list) or len(items)>100: raise ValueError('Invalid device configuration')
    seen=set()
    for item in items:
        if not isinstance(item,dict) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}',item.get('id','')) or item['id'] in seen: raise ValueError('Invalid device ID')
        seen.add(item['id'])
        if not isinstance(item.get('name'),str) or not item['name'].strip() or len(item['name'])>120: raise ValueError('Invalid device name')
        if (not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}',item.get('host',''))
            or not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}',item.get('username',''))
            or type(item.get('port')) is not int or not 1<=item['port']<=65535): raise ValueError('Invalid SSH target')
        for field in ('privateKeyPath','knownHostsPath'):
            value=item.get(field,'')
            if not isinstance(value,str) or not Path(value).is_absolute() or any(char in value for char in '\r\n\0'): raise ValueError('Invalid SSH file')
    return items

def devices(owner):
    with SessionLocal() as db:
        setting=db.get(ProductivityRecord,(owner,'script_devices','registered'))
        registered=setting.payload.get('deviceIds',[]) if setting else []
    return {'devices':[{**{key:profile.get(key) for key in ('id','name','host','port','username')},'registered':profile['id'] in registered} for profile in profiles()]}

def register(owner,ids):
    known={profile['id'] for profile in profiles()}
    if not isinstance(ids,list) or len(ids)>100 or any(not isinstance(value,str) or value not in known for value in ids) or len(set(ids))!=len(ids): raise ValueError('Use provisioned devices only')
    with SessionLocal.begin() as db:
        row=db.get(ProductivityRecord,(owner,'script_devices','registered'))
        if row: row.payload={'deviceIds':ids}
        else: db.add(ProductivityRecord(owner=owner,collection='script_devices',record_id='registered',payload={'deviceIds':ids}))
        db.add(ProductivityEvent(id=str(uuid4()),owner=owner,action='register',collection='script_devices',record_ids=ids))

def review(owner,identifier):
    with SessionLocal() as db:
        row=db.get(ProductivityRecord,(owner,'scripts',identifier))
        if not row or not isinstance(row.payload.get('content'),str): raise ValueError('Saved script unavailable')
        script=dict(row.payload)
    if len(script['content'].encode())>131072 or '\0' in script['content']: raise ValueError('Script exceeds execution limit')
    return script,hashlib.sha256(script['content'].encode()).hexdigest()

def ssh_args(profile,language):
    interpreter={'bash':'bash -s','python':'python3 -'}.get(language)
    if not interpreter: raise ValueError('Execution supports Bash and Python only')
    return ['-F','/dev/null','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',f"UserKnownHostsFile={profile['knownHostsPath']}",
        '-o','GlobalKnownHostsFile=/dev/null','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','ForwardAgent=no','-o','ClearAllForwardings=yes',
        '-o','ConnectTimeout=10','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-o','LogLevel=ERROR',
        '-i',profile['privateKeyPath'],'-p',str(profile['port']),'-l',profile['username'],profile['host'],f'timeout --signal=TERM --kill-after=5s 45s {interpreter}']

running=set()
async def execute(owner,body):
    if owner in running: raise ValueError('An execution is already active')
    script,digest=review(owner,body.get('scriptId'))
    ids=body.get('deviceIds')
    allowed={row['id'] for row in devices(owner)['devices'] if row['registered']}
    if body.get('confirmed') is not True or body.get('contentHash')!=digest or not isinstance(ids,list) or not 1<=len(ids)<=5 or len(set(ids))!=len(ids) or any(value not in allowed for value in ids): raise ValueError('Review the saved version and registered targets')
    selected={profile['id']:profile for profile in profiles()}
    running.add(owner)
    results=[]
    try:
        for identifier in ids:
            profile=selected[identifier]
            process=await asyncio.create_subprocess_exec('ssh',*ssh_args(profile,script.get('language')),stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT,env={'PATH':os.defpath,'LANG':'C.UTF-8'})
            output=bytearray(); truncated=False; timed_out=False
            async def drain():
                nonlocal truncated
                while chunk:=await process.stdout.read(4096):
                    if len(output)+len(chunk)>65536: truncated=True
                    output.extend(chunk[:max(0,65536-len(output))])
            reader=asyncio.create_task(drain())
            async def feed_and_wait():
                process.stdin.write(script['content'].encode()); await process.stdin.drain(); process.stdin.close()
                await process.wait()
            try:
                await asyncio.wait_for(feed_and_wait(),70)
            except (TimeoutError,asyncio.CancelledError):
                timed_out=True
                if process.returncode is None: process.kill()
                await process.wait()
                if asyncio.current_task().cancelling(): raise
            finally:
                if process.returncode is None: process.kill(); await process.wait()
                await reader
            result={'deviceId':identifier,'deviceName':profile.get('name',identifier),'exitCode':process.returncode,
                    'output':output.decode(errors='replace'),'truncated':truncated,'timedOut':timed_out}
            results.append(result)
            with SessionLocal.begin() as db:
                outcome='success' if process.returncode==0 and not timed_out else 'failure'
                db.add(ProductivityEvent(id=str(uuid4()),owner=owner,action=f'execute.{outcome}',collection='scripts',record_ids=[script['id'],identifier]))
        return {'results':results}
    finally: running.discard(owner)

def history(owner):
    with SessionLocal() as db:
        return [{'id':row.id,'actor':owner,'created_at':row.created_at.isoformat(),'outcome':row.action.split('.')[-1],'metadata':{'scriptTitle':row.record_ids[0],'deviceName':row.record_ids[1]}}
            for row in db.query(ProductivityEvent).filter_by(owner=owner,collection='scripts').filter(ProductivityEvent.action.in_(['execute.success','execute.failure'])).order_by(ProductivityEvent.created_at.desc()).limit(30)]
