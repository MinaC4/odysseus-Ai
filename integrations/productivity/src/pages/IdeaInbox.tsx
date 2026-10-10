import { isWorkspaceShortcutBlocked } from "@/lib/dom";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, Check, ExternalLink, LayoutGrid, Lightbulb, List, Plus, Rocket, Search, Trash2, X, BarChart3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatRelative } from '@/lib/utils';
import { PageContainer } from '@/components/PageLayout';
import { HudModal } from '@/components/HudModal';
import './IdeaInbox.css';

export interface Idea { id: string; title: string; description: string | null; status: string; priority: string; tags: string[]; link: string | null; created_at: string; updated_at: string; sort_order: number }
interface Project { id: string; name: string }
const statuses = ['new', 'reviewed', 'promoted', 'archived'];
const labels: Record<string, string> = { new: 'Inbox', reviewed: 'Reviewed', promoted: 'Promoted', archived: 'Archived' };
const priorities = ['critical', 'high', 'medium', 'low'];
export const ideaTags = (text: string) => [...new Set(text.split(',').map(tag => tag.trim()).filter(Boolean))];
export function safeIdeaLink(value: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function filterIdeas(ideas: Idea[], search: string, status: string, priority: string, tag: string) {
  const query = search.trim().toLowerCase();
  return ideas.filter(idea => (status === 'all' || (status === 'active' ? idea.status !== 'archived' : idea.status === status))
    && (priority === 'all' || idea.priority === priority) && (!tag || (idea.tags ?? []).includes(tag))
    && (!query || [idea.title, idea.description, idea.link, ...(idea.tags ?? [])].some(value => value?.toLowerCase().includes(query))));
}
const emptyDraft = { title: '', description: '', status: 'new', priority: 'medium', tags: '', link: '' };
type Draft = typeof emptyDraft;

export function IdeaInbox() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('list');
  const [scope, setScope] = useState('active');
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('all');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('manual');
  const [quickTitle, setQuickTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [promoting, setPromoting] = useState<Idea | null>(null);
  const [projectId, setProjectId] = useState('');
  const [pendingTask, setPendingTask] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [result, projectResult] = await Promise.all([supabase.from('ideas').select('*').order('sort_order').order('created_at', { ascending: false }), supabase.from('projects').select('id,name').order('name')]);
      if (result.error) throw result.error;
      setIdeas((result.data ?? []) as Idea[]);
      if (projectResult.error) { setProjects([]); setNotice('Engineering projects are unavailable. Your ideas remain saved and editable.'); return; }
      setProjects((projectResult.data ?? []) as Project[]);
    } catch (failure) { setError((failure as { message?: string }).message ?? 'Could not load ideas. Please retry.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || isWorkspaceShortcutBlocked(event)) return;
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); captureRef.current?.focus(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try { await action(); return true; }
    catch (failure) { setError((failure as { message?: string }).message ?? 'Could not save. Your changes have been kept; please retry.'); return false; }
    finally { setBusy(false); }
  };
  const update = async (ids: string[], values: Partial<Idea>) => {
    const { data, error: failure } = await supabase.from('ideas').update({ ...values, updated_at: new Date().toISOString() }).in('id', ids).select();
    if (failure) throw failure;
    if (!data || data.length !== ids.length) throw new Error('Some ideas could not be updated. Reload and try again.');
    setIdeas(previous => previous.map(idea => (data as Idea[]).find(row => row.id === idea.id) ?? idea));
  };
  const openEditor = (idea?: Idea) => {
    setError(''); setEditing(idea?.id ?? null);
    setDraft(idea ? { title: idea.title, description: idea.description ?? '', status: idea.status, priority: idea.priority, tags: (idea.tags ?? []).join(', '), link: idea.link ?? '' } : { ...emptyDraft, title: quickTitle });
  };
  const save = async (values: Draft, id: string | null) => {
    if (!values.title.trim()) { setError('Give your idea a title.'); return false; }
    if (values.link.trim() && !safeIdeaLink(values.link.trim())) { setError('Use a complete http:// or https:// reference link.'); return false; }
    return run(async () => {
      const patch = { title: values.title.trim(), description: values.description.trim() || null, status: values.status, priority: values.priority, tags: ideaTags(values.tags), link: values.link.trim() || null };
      if (id) await update([id], patch);
      else {
        const { data, error: failure } = await supabase.from('ideas').insert({ ...patch, sort_order: Math.min(0, ...ideas.map(idea => idea.sort_order ?? 0)) - 1 }).select().single();
        if (failure) throw failure;
        if (!data) throw new Error('The idea was not saved. Please retry.');
        setIdeas(previous => [data as Idea, ...previous]); setQuickTitle('');
      }
      setNotice(id ? 'Idea updated.' : 'Idea captured. Ready when you are.');
    });
  };
  const tags = useMemo(() => [...new Set(ideas.flatMap(idea => idea.tags ?? []))].sort(), [ideas]);
  const filtered = useMemo(() => filterIdeas(ideas, search, scope, priority, tag).sort((a, b) => {
    if (sort === 'priority') return priorities.indexOf(a.priority) - priorities.indexOf(b.priority) || b.created_at.localeCompare(a.created_at);
    if (sort === 'newest') return b.created_at.localeCompare(a.created_at);
    if (sort === 'oldest') return a.created_at.localeCompare(b.created_at);
    return (a.sort_order ?? 0) - (b.sort_order ?? 0) || b.created_at.localeCompare(a.created_at);
  }), [ideas, search, scope, priority, tag, sort]);
  useEffect(() => { setSelected([]); }, [scope, search, priority, tag, view]);
  const counts = Object.fromEntries(statuses.map(status => [status, ideas.filter(idea => idea.status === status).length]));
  const resetFilters = () => { setSearch(''); setPriority('all'); setTag(''); setScope('active'); };
  const reorder = async (id: string, targetId: string) => {
    if (id === targetId || sort !== 'manual') return;
    const order = [...ideas].sort((a, b) => a.sort_order - b.sort_order);
    const from = order.findIndex(idea => idea.id === id), to = order.findIndex(idea => idea.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = order.splice(from, 1); order.splice(to, 0, moved);
    await run(async () => { for (let index = 0; index < order.length; index++) if (order[index].sort_order !== index) await update([order[index].id], { sort_order: index }); setNotice('Idea order saved.'); });
  };
  const changeStatus = (ids: string[], status: string) => void run(async () => { await update(ids, { status }); setSelected([]); setNotice(ids.length + ' ideas moved to ' + labels[status].toLowerCase() + '.'); });
  const promote = async (withTask: boolean) => {
    if (!promoting || (withTask && !projectId)) return;
    await run(async () => {
      let taskId = pendingTask;
      if (withTask && !taskId) {
        const { data, error: failure } = await supabase.from('tasks').insert({ project_id: projectId, title: promoting.title, status: 'todo', priority: promoting.priority }).select('id').single();
        if (failure) throw failure;
        if (!data) throw new Error('The task was not created. Please retry.');
        taskId = data.id; setPendingTask(taskId);
      }
      try { await update([promoting.id], { status: 'promoted' }); }
      catch (failure) { if (taskId) throw new Error('Task created, but the idea could not be marked promoted. Retry here to finish without creating another task.'); throw failure; }
      setPromoting(null); setPendingTask(null); setNotice(taskId ? 'Project task created. Original idea and notes retained.' : 'Idea marked promoted.');
    });
  };
  const card = (idea: Idea, board = false) => {
    const index = filtered.findIndex(item => item.id === idea.id);
    return <article key={idea.id} className={'idea-record ' + (board ? 'idea-record-card' : '') + (selected.includes(idea.id) ? ' is-selected' : '')}
      draggable={!busy && sort === 'manual'} onDragStart={event => { setDragId(idea.id); event.dataTransfer.setData('text/plain', idea.id); }} onDragEnd={() => setDragId(null)}
      onDragOver={event => { if (dragId) event.preventDefault(); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); if (dragId) void reorder(dragId, idea.id); setDragId(null); }}>
      <input aria-label={'Select ' + idea.title} type="checkbox" checked={selected.includes(idea.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, idea.id] : previous.filter(id => id !== idea.id))} />
      <button className="idea-record-main" onClick={() => openEditor(idea)}><span className="idea-record-title">{idea.title}</span>{idea.description && <span className="idea-record-description">{idea.description}</span>}<span className="idea-tags">{(idea.tags ?? []).slice(0, 4).map(value => <span key={value}>{value}</span>)}{idea.tags?.length > 4 && <span>+{idea.tags.length - 4}</span>}</span></button>
      <div className="idea-record-meta"><span className={'idea-priority priority-' + idea.priority}>{idea.priority}</span>{!board && <span className={'idea-status status-' + idea.status}>{labels[idea.status] ?? idea.status}</span>}<time title={new Date(idea.created_at).toLocaleString()}>{formatRelative(idea.created_at)}</time></div>
      <div className="idea-record-actions">{safeIdeaLink(idea.link) && <a href={safeIdeaLink(idea.link)!} target="_blank" rel="noopener noreferrer" aria-label={'Open reference for ' + idea.title}><ExternalLink size={15} /></a>}{sort === 'manual' && <><button disabled={busy || index === 0} aria-label={'Move ' + idea.title + ' up'} onClick={() => void reorder(idea.id, filtered[index - 1].id)}><ArrowUp size={14} /></button><button disabled={busy || index === filtered.length - 1} aria-label={'Move ' + idea.title + ' down'} onClick={() => void reorder(idea.id, filtered[index + 1].id)}><ArrowDown size={14} /></button></>}</div>
    </article>;
  };
  return <PageContainer className="idea-workspace">
    <header className="idea-heading"><div><span className="idea-eyebrow"><Lightbulb size={15} /> THINKING SPACE</span><h1>Idea inbox</h1><p>A place for possibilities, before they become commitments.</p></div><button className="idea-button idea-button-primary" onClick={() => openEditor()}><Plus size={17} /> New idea</button></header>
    <div className="idea-capture"><Lightbulb size={21} /><form onSubmit={async event => { event.preventDefault(); await save({ ...emptyDraft, title: quickTitle }, null); }}><input ref={captureRef} aria-label="Capture an idea" value={quickTitle} onChange={event => setQuickTitle(event.target.value)} placeholder="What's on your mind? A title is enough to start." maxLength={500} disabled={busy} /><button className="idea-button idea-button-primary" disabled={busy || !quickTitle.trim()} type="submit"><Plus size={15} /> Capture</button></form><button className="idea-capture-details" onClick={() => openEditor()}>Add details</button></div>
    {error && <div className="idea-feedback idea-error" role="alert">{error}<button onClick={() => void load()} disabled={busy || loading}>Reload</button></div>}
    {notice && <div className="idea-feedback" role="status"><Check size={15} />{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
    <div className="idea-layout"><aside className="idea-sidebar"><span className="idea-section-label">YOUR IDEAS</span>{['active', ...statuses, 'all'].map(value => <button key={value} aria-pressed={scope === value} className={scope === value ? 'active' : ''} onClick={() => setScope(value)}><span>{value === 'active' ? 'All active' : value === 'all' ? 'Everything' : labels[value]}</span><span>{value === 'active' ? ideas.length - counts.archived : value === 'all' ? ideas.length : counts[value]}</span></button>)}<div className="idea-sidebar-rule" /><span className="idea-section-label">COLLECTIONS</span>{tags.length ? tags.map(value => <button key={value} className={tag === value ? 'active' : ''} aria-pressed={tag === value} onClick={() => setTag(tag === value ? '' : value)}><span className="truncate"># {value}</span><span>{ideas.filter(idea => idea.tags?.includes(value)).length}</span></button>) : <p className="idea-sidebar-help">Add tags to an idea to build your collections.</p>}<div className="idea-sidebar-help">Shortcuts <kbd>N</kbd> capture · <kbd>/</kbd> search</div></aside>
    <main className="idea-content"><div className="idea-content-heading"><div><h2>{tag ? '# ' + tag : scope === 'active' ? 'All active ideas' : scope === 'all' ? 'Everything' : labels[scope]}</h2><p>{scope === 'new' ? 'Review the raw thoughts. Keep the ones worth exploring.' : scope === 'archived' ? 'Set aside for now. You can bring any idea back.' : 'Capture now. Shape what comes next.'}</p></div><div className="idea-view-switch">{[{ id: 'list', label: 'List', icon: List }, { id: 'board', label: 'Board', icon: LayoutGrid }, { id: 'insights', label: 'Insights', icon: BarChart3 }].map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={view === id} aria-label={label + ' view'} onClick={() => setView(id)}><Icon size={16} /><span>{label}</span></button>)}</div></div>
      <div className="idea-toolbar"><label className="idea-search"><Search size={16} /><input ref={searchRef} aria-label="Search ideas" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search titles, notes, tags, links…" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label><select aria-label="Filter priority" value={priority} onChange={event => setPriority(event.target.value)}><option value="all">All priorities</option>{priorities.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Sort ideas" value={sort} onChange={event => setSort(event.target.value)}><option value="manual">Manual order</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="priority">Priority first</option></select></div>
      {(tag || search || priority !== 'all') && <div className="idea-filter-summary">{filtered.length} matching ideas<button onClick={resetFilters}>Clear filters</button></div>}
      {selected.length > 0 && <div className="idea-selection"><span>{selected.length} selected</span><button disabled={busy} onClick={() => changeStatus(selected, 'reviewed')}><Check size={14} /> Review</button><button disabled={busy} onClick={() => changeStatus(selected, 'archived')}><Archive size={14} /> Archive</button><button disabled={busy} onClick={() => setDeleting(selected)}><Trash2 size={14} /> Delete</button><button aria-label="Clear selection" onClick={() => setSelected([])}><X size={14} /></button></div>}
      {loading ? <div className="idea-empty" role="status">Loading your ideas…</div> : view === 'insights' ? <div className="idea-insights"><div className="idea-insight-lead"><span className="idea-section-label">YOUR THINKING, AT A GLANCE</span><h3>{filtered.length}<span>ideas in this view</span></h3><p>Turn a possibility into a clear next step.</p></div>{statuses.map(status => { const count = filtered.filter(idea => idea.status === status).length; return <button key={status} className="idea-insight-item" onClick={() => { setScope(status); setView('list'); }}><span>{labels[status]}</span><strong>{count}</strong><div className="idea-meter"><span style={{ width: (filtered.length ? count / filtered.length * 100 : 0) + '%' }} /></div><small>{status === 'new' ? 'Waiting for a first look' : status === 'reviewed' ? 'Ready to explore' : status === 'promoted' ? 'Moved toward execution' : 'Saved for another time'}</small></button>; })}</div>
      : filtered.length === 0 ? <div className="idea-empty"><Lightbulb size={35} /><h3>{ideas.length ? 'No ideas in this view' : 'Good ideas start as small thoughts.'}</h3><p>{ideas.length ? 'Try another collection or clear your filters.' : 'Capture a thought above. Add context and decide what to pursue when you are ready.'}</p><button className="idea-button" onClick={ideas.length ? resetFilters : () => captureRef.current?.focus()}>{ideas.length ? 'Show active ideas' : 'Capture your first idea'}</button></div>
      : view === 'list' ? <div className="idea-list"><div className="idea-list-caption"><label><input type="checkbox" aria-label="Select all visible ideas" checked={filtered.length > 0 && filtered.every(idea => selected.includes(idea.id))} onChange={event => setSelected(event.target.checked ? filtered.map(idea => idea.id) : [])} />{filtered.length} ideas</label><span>Open an idea to review or develop it</span></div>{filtered.map(idea => card(idea))}</div>
      : <div className="idea-board">{statuses.filter(status => scope === 'all' || scope === 'active' && status !== 'archived' || scope === status).map(status => <section key={status} className={'idea-lane lane-' + status} onDragOver={event => { if (dragId) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (dragId) changeStatus([dragId], status); setDragId(null); }}><header><span>{labels[status]}</span><span>{filtered.filter(idea => idea.status === status).length}</span></header>{filtered.filter(idea => idea.status === status).map(idea => card(idea, true))}<button className="idea-lane-add" onClick={() => { openEditor(); setDraft({ ...emptyDraft, status }); }}><Plus size={14} /> Add idea</button></section>)}</div>}
    </main></div>
    <HudModal open={editing !== undefined} onClose={() => { if (!busy) setEditing(undefined); }} title={editing ? 'Develop your idea' : 'Capture an idea'} className="idea-dialog">
      <form onSubmit={async event => { event.preventDefault(); if (await save(draft, editing ?? null)) setEditing(undefined); }}><label>Title<input autoFocus required maxLength={500} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="A thought worth keeping" /></label><label>Notes<textarea rows={6} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder="What is the opportunity? Why does it matter? What would a first step look like?" /></label><div className="idea-form-pair"><label>Status<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}>{statuses.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label><label>Priority<select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value })}>{priorities.map(value => <option key={value}>{value}</option>)}</select></label></div><label>Collections / tags<input value={draft.tags} onChange={event => setDraft({ ...draft, tags: event.target.value })} placeholder="Product, research, someday (separate with commas)" list="idea-existing-tags" /><datalist id="idea-existing-tags">{tags.map(value => <option key={value} value={value} />)}</datalist></label><label>Reference link<input type="url" value={draft.link} onChange={event => setDraft({ ...draft, link: event.target.value })} placeholder="https://…" /></label>{error && <p className="idea-form-error" role="alert">{error}</p>}{editing && <div className="idea-detail-tools"><button type="button" disabled={busy || draft.status === 'promoted'} onClick={async () => { if (await save(draft, editing)) { const idea = ideas.find(item => item.id === editing)!; setEditing(undefined); setPromoting({ ...idea, title: draft.title.trim(), priority: draft.priority }); setProjectId(projects[0]?.id ?? ''); } }}><Rocket size={15} /> Create project task</button><button type="button" disabled={busy} onClick={() => setDeleting([editing])}><Trash2 size={15} /> Delete</button></div>}<div className="idea-form-footer"><button type="button" className="idea-button" disabled={busy} onClick={() => setEditing(undefined)}>Cancel</button><button className="idea-button idea-button-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Capture idea'}</button></div></form>
    </HudModal>
    <HudModal open={!!promoting} onClose={() => { if (!busy && !pendingTask) setPromoting(null); }} title="Move from idea to action" className="idea-dialog"><h3>{promoting?.title}</h3><p className="idea-modal-copy">Create a task in an existing project. Your original idea and notes stay in the inbox.</p>{pendingTask ? <p className="idea-modal-copy">Task created. Finish marking this idea promoted below.</p> : <label>Project<select value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Choose a project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}{!projects.length && <p className="idea-modal-copy">Create a project first to turn this idea into a task, or mark it promoted below.</p>}{error && <p className="idea-form-error" role="alert">{error}</p>}<div className="idea-form-footer"><button className="idea-button" disabled={busy} onClick={() => void promote(false)}>{pendingTask ? 'Finish promotion' : 'Mark promoted only'}</button><button className="idea-button idea-button-primary" disabled={busy || !projectId || !!pendingTask} onClick={() => void promote(true)}>{busy ? 'Working…' : 'Create project task'}</button></div></HudModal>
    <HudModal open={deleting.length > 0} onClose={() => { if (!busy) setDeleting([]); }} title="Delete ideas?" className="idea-dialog"><p className="idea-modal-copy">Permanently delete {deleting.length} idea{deleting.length === 1 ? '' : 's'} and their notes? Archive instead to keep them for later.</p>{error && <p className="idea-form-error" role="alert">{error}</p>}<div className="idea-form-footer"><button className="idea-button" disabled={busy} onClick={() => setDeleting([])}>Keep ideas</button><button className="idea-button idea-button-danger" disabled={busy} onClick={() => void run(async () => { const { data, error: failure } = await supabase.from('ideas').delete().in('id', deleting).select('id'); if (failure) throw failure; if (data?.length !== deleting.length) throw new Error('Some ideas could not be deleted. Reload and try again.'); setIdeas(previous => previous.filter(idea => !deleting.includes(idea.id))); if (editing && deleting.includes(editing)) setEditing(undefined); setSelected([]); setDeleting([]); setNotice('Ideas deleted.'); })}>{busy ? 'Deleting…' : 'Delete permanently'}</button></div></HudModal>
  </PageContainer>;
}
