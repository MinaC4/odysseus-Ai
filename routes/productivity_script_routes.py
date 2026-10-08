from fastapi import APIRouter, Request, HTTPException
from src.agent_runtime.authority import is_internal_tool_request
from routes.productivity_routes import owner_for
from services import productivity_scripts as scripts

router=APIRouter(prefix='/api/productivity-scripts',tags=['productivity'])

async def execution_body(request):
    import json
    data=bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data)>8192:raise HTTPException(413,'Execution request exceeds its limit')
    body=json.loads(data)
    if not isinstance(body,dict):raise ValueError('Invalid request')
    return body

def human(request):
    owner=owner_for(request)
    manager=getattr(request.app.state,'auth_manager',None)
    if (is_internal_tool_request(request) or getattr(request.state,'api_token',False)
        or not manager or not manager.is_admin(owner)): raise HTTPException(403,'Human administrator only; the assistant cannot execute scripts')
    if request.method!='GET' and request.headers.get('origin')!=str(request.base_url).rstrip('/'):
        raise HTTPException(403,'Same-origin confirmation required')
    return owner

@router.get('/devices')
def devices(request:Request):
    try:return scripts.devices(human(request))
    except ValueError:raise HTTPException(503,'Provision SSH profiles with known hosts on the Odysseus server')

@router.put('/devices')
async def register(request:Request):
    owner=human(request)
    try:scripts.register(owner,(await execution_body(request)).get('deviceIds'));return {'ok':True}
    except (ValueError,AttributeError):raise HTTPException(400,'Use server-provisioned devices only')

@router.get('/review/{identifier}')
def review(identifier:str,request:Request):
    try:
        script,digest=scripts.review(human(request),identifier)
        return {'content':script['content'],'contentHash':digest}
    except ValueError:raise HTTPException(404,'Saved script unavailable')

@router.get('/runs')
def history(request:Request):return scripts.history(human(request))

@router.post('/run')
async def run(request:Request):
    owner=human(request)
    try:return await scripts.execute(owner,await execution_body(request))
    except (ValueError,TypeError,AttributeError):raise HTTPException(409,'Review the saved script and registered devices before execution')
    except OSError:raise HTTPException(503,'SSH execution could not start')
