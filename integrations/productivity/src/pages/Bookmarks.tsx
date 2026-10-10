import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { isWorkspaceShortcutBlocked } from '@/lib/dom';
import { Bookmark as BookmarkIcon, Plus, Search, LayoutGrid, List, Pin, ExternalLink, Pencil, Trash2, Copy, Download, Upload, Folder, X, ArrowUpRight, ChevronLeft, ChevronRight, MoreHorizontal, CheckSquare, Square, Layers, FileDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PageContainer, LoadingState, ErrorState } from '@/components/PageLayout';
import { HudButton } from '@/components/HudButton';
import { HudInput, HudTextarea } from '@/components/HudInputs';
import { HudModal } from '@/components/HudModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { normalizeBookmarkUrl } from '@/components/bookmarks/bookmark-url';
import './bookmarks.css';

interface Bookmark { id: string; title: string; url: string; description: string | null; category: string; tags: string[]; pinned: boolean; created_at: string; sort_order: number }
interface Draft { title: string; url: string; description: string; category: string; tags: string }
const blank: Draft = { title: '', url: '', description: '', category: 'General', tags: '' };
const fields = 'id,title,url,description,category,tags,pinned,created_at,sort_order';

function safeUrl(raw: string) { try { return normalizeBookmarkUrl(raw); } catch { return null; } }
function normalizeRecord(item: Bookmark): Bookmark { return { ...item, category: item.category || 'General', tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : [] }; }

