import * as Modals from './modalManager.js';

const pages = [['day','Day Organizer'],['ideas','Idea Inbox'],['scripts','Scripts Library'],['learning','Learning'],['bookmarks','Bookmarks'],['files','File Sharing'],['launcher','Quick Launcher']];
const icons={day:'M8 2v4M16 2v4M3 10h18M5 4h14v17H5z',ideas:'M9 18h6M10 22h4M8 15a6 6 0 1 1 8 0l-1 3H9z',scripts:'m5 7 5 5-5 5M13 17h6',learning:'m2 9 10-5 10 5-10 5zM6 11v6l6 3 6-3v-6',bookmarks:'M6 3h12v18l-6-4-6 4z',files:'M3 7h7l2-3h9v16H3z'};
let mounted;
let activePage;
function fillWorkspace(modal) {
  modal.style.cssText='position:fixed;inset:0;padding:0;align-items:stretch;justify-content:stretch';
  const content=modal.querySelector('.modal-content');
  for(const [name,value] of Object.entries({width:'100vw',height:'100dvh','max-width':'none','max-height':'none',margin:'0','border-radius':'0',transform:'none',position:'relative',inset:'auto'}))content.style.setProperty(name,value,'important');
}
async function showProposals(modal) {
  let panel = modal.querySelector('[data-proposals]');
  if (!panel) { panel = document.createElement('section'); panel.dataset.proposals = ''; panel.style.cssText='padding:16px;max-height:40vh;overflow:auto;border-bottom:1px solid var(--border)'; modal.querySelector('nav').after(panel); }
  panel.replaceChildren();
  try {
    const response = await fetch('/api/productivity/proposals', {credentials:'same-origin'});
    if (!response.ok) throw new Error();
    const proposals = await response.json();
    if (!proposals.length) panel.textContent='No assistant changes awaiting your approval.';
    for (const proposal of proposals) {
      const card = document.createElement('article'); card.style.cssText='padding:12px;border:1px solid var(--border);margin-bottom:8px;border-radius:8px';
      const title=document.createElement('h3'); title.textContent=`${proposal.operation.action} · ${proposal.collection}`;
      const detail=document.createElement('pre'); detail.textContent=JSON.stringify(proposal.operation,null,2); detail.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto';
      card.append(title,detail);
      for (const [approve,label] of [[true,'Approve reviewed change'],[false,'Reject']]) {
        const button=document.createElement('button'); button.type='button'; button.className='btn-secondary'; button.textContent=label;
        button.onclick=async()=>{ button.disabled=true; try { const saved=await fetch(`/api/productivity/proposals/${encodeURIComponent(proposal.id)}/decision`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({approve})}); if(!saved.ok)throw new Error(); await showProposals(modal); mounted?.refresh(); } catch { button.disabled=false; button.textContent='Not applied; reload or request a fresh proposal'; } };
        card.append(button);
      }
      panel.append(card);
    }
  } catch { panel.textContent='Assistant changes could not be loaded. Retry when connected.'; }
}
async function openWorkspace(page) {
  activePage = page;
  let modal = document.getElementById('personal-workspace-modal');
  if (modal) { Modals.restore('personal-workspace-modal'); fillWorkspace(modal); mounted?.select(page); return; }
  modal = document.createElement('div'); modal.id = 'personal-workspace-modal'; modal.className = 'modal';
  modal.innerHTML = '<div class="modal-content" style="display:flex;flex-direction:column;overflow:hidden"><div class="modal-header"><h2>Personal workspace</h2><div><button type="button" data-minimize aria-label="Minimize workspace">−</button><button type="button" data-close aria-label="Close workspace">×</button></div></div><nav aria-label="Personal tools" style="display:flex;gap:6px;padding:12px;overflow:auto;flex-shrink:0"></nav><div id="personal-workspace-host" role="region" aria-label="Personal workspace content" tabindex="0" style="flex:1;min-height:0;overflow:auto;overscroll-behavior:contain"></div></div>';
  const nav = modal.querySelector('nav');
  for (const [key,label] of pages) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.className = 'btn-secondary'; button.onclick = () => { activePage = key; mounted?.select(key); }; nav.append(button); }
  const review=document.createElement('button'); review.type='button'; review.className='btn-secondary'; review.textContent='Review assistant changes'; review.onclick=()=>showProposals(modal); nav.append(review);
  const backup=document.createElement('a'); backup.href='/api/productivity/export'; backup.textContent='Export workspace backup'; backup.className='btn-secondary';backup.style.cssText='color:var(--fg);text-decoration:none;padding:6px 10px;border:1px solid var(--border);border-radius:4px';nav.append(backup);
  document.body.append(modal);
  Modals.register('personal-workspace-modal', { label:'Personal workspace', sidebarBtnId:pages.map(([key])=>`tool-personal-${key}`), restoreFn:()=>{fillWorkspace(modal);mounted?.select(activePage);}, closeFn:()=>{ mounted?.close(); mounted = null; modal.remove(); } });
  fillWorkspace(modal);
  modal.querySelector('[data-minimize]').onclick = () => Modals.minimize('personal-workspace-modal');
  modal.querySelector('[data-close]').onclick = () => Modals.close('personal-workspace-modal');
  try {
    const {mountWorkspace} = await import('/static/productivity/workspace.js');
    if (modal.isConnected) mounted = mountWorkspace(modal.querySelector('#personal-workspace-host'), activePage);
  } catch { const error = document.createElement('p'); error.setAttribute('role','alert'); error.textContent = 'Personal workspace could not load. Reload and try again.'; modal.querySelector('#personal-workspace-host').append(error); }
}
const section = document.querySelector('#tools-section');
window.addEventListener('odysseus:open-productivity',event=>{ if(pages.some(([key])=>key===event.detail?.page))void openWorkspace(event.detail.page); });
async function registerWorkspaceTools() {
const response=await fetch('/api/productivity/status',{credentials:'same-origin'});
if(!response.ok || !(await response.json()).ready)return;
if (section) for (const [page,label] of pages) {
  const button = document.createElement('button'); button.type = 'button'; button.id = `tool-personal-${page}`;
  button.className = 'list-item'; button.style.cssText = 'width:100%;text-align:left;background:none;border:0;color:inherit';
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg'); icon.setAttribute('viewBox','0 0 24 24'); icon.setAttribute('width','14'); icon.setAttribute('height','14'); icon.setAttribute('fill','none'); icon.setAttribute('stroke','currentColor'); icon.setAttribute('stroke-width','1.6'); icon.setAttribute('aria-hidden','true');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',icons[page] || 'M12 3l8 8-8 10-8-10z');icon.append(path);
  const text=document.createElement('span');text.className='grow';text.textContent=label;button.append(icon,text);
  button.onclick = () => openWorkspace(page); section.append(button);
}
const requested=new URL(location.href).searchParams.get('personal_tool');
if(pages.some(([page])=>page===requested))void openWorkspace(requested);
}
void registerWorkspaceTools().catch(()=>{});