function BookmarkLogo({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const href = safeUrl(url);
  const iconUrl = href ? new URL('/favicon.ico', href).href : '';
  return <div className="bookmark-record-symbol" aria-hidden="true">
    {iconUrl && !failed ? <img src={iconUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span>{title.trim().slice(0, 2).toUpperCase()}</span>}
  </div>;
}

export function Bookmarks() {
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const [pinned, setPinned] = useState(false);
  const [sort, setSort] = useState('pinned');
  const [view, setView] = useState<'grid' | 'list'>('list');
  const [page, setPage] = useState(0);
  const deferredSearch = useDeferredValue(search);
  const [selected, setSelected] = useState<Bookmark | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState('');
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const loadController = useRef<AbortController | null>(null);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Bookmark[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true); setError('');
    try {
      const { data, error: failure } = await supabase.from('bookmarks').select(fields).order('sort_order').order('created_at', { ascending: false }).abortSignal(controller.signal);
      if (controller.signal.aborted) return;
      if (failure) throw failure;
      setItems(((data ?? []) as Bookmark[]).map(normalizeRecord));
    } catch { if (!controller.signal.aborted) setError('Your library could not be loaded. Check your connection and try again.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => loadController.current?.abort(); }, [load]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { setPage(0); }, [deferredSearch, category, tag, pinned, sort]);
  const openAdd = useCallback(() => { setEditing(null); setDraft(blank); setFormError(''); setModal(true); }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || modal || deleting || selected || event.ctrlKey || event.metaKey || event.altKey || isWorkspaceShortcutBlocked(event)) return;
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); openAdd(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [modal, deleting, selected, openAdd]);
  const library = useMemo(() => {
    const counts = new Map<string, number>();
    const tagSet = new Set<string>();
    let pinCount = 0;
    const records = items.map(item => {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
      item.tags.forEach(value => tagSet.add(value));
      if (item.pinned) pinCount++;
      const href = safeUrl(item.url);
      return { ...item, href, host: href ? new URL(href).host.replace(/^www\./, '') : 'Invalid saved address', searchText: `${item.title} ${item.url} ${item.description ?? ''} ${item.category} ${item.tags.join(' ')}`.toLowerCase() };
    });
    return { records, counts, pinCount, categories: [...counts.keys()].sort(), tags: [...tagSet].sort() };
  }, [items]);
  const categories = library.categories;
  const tags = library.tags;
  const filtered = useMemo(() => {
    const terms = deferredSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return library.records.filter(item => (!category || item.category === category) && (!tag || item.tags.includes(tag)) && (!pinned || item.pinned) && terms.every(term => item.searchText.includes(term)))
      .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'oldest' ? a.created_at.localeCompare(b.created_at) : sort === 'newest' ? b.created_at.localeCompare(a.created_at) : Number(b.pinned) - Number(a.pinned) || a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at));
  }, [library.records, deferredSearch, category, tag, pinned, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 24));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * 24, (currentPage + 1) * 24);
  const selectedRecords = items.filter(item => selectedIds.has(item.id));
  const visibleSelected = visible.length > 0 && visible.every(item => selectedIds.has(item.id));
  const openEdit = (item: Bookmark) => {
    setSelected(null); setEditing(item);
    setDraft({ title: item.title, url: item.url, description: item.description ?? '', category: item.category, tags: item.tags.join(', ') });
    setFormError(''); setModal(true);
  };
  const clearFilters = () => { setSearch(''); setCategory(''); setTag(''); setPinned(false); };
  const save = async () => {
    if (busy) return;
    setFormError('');
    let url: string;
    try { url = normalizeBookmarkUrl(draft.url); } catch (failure) { setFormError(failure instanceof Error ? failure.message : 'Invalid address.'); return; }
    if (!draft.title.trim()) { setFormError('Give your bookmark a title.'); return; }
    if (items.some(item => item.id !== editing?.id && safeUrl(item.url) === url)) { setFormError('This address is already in your library. Search for it to edit the existing bookmark.'); return; }
    const payload = { title: draft.title.trim(), url, description: draft.description.trim() || null, category: draft.category.trim() || 'General', tags: [...new Set(draft.tags.split(',').map(value => value.trim()).filter(Boolean))] };
    setBusy(true);
    try {
      const request = editing ? supabase.from('bookmarks').update(payload).eq('id', editing.id) : supabase.from('bookmarks').insert({ ...payload, sort_order: Math.min(0, ...items.map(item => item.sort_order || 0)) - 1 });
      const { data, error: failure } = await request.select(fields).single();
      if (failure || !data) throw failure;
      const saved = normalizeRecord(data as Bookmark);
      setItems(previous => editing ? previous.map(item => item.id === saved.id ? saved : item) : [saved, ...previous]);
      setModal(false); setNotice(editing ? 'Bookmark updated.' : 'Bookmark saved.');
    } catch { setFormError('Unable to save. Your changes are still here; try again.'); }
    finally { setBusy(false); }
  };
  const togglePin = async (item: Bookmark) => {
    if (pendingRef.current.has(item.id)) return;
    pendingRef.current.add(item.id); setPendingIds(new Set(pendingRef.current));
    try { const { error: failure } = await supabase.from('bookmarks').update({ pinned: !item.pinned }).eq('id', item.id); if (failure) throw failure;
      setItems(previous => previous.map(value => value.id === item.id ? { ...value, pinned: !item.pinned } : value));
      setNotice(item.pinned ? 'Bookmark unpinned.' : 'Bookmark pinned.');
      setSelected(previous => previous?.id === item.id ? { ...previous, pinned: !item.pinned } : previous);
    } catch { setNotice('Could not update pin. Try again.'); } finally { pendingRef.current.delete(item.id); setPendingIds(new Set(pendingRef.current)); }
  };
  const toggleSelection = (id: string) => setSelectedIds(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const runBulkPin = async () => {
    const targets = selectedRecords.filter(item => !item.pinned);
    if (!targets.length) { setNotice('All selected links are already pinned.'); return; }
    setBusy(true);
    try {
      const { error: failure } = await supabase.from('bookmarks').update({ pinned: true }).in('id', targets.map(item => item.id));
      if (failure) throw failure;
      setItems(previous => previous.map(item => selectedIds.has(item.id) ? { ...item, pinned: true } : item));
      setNotice(`${targets.length} link${targets.length === 1 ? '' : 's'} pinned.`);
    } catch { setNotice('Could not pin the selected links. Try again.'); }
    finally { setBusy(false); }
  };
  const runBulkMove = async () => {
    if (!moveTarget || !selectedRecords.length) return;
    setBusy(true);
    try {
      const { error: failure } = await supabase.from('bookmarks').update({ category: moveTarget }).in('id', [...selectedIds]);
      if (failure) throw failure;
      setItems(previous => previous.map(item => selectedIds.has(item.id) ? { ...item, category: moveTarget } : item));
      setNotice(`${selectedRecords.length} link${selectedRecords.length === 1 ? '' : 's'} moved to ${moveTarget}.`);
      setSelectedIds(new Set()); setMoveTarget('');
    } catch { setNotice('Could not move the selected links. Try again.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleting) return;
    const ids = deleting.map(item => item.id);
    try { const { error: failure } = await supabase.from('bookmarks').delete().in('id', ids); if (failure) throw failure;
      setItems(previous => previous.filter(item => !ids.includes(item.id)));
      setSelectedIds(previous => new Set([...previous].filter(id => !ids.includes(id))));
      setDeleting(null); setNotice(`${ids.length} bookmark${ids.length === 1 ? '' : 's'} deleted.`);
    } catch { setNotice('Could not delete bookmark. Try again.'); }
  };
  const exportLibrary = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `hephastos-bookmarks-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportSelected = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(selectedRecords, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `hephastos-bookmarks-selected-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copyUrl = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setNotice('Link copied.'); }
    catch { setNotice('Clipboard unavailable. Open Edit to copy the address.'); }
  };
  const importLibrary = async (file: File) => {
    setBusy(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose a JSON or HTML file smaller than 5 MB.');
      const content = await file.text();
      let parsed: unknown;
      if (/\.html?$/i.test(file.name) || file.type === 'text/html') {
        const document = new DOMParser().parseFromString(content, 'text/html');
        parsed = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).slice(0, 1001).map(anchor => {
          const folderList = anchor.closest('dl');
          const folder = folderList?.parentElement?.querySelector(':scope > h3')?.textContent?.trim();
          return { title: anchor.textContent?.trim() || new URL(anchor.href).hostname, url: anchor.href, category: folder || 'Imported', description: null, tags: [], pinned: false };
        });
      } else parsed = JSON.parse(content);
      if (!Array.isArray(parsed) || parsed.length > 1000) throw new Error('Import expects an array of up to 1,000 bookmarks.');
      const known = new Set(items.map(item => safeUrl(item.url)).filter(Boolean));
      let skipped = 0;
      const payloads = parsed.flatMap((raw: unknown) => {
        if (!raw || typeof raw !== 'object') throw new Error('Every imported bookmark needs a title and valid web address.');
        const item = raw as Record<string, unknown>;
        if (typeof item.title !== 'string' || !item.title.trim() || typeof item.url !== 'string') throw new Error('Every imported bookmark needs a title and valid web address.');
        const url = normalizeBookmarkUrl(item.url);
        if (known.has(url)) { skipped++; return []; } known.add(url);
        return [{ title: item.title.trim(), url, description: typeof item.description === 'string' ? item.description : null, category: typeof item.category === 'string' && item.category.trim() ? item.category.trim() : 'General', tags: Array.isArray(item.tags) ? [...new Set(item.tags.filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(Boolean))] : [], pinned: item.pinned === true }];
      });
      if (payloads.length) { const { data, error: failure } = await supabase.from('bookmarks').insert(payloads).select(fields); if (failure) throw new Error('Import failed. Please try again.'); setItems(previous => [...((data ?? []) as Bookmark[]).map(normalizeRecord), ...previous]); }
      setNotice(`${payloads.length} imported${skipped ? ` · ${skipped} duplicate addresses skipped` : ''}.`);
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : 'Unable to import bookmarks.'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  return (
    <PageContainer className="bookmark-page">
      <header className="bookmark-hero">
        <div>
          <div className="bookmark-eyebrow"><BookmarkIcon size={14} /> PERSONAL REFERENCE LIBRARY</div>
          <h1>Keep your best links<br /><span>within reach.</span></h1>
          <p>Tools, reading and references. Collected with intention.</p>
        </div>
        <div className="bookmark-hero-side">
          <HudButton onClick={openAdd}><Plus size={16} className="mr-2 inline" />Save a link</HudButton>
          <div className="bookmark-transfer">
            <button onClick={() => fileRef.current?.click()} disabled={busy || loading}><Upload size={13} />{busy ? 'Working…' : 'Import JSON / HTML'}</button>
            <button onClick={exportLibrary} disabled={!items.length}><Download size={13} />Export library</button>
          </div>
        </div>
      </header>

      <input ref={fileRef} type="file" accept=".json,application/json,.html,text/html" className="hidden" aria-label="Import bookmarks JSON or browser HTML export" onChange={event => { const file = event.target.files?.[0]; if (file) void importLibrary(file); }} />
      {notice && <div role="status" className="bookmark-notice">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}

      <div className="bookmark-workspace">
        <aside className="bookmark-navigation" aria-label="Bookmark collections">
          <div className="bookmark-section-label">YOUR LIBRARY</div>
          <button className={`bookmark-nav-item ${!pinned && !category ? 'is-active' : ''}`} aria-pressed={!pinned && !category} onClick={() => { setPinned(false); setCategory(''); }}>
            <BookmarkIcon size={16} /><span>All links</span><b>{items.length}</b>
          </button>
          <button className={`bookmark-nav-item ${pinned ? 'is-active' : ''}`} aria-pressed={pinned} onClick={() => setPinned(value => !value)}>
            <Pin size={16} /><span>Pinned</span><b>{library.pinCount}</b>
          </button>
          <div className="bookmark-collections">
            <div className="bookmark-section-label">COLLECTIONS <span>{categories.length}</span></div>
            <div className="bookmark-collection-scroll">
              {categories.map((value, index) => (
                <button key={value} className={`bookmark-nav-item ${category === value ? 'is-active' : ''}`} aria-pressed={category === value} onClick={() => setCategory(category === value ? '' : value)}>
                  <span className="bookmark-collection-mark" style={{ '--collection-hue': `${175 + (index * 37) % 150}` } as React.CSSProperties}><Folder size={14} /></span>
                  <span>{value}</span><b>{library.counts.get(value)}</b>
                </button>
              ))}
            </div>
            {!categories.length && <p className="bookmark-nav-empty">Add a collection when you save your first link.</p>}
          </div>
          <div className="bookmark-shortcuts"><span><kbd>/</kbd> Search</span><span><kbd>N</kbd> New link</span></div>
        </aside>

        <section className="bookmark-library" aria-label="Saved links">
          <div className="bookmark-toolbar">
            <div className="bookmark-search">
              <Search size={18} />
              <input ref={searchRef} aria-label="Search bookmarks" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a link, collection or tag…" />
              {search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}
            </div>
            <div className="bookmark-filter-row">
              <select aria-label="Filter by tag" value={tag} onChange={event => setTag(event.target.value)}><option value="">All tags</option>{tags.map(value => <option key={value}>{value}</option>)}</select>
              <select aria-label="Sort bookmarks" value={sort} onChange={event => setSort(event.target.value)}><option value="pinned">Pinned first</option><option value="newest">Newest saved</option><option value="oldest">Oldest saved</option><option value="title">Title A–Z</option></select>
              <div className="bookmark-view-switch" aria-label="View mode">
                <button aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={17} /></button>
                <button aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={17} /></button>
              </div>
            </div>
          </div>

          <div className="bookmark-results-heading">
            <div><h2>{category || (pinned ? 'Pinned links' : 'All links')}</h2><span aria-live="polite">{filtered.length} saved {filtered.length === 1 ? 'link' : 'links'}{deferredSearch !== search ? ' · Searching…' : ''}{tag ? ` · #${tag}` : ''}</span></div>
            <div className="bookmark-results-actions">
              {visible.length > 0 && <button className="bookmark-select-page" aria-pressed={visibleSelected} onClick={() => setSelectedIds(previous => { const next = new Set(previous); visible.forEach(item => visibleSelected ? next.delete(item.id) : next.add(item.id)); return next; })}>{visibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}{visibleSelected ? 'Clear page' : 'Select page'}</button>}
              {(search || category || tag || pinned) && <button onClick={clearFilters}>Reset filters</button>}
            </div>
          </div>

          {selectedIds.size > 0 && <div className="bookmark-bulk-bar" role="region" aria-label="Bulk bookmark actions">
            <span><CheckSquare size={15} />{selectedIds.size} selected</span>
            <button disabled={busy} onClick={() => void runBulkPin()}><Pin size={14} />Pin selected</button>
            <div className="bookmark-bulk-move"><select aria-label="Move selected to collection" value={moveTarget} onChange={event => setMoveTarget(event.target.value)}><option value="">Move to collection…</option>{categories.map(value => <option key={value}>{value}</option>)}<option value="General">General</option></select><button disabled={busy || !moveTarget} onClick={() => void runBulkMove()}><Layers size={14} />Move</button></div>
            <button disabled={busy} onClick={exportSelected}><FileDown size={14} />Export</button>
            <button className="is-danger" disabled={busy} onClick={() => setDeleting(selectedRecords)}><Trash2 size={14} />Delete</button>
            <button className="bookmark-bulk-clear" disabled={busy} aria-label="Clear selection" onClick={() => setSelectedIds(new Set())}><X size={15} /></button>
          </div>}

          {loading ? <LoadingState message="Loading bookmarks…" /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : !filtered.length ? (
            <div className="bookmark-empty">
              <BookmarkIcon size={34} /><h3>{items.length ? 'No links found' : 'Your next useful discovery belongs here.'}</h3>
              <p>{items.length ? 'Try another phrase or reset your filters.' : 'Save a resource, give it a collection, and find it again in seconds.'}</p>
              <HudButton size="sm" onClick={items.length ? clearFilters : openAdd}>{items.length ? 'Reset filters' : 'Save your first link'}</HudButton>
            </div>
          ) : (
            <div className={`bookmark-records is-${view}`} aria-busy={deferredSearch !== search}>
              {visible.map((item, index) => (
                <article key={item.id} className={`bookmark-record ${item.pinned ? 'is-pinned' : ''}`}>
                  {selectedIds.size > 0 && <button className="bookmark-select-record" aria-label={`${selectedIds.has(item.id) ? 'Deselect' : 'Select'} ${item.title}`} aria-pressed={selectedIds.has(item.id)} onClick={() => toggleSelection(item.id)}>{selectedIds.has(item.id) ? <CheckSquare size={17} /> : <Square size={17} />}</button>}
                  <BookmarkLogo url={item.url} title={item.title} />
                  <div className="bookmark-record-main">
                    <div className="bookmark-record-title">
                      {item.href ? <a href={item.href} target="_blank" rel="noopener noreferrer">{item.title}<ArrowUpRight size={15} /><span className="sr-only"> (opens in a new tab)</span></a> : <span>{item.title}</span>}
                    </div>
                    <p className="bookmark-record-domain" title={item.url}>{item.host}</p>
                    {item.description && <p className="bookmark-record-note">{item.description}</p>}
                    <div className="bookmark-record-meta">
                      <button onClick={() => setCategory(item.category)}>{item.category}</button>
                      {item.tags.slice(0, 2).map(value => <button key={value} className="bookmark-tag" onClick={() => setTag(value)}>#{value}</button>)}
                      {item.tags.length > 2 && <button className="bookmark-tag" onClick={() => setSelected(item)}>+{item.tags.length - 2} tags</button>}
                    </div>
                  </div>
                  <div className="bookmark-record-tail">
                    <span className="bookmark-record-number">{String(currentPage * 24 + index + 1).padStart(2, '0')}</span>
                    <button className={`bookmark-icon-button ${item.pinned ? 'is-active' : ''}`} aria-label={`${item.pinned ? 'Unpin' : 'Pin'} ${item.title}`} aria-pressed={item.pinned} disabled={pendingIds.has(item.id)} onClick={() => void togglePin(item)}><Pin size={15} fill={item.pinned ? 'currentColor' : 'none'} /></button>
                    <button className="bookmark-icon-button" aria-label={`Details and actions for ${item.title}`} onClick={() => setSelected(item)}><MoreHorizontal size={19} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {!loading && !error && filtered.length > 24 && (
            <nav className="bookmark-pagination" aria-label="Bookmark pages">
              <span>{currentPage * 24 + 1}–{Math.min((currentPage + 1) * 24, filtered.length)} of {filtered.length}</span>
              <div><button disabled={currentPage === 0} aria-label="Previous page" onClick={() => { setPage(currentPage - 1); searchRef.current?.focus(); }}><ChevronLeft size={16} /></button><span>Page {currentPage + 1} / {pageCount}</span><button disabled={currentPage === pageCount - 1} aria-label="Next page" onClick={() => { setPage(currentPage + 1); searchRef.current?.focus(); }}><ChevronRight size={16} /></button></div>
            </nav>
          )}
        </section>
      </div>

      <HudModal open={!!selected} onClose={() => setSelected(null)} title="Bookmark details">
        {selected && <div className="bookmark-details">
          <div className="bookmark-eyebrow">{selected.category}</div>
          <h2>{selected.title}</h2><p className="bookmark-detail-url">{selected.url}</p>
          {selected.description && <p className="bookmark-detail-note">{selected.description}</p>}
          <div className="bookmark-detail-tags">{selected.tags.map(value => <button key={value} onClick={() => { setTag(value); setSelected(null); }}>#{value}</button>)}</div>
          <p className="bookmark-detail-date">Saved {new Date(selected.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <div className="bookmark-detail-actions">
            {safeUrl(selected.url) && <a href={safeUrl(selected.url)!} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Open link</a>}
            <button onClick={() => void copyUrl(safeUrl(selected.url) ?? selected.url)}><Copy size={15} />Copy URL</button>
            <button disabled={pendingIds.has(selected.id)} onClick={() => openEdit(selected)}><Pencil size={15} />Edit</button>
            <button className="is-danger" disabled={pendingIds.has(selected.id)} onClick={() => { setDeleting([selected]); setSelected(null); }}><Trash2 size={15} />Delete</button>
          </div>
        </div>}
      </HudModal>
      <HudModal open={modal} onClose={() => { if (!busy) setModal(false); }} title={editing ? 'Edit bookmark' : 'Save a link'}>
        <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4">
          <HudInput label="Title" autoFocus required maxLength={240} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
          <HudInput label="Web address" required placeholder="https://example.com" value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} />
          <HudTextarea label="Notes (optional)" rows={3} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} />
          <HudInput label="Collection" list="bookmark-collections" maxLength={100} value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })} />
          <datalist id="bookmark-collections">{categories.map(value => <option key={value} value={value} />)}</datalist>
          <HudInput label="Tags (comma separated)" placeholder="reference, work, learning" value={draft.tags} onChange={event => setDraft({ ...draft, tags: event.target.value })} />
          {formError && <p role="alert" className="text-sm text-alert-red">{formError}</p>}
          <div className="flex justify-end gap-2"><HudButton type="button" variant="ghost" disabled={busy} onClick={() => setModal(false)}>Cancel</HudButton><HudButton type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save bookmark'}</HudButton></div>
        </form>
      </HudModal>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} title={deleting?.length === 1 ? 'Delete bookmark' : 'Delete selected bookmarks'} message={deleting?.length === 1 ? <>Remove “{deleting[0].title}” from your library? This cannot be undone.</> : <>Remove {deleting?.length ?? 0} selected bookmarks? This cannot be undone.</>} confirmLabel={deleting?.length === 1 ? 'Delete bookmark' : 'Delete bookmarks'} />
    </PageContainer>
  );
}
