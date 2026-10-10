import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, CircleAlert, Command, Copy, Download, ExternalLink,
  Files, Globe2, Grid2X2, Info, LayoutList, LoaderCircle, Monitor, Pencil, Plus, Search, Star, Tag,
  Trash2, Upload, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PageContainer, PageHeader, LoadingState, ErrorState } from '@/components/PageLayout';
import { HudButton } from '@/components/HudButton';
import { HudInput, HudSelect, HudTextarea } from '@/components/HudInputs';
import { renderMarkdown } from '@/lib/markdown';
import { parseQuickLauncherUrl, reorderQuickLinks, validateQuickLauncherImport } from '@/lib/quick-launcher';
import './quick-launcher.css';
import { isWorkspaceShortcutBlocked, activeElement as deepActiveElement } from '@/lib/dom';

interface QuickLink {
  id: string;
  title: string;
  url: string;
  type: string;
  icon: string | null;
  created_at: string;
  updated_at: string;
  category: string;
  description: string | null;
  tags: string[];
  favorite: boolean;
  sort_order: number;
}

const CATEGORIES = [
  { value: 'ai', label: 'AI Assistant' },
  { value: 'coding-architecture', label: 'Coding & Architecture' },
  { value: 'dev', label: 'Development' },
  { value: 'research', label: 'Research' },
  { value: 'automation', label: 'Automation' },
  { value: 'other', label: 'Other' },
];
const COLORS: Record<string, string> = {
  ai: '#54d9e8', 'coding-architecture': '#f3a86b', dev: '#89d39c', research: '#b69bf5',
  automation: '#e8c36d', other: '#91a8ae',
};
const ICONS = ['🤖', '🧠', '🚀', '⚡', '🛰️', '🔬', '🛠️', '📡', '🧬', '🎨', '🦾', '👾'];
const MAX_IMPORT_BYTES = 1_000_000;
const MAX_IMPORT_ITEMS = 250;
const RECENTS_KEY = 'hephastos.quick-launcher.recents.v1';
const VIEW_KEY = 'hephastos.quick-launcher.view.v1';
type ViewMode = 'grid' | 'list';
type SortMode = 'manual' | 'title' | 'updated' | 'created';
type Scope = 'all' | 'favorites' | 'recent';

const safeHttpUrl = parseQuickLauncherUrl;
const labelForCategory = (value: string) => CATEGORIES.find((item) => item.value === value)?.label ?? value;
const colorForCategory = (value: string) => COLORS[value] ?? '#9daab4';
const hostFor = (value: string) => safeHttpUrl(value)?.hostname.replace(/^www\./, '') ?? value;
const ALLOWED_MARKDOWN_TAGS = new Set(['P', 'BR', 'STRONG', 'EM', 'DEL', 'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'A']);
function safeDescriptionHtml(markdown: string) {
  const parsed = new DOMParser().parseFromString(renderMarkdown(markdown), 'text/html');
  const walk = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child instanceof HTMLElement && !ALLOWED_MARKDOWN_TAGS.has(child.tagName)) {
        child.replaceWith(document.createTextNode(child.textContent ?? ''));
        continue;
      }
      if (child instanceof HTMLElement) {
        const href = child.tagName === 'A' ? child.getAttribute('href') : null;
        [...child.attributes].forEach((attribute) => child.removeAttribute(attribute.name));
        if (child.tagName === 'A' && href) {
          const url = safeHttpUrl(href);
          if (url) { child.setAttribute('href', url.href); child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
          else { child.replaceWith(document.createTextNode(child.textContent ?? '')); continue; }
        }
      }
      walk(child);
    }
  };
  walk(parsed.body);
  return parsed.body.innerHTML;
}
const getStoredView = (): ViewMode => {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
};
const getRecentIds = (): string[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 8) : [];
  } catch { return []; }
};

function LauncherDialog({ open, onClose, title, children, className = '' }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = deepActiveElement() as HTMLElement | null;
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]')];
      if (!focusable.length) { event.preventDefault(); panelRef.current.focus(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (deepActiveElement() === panelRef.current) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && deepActiveElement() === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && deepActiveElement() === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="ql-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ql-dialog-title" className={`ql-dialog hud-panel clip-corner-both corner-brackets ${className}`}>
        <header className="ql-dialog-header">
          <h2 id="ql-dialog-title">{title}</h2>
          <button type="button" onClick={onClose} className="ql-icon-button" aria-label="Close dialog"><X size={18} /></button>
        </header>
        <div className="ql-dialog-body">{children}</div>
      </section>
    </div>, document.querySelector('#personal-workspace-host')?.shadowRoot?.querySelector('#workspace-portals') ?? document.body,
  );
}

function DestinationIcon({ link }: { link: QuickLink }) {
  return <span className="ql-icon" aria-hidden="true" style={{ '--ql-accent': colorForCategory(link.category) } as React.CSSProperties}>
    {link.icon ? <span>{link.icon}</span> : link.type === 'internal' ? <Monitor size={19} /> : <Globe2 size={19} />}
  </span>;
}

export function QuickLauncher() {
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [view, setView] = useState<ViewMode>(getStoredView);
  const [sort, setSort] = useState<SortMode>('manual');
  const [recentIds, setRecentIds] = useState<string[]>(getRecentIds);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<QuickLink | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuickLink | null>(null);
  const [detailTarget, setDetailTarget] = useState<QuickLink | null>(null);
  const [activeEmbed, setActiveEmbed] = useState<QuickLink | null>(null);
  const [embedState, setEmbedState] = useState<'loading' | 'loaded'>('loading');
  const [embedVersion, setEmbedVersion] = useState(0);
  const [formError, setFormError] = useState('');
  const [importError, setImportError] = useState('');
  const [toast, setToast] = useState('');
  const [toastError, setToastError] = useState(false);
  const [form, setForm] = useState({ title: '', url: '', type: 'external', icon: '', category: 'ai', description: '', tags: '', favorite: false });
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const toastTimer = useRef<number>();

  const notify = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToastError(/could not|failed|invalid|error/i.test(message));
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(''), 2800);
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    const { data, error } = await supabase.from('quick_links').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    if (error) { setLoadError('Your shortcuts could not be loaded. Check your connection and try again.'); setLoading(false); return; }
    const normalized = ((data ?? []) as QuickLink[]).map((item) => ({ ...item, tags: Array.isArray(item.tags) ? item.tags : [], category: item.category || 'other' }));
    setLinks(normalized); setLoading(false);
  }, []);

  useEffect(() => { void load(); return () => window.clearTimeout(toastTimer.current); }, [load]);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* storage may be unavailable */ } }, [view]);
  useEffect(() => {
    if (activeEmbed) document.querySelector('.quick-launcher .ql-embed')?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [activeEmbed, embedVersion]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isWorkspaceShortcutBlocked(event) || showForm || detailTarget || deleteTarget || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); openAdd(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm, detailTarget, deleteTarget]);

  const categories = useMemo(() => {
    const values = new Set(links.map((link) => link.category || 'other'));
    return [...values].sort((a, b) => labelForCategory(a).localeCompare(labelForCategory(b)));
  }, [links]);
  const favorites = useMemo(() => links.filter((link) => link.favorite).sort((a, b) => a.sort_order - b.sort_order), [links]);
  const recents = useMemo(() => recentIds.map((id) => links.find((link) => link.id === id)).filter((link): link is QuickLink => !!link), [links, recentIds]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    let results = links.filter((link) => {
      if (scope === 'favorites' && !link.favorite) return false;
      if (scope === 'recent' && !recentIds.includes(link.id)) return false;
      if (category && link.category !== category) return false;
      if (typeFilter && link.type !== typeFilter) return false;
      if (tagFilter && !link.tags.includes(tagFilter)) return false;
      if (needle && !`${link.title} ${link.url} ${link.description ?? ''} ${link.tags.join(' ')} ${labelForCategory(link.category)}`.toLocaleLowerCase().includes(needle)) return false;
      return true;
    });
    results = [...results].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'updated') return b.updated_at.localeCompare(a.updated_at);
      if (sort === 'created') return b.created_at.localeCompare(a.created_at);
      if (scope === 'recent') return recentIds.indexOf(a.id) - recentIds.indexOf(b.id);
      return a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at);
    });
    return results;
  }, [links, scope, category, typeFilter, tagFilter, search, recentIds, sort]);
  const manualUnfiltered = sort === 'manual' && scope === 'all' && !category && !typeFilter && !tagFilter && !search.trim();
  const allTags = useMemo(() => [...new Set(links.flatMap((link) => link.tags))].sort(), [links]);

  function openAdd() {
    setEditing(null); setForm({ title: '', url: '', type: 'external', icon: '', category: 'ai', description: '', tags: '', favorite: false });
    setFormError(''); setShowForm(true);
  }
  function openEdit(link: QuickLink) {
    setEditing(link); setForm({ title: link.title, url: link.url, type: link.type === 'internal' ? 'internal' : 'external', icon: link.icon ?? '', category: link.category || 'other', description: link.description ?? '', tags: link.tags.join(', '), favorite: link.favorite });
    setFormError(''); setShowForm(true);
  }
  const save = async () => {
    if (saving) return;
    const title = form.title.trim(); const parsedUrl = safeHttpUrl(form.url);
    if (!title) { setFormError('Add a title for this shortcut.'); return; }
    if (!parsedUrl) { setFormError('Enter an HTTP(S) URL without embedded username or password.'); return; }
    if (title.length > 100 || form.description.length > 2000) { setFormError('Title is limited to 100 characters and description to 2,000.'); return; }
    const tags = [...new Set(form.tags.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
    const values = { title, url: parsedUrl.href, type: form.type, icon: form.icon.trim().slice(0, 20) || null, category: form.category.trim() || 'other', description: form.description.trim() || null, tags, favorite: form.favorite, updated_at: new Date().toISOString() };
    setSaving(true); setFormError('');
    const result = editing
      ? await supabase.from('quick_links').update(values).eq('id', editing.id).select().single()
      : await supabase.from('quick_links').insert({ ...values, sort_order: links.length ? Math.min(...links.map((link) => link.sort_order ?? 0)) - 1 : 0 }).select().single();
    setSaving(false);
    if (result.error || !result.data) { setFormError(result.error?.message || 'The shortcut could not be saved.'); return; }
    const item = { ...(result.data as QuickLink), tags: Array.isArray(result.data.tags) ? result.data.tags : [] };
    setLinks((previous) => editing ? previous.map((link) => link.id === item.id ? item : link) : [item, ...previous]);
    setShowForm(false); notify(editing ? 'Shortcut updated' : 'Shortcut added');
  };

  const toggleFavorite = async (link: QuickLink) => {
    if (busyId) return;
    setBusyId(link.id);
    const { data, error } = await supabase.from('quick_links').update({ favorite: !link.favorite, updated_at: new Date().toISOString() }).eq('id', link.id).select().single();
    setBusyId(null);
    if (error || !data) { notify('Favorite could not be updated'); return; }
    setLinks((previous) => previous.map((item) => item.id === link.id ? { ...item, favorite: data.favorite, updated_at: data.updated_at ?? item.updated_at } : item));
  };
  const duplicate = async (link: QuickLink) => {
    if (busyId) return;
    if (!safeHttpUrl(link.url)) { notify('This shortcut has an invalid URL. Edit it before duplicating.'); return; }
    setBusyId(link.id);
    const { data, error } = await supabase.from('quick_links').insert({
      title: `${link.title.slice(0, 93)} (copy)`, url: link.url, type: link.type, icon: link.icon,
      category: link.category, description: link.description, tags: link.tags, favorite: false,
      sort_order: links.length ? Math.min(...links.map((item) => item.sort_order ?? 0)) - 1 : 0,
    }).select().single();
    setBusyId(null);
    if (error || !data) { notify('Shortcut could not be duplicated'); return; }
    setLinks((previous) => [{ ...(data as QuickLink), tags: Array.isArray(data.tags) ? data.tags : [] }, ...previous]);
    notify('Shortcut duplicated');
  };
  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notify('URL copied');
    } catch { notify('Could not copy URL. Select and copy it manually.'); }
  };
  const persistOrder = async (ordered: QuickLink[]) => {
    const updates = ordered.map((item, index) => ({ id: item.id, sort_order: index })).filter((update) => links.find((item) => item.id === update.id)?.sort_order !== update.sort_order);
    if (!updates.length) return true;
    setBusyId('reorder');
    const results = await Promise.all(updates.map(({ id, sort_order }) => supabase.from('quick_links').update({ sort_order }).eq('id', id).select('id')));
    setBusyId(null);
    const failed = results.some((result) => result.error || !result.data?.length);
    if (failed) { notify('Could not save the complete order. Refreshing shortcuts…'); await load(); return false; }
    setLinks((previous) => previous.map((item) => ({ ...item, sort_order: updates.find((update) => update.id === item.id)?.sort_order ?? item.sort_order })).sort((a, b) => a.sort_order - b.sort_order));
    return true;
  };
  const moveLink = async (link: QuickLink, offset: number) => {
    if (!manualUnfiltered || busyId) return;
    const ordered = [...links].sort((a, b) => a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at));
    const index = ordered.findIndex((item) => item.id === link.id); const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
    await persistOrder(ordered);
  };
  const onDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId || !manualUnfiltered || busyId) { setDragId(null); return; }
    const ordered = reorderQuickLinks(links, dragId, targetId);
    if (!ordered) { setDragId(null); return; }
    setDragId(null); await persistOrder(ordered);
  };
  const remove = async () => {
    if (!deleteTarget || busyId) return;
    setBusyId(deleteTarget.id);
    const { data, error } = await supabase.from('quick_links').delete().eq('id', deleteTarget.id).select('id');
    setBusyId(null);
    if (error || !data?.length) { notify('Shortcut could not be deleted. Refresh and try again.'); return; }
    setLinks((previous) => previous.filter((item) => item.id !== deleteTarget.id));
    setRecentIds((previous) => previous.filter((id) => id !== deleteTarget.id));
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recentIds.filter((id) => id !== deleteTarget.id))); } catch { /* optional preference */ }
    if (activeEmbed?.id === deleteTarget.id) setActiveEmbed(null);
    setDeleteTarget(null); notify('Shortcut deleted');
  };
  const openLink = (link: QuickLink) => {
    const parsed = safeHttpUrl(link.url);
    if (!parsed) { notify('This shortcut has an invalid URL. Edit it to continue.'); return; }
    const nextRecents = [link.id, ...recentIds.filter((id) => id !== link.id)].slice(0, 8);
    setRecentIds(nextRecents);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(nextRecents)); } catch { /* recents are an optional convenience */ }
    if (link.type === 'internal') { setDetailTarget(null); setEmbedState('loading'); setEmbedVersion((value) => value + 1); setActiveEmbed({ ...link, url: parsed.href }); }
    else window.open(parsed.href, '_blank', 'noopener,noreferrer');
  };
  const exportJSON = () => {
    if (!filtered.length) return;
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = objectUrl; anchor.download = `hephastos-shortcuts-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); notify('Shortcuts exported');
  };
  const importJSON = async (file: File) => {
    setImportError('');
    if (file.size > MAX_IMPORT_BYTES) { setImportError('File is too large. Imports are limited to 1 MB.'); return; }
    setBusyId('import');
    try {
      const rows = validateQuickLauncherImport(JSON.parse(await file.text()), MAX_IMPORT_ITEMS);
      if (!rows.length) throw new Error('The file contains no shortcuts to import.');
      const firstOrder = links.length ? Math.min(...links.map((item) => item.sort_order ?? 0)) - rows.length : 0;
      const { data, error } = await supabase.from('quick_links').insert(rows.map((row, index) => ({ ...row, sort_order: firstOrder + index }))).select();
      if (error) throw new Error(error.message || 'The shortcuts could not be imported.');
      const added = (data ?? []) as QuickLink[];
      if (!added.length) throw new Error('The import finished without any shortcuts being returned.');
      setLinks((previous) => [...added.map((item) => ({ ...item, tags: Array.isArray(item.tags) ? item.tags : [] })), ...previous]);
      notify(`${added.length} shortcut${added.length === 1 ? '' : 's'} imported`);
      if (added.length !== rows.length) setImportError(`Imported ${added.length} of ${rows.length} shortcuts. The remaining items were rejected by the data service.`);
    } catch (error) {
      setImportError(error instanceof Error ? `Import failed: ${error.message}` : 'Import failed. Check the JSON file and try again.');
    } finally { setBusyId(null); if (fileRef.current) fileRef.current.value = ''; }
  };

  const cards = (items: QuickLink[], compact = false) => view === 'grid' ? (
    <div className={`ql-grid ${compact ? 'ql-grid-compact' : ''}`}>
      {items.map((link, index) => <article key={link.id} className={`ql-card ${dragId === link.id ? 'is-dragging' : ''}`} draggable={manualUnfiltered && !compact && !busyId} onDragStart={() => setDragId(link.id)} onDragOver={(event) => { if (manualUnfiltered) event.preventDefault(); }} onDrop={() => void onDrop(link.id)} onDragEnd={() => setDragId(null)}>
        <div className="ql-card-top"><DestinationIcon link={link} /><div className="ql-card-title"><button className="ql-title-button" onClick={() => openLink(link)}>{link.title}</button><span className="ql-host">{hostFor(link.url)}</span></div>
          <button className={`ql-icon-button ql-favorite ${link.favorite ? 'is-favorite' : ''}`} aria-label={link.favorite ? `Remove ${link.title} from favorites` : `Add ${link.title} to favorites`} disabled={busyId === link.id} onClick={() => void toggleFavorite(link)}><Star size={16} fill={link.favorite ? 'currentColor' : 'none'} /></button>
        </div>
        {link.description && <p className="ql-description">{link.description}</p>}
        <div className="ql-card-meta"><span className="ql-category" style={{ '--ql-accent': colorForCategory(link.category) } as React.CSSProperties}>{labelForCategory(link.category)}</span><span className="ql-link-type">{link.type === 'internal' ? 'Embedded' : 'External'}</span></div>
        {!!link.tags.length && <div className="ql-tags">{link.tags.slice(0, compact ? 2 : 3).map((tag) => <span key={tag}><Tag size={10} />{tag}</span>)}{link.tags.length > (compact ? 2 : 3) && <span>+{link.tags.length - (compact ? 2 : 3)}</span>}</div>}
        <footer className="ql-card-actions"><button className="ql-open-button" onClick={() => openLink(link)}>{link.type === 'internal' ? 'Open here' : 'Launch'} <ArrowUpRight size={14} /></button><div className="ql-action-group">
          {manualUnfiltered && !compact && <><button className="ql-icon-button" title="Move up" aria-label={`Move ${link.title} up`} disabled={busyId !== null || index === 0} onClick={() => void moveLink(link, -1)}><ArrowUp size={14} /></button><button className="ql-icon-button" title="Move down" aria-label={`Move ${link.title} down`} disabled={busyId !== null || index === items.length - 1} onClick={() => void moveLink(link, 1)}><ArrowDown size={14} /></button></>}
          {!compact && <><button className="ql-icon-button" title="Details" aria-label={`Details for ${link.title}`} onClick={() => setDetailTarget(link)}><Info size={14} /></button><button className="ql-icon-button" title="Duplicate" aria-label={`Duplicate ${link.title}`} disabled={busyId === link.id} onClick={() => void duplicate(link)}><Files size={14} /></button></>}<button className="ql-icon-button" title="Edit shortcut" aria-label={`Edit ${link.title}`} onClick={() => openEdit(link)}><Pencil size={14} /></button><button className="ql-icon-button ql-danger" title="Delete shortcut" aria-label={`Delete ${link.title}`} onClick={() => setDeleteTarget(link)}><Trash2 size={14} /></button>
        </div></footer>
      </article>)}
    </div>
  ) : <div className="ql-list" role="list">{items.map((link, index) => <article key={link.id} className="ql-row" role="listitem">
    <DestinationIcon link={link} /><button className={`ql-icon-button ql-favorite ${link.favorite ? 'is-favorite' : ''}`} aria-label={link.favorite ? `Remove ${link.title} from favorites` : `Add ${link.title} to favorites`} onClick={() => void toggleFavorite(link)}><Star size={15} fill={link.favorite ? 'currentColor' : 'none'} /></button>
    <div className="ql-row-main"><button className="ql-title-button" onClick={() => openLink(link)}>{link.title}</button><span className="ql-host">{hostFor(link.url)}</span></div><span className="ql-category" style={{ '--ql-accent': colorForCategory(link.category) } as React.CSSProperties}>{labelForCategory(link.category)}</span><button className="ql-open-button" onClick={() => openLink(link)}>{link.type === 'internal' ? 'Open here' : 'Launch'} <ArrowUpRight size={14} /></button>
    <div className="ql-action-group">{manualUnfiltered && <><button className="ql-icon-button" title="Move up" aria-label={`Move ${link.title} up`} disabled={busyId !== null || index === 0} onClick={() => void moveLink(link, -1)}><ArrowUp size={14} /></button><button className="ql-icon-button" title="Move down" aria-label={`Move ${link.title} down`} disabled={busyId !== null || index === items.length - 1} onClick={() => void moveLink(link, 1)}><ArrowDown size={14} /></button></>}<button className="ql-icon-button" title="Details" aria-label={`Details for ${link.title}`} onClick={() => setDetailTarget(link)}><Info size={14} /></button><button className="ql-icon-button" title="Duplicate" aria-label={`Duplicate ${link.title}`} disabled={busyId === link.id} onClick={() => void duplicate(link)}><Files size={14} /></button><button className="ql-icon-button" title="Edit" aria-label={`Edit ${link.title}`} onClick={() => openEdit(link)}><Pencil size={14} /></button><button className="ql-icon-button ql-danger" title="Delete" aria-label={`Delete ${link.title}`} onClick={() => setDeleteTarget(link)}><Trash2 size={14} /></button></div>
  </article>)}</div>;

  return <PageContainer className="quick-launcher">
    {toast && <div className={`ql-toast ${toastError ? 'is-error' : ''}`} role={toastError ? 'alert' : 'status'}>{toastError ? <CircleAlert size={15} /> : <Check size={15} />}{toast}</div>}
    <PageHeader title="Quick Launcher" subtitle="Your personal launchpad for tools, workspaces, and useful destinations." actions={<HudButton onClick={openAdd}><Plus size={15} className="mr-1 inline" />Add shortcut <kbd className="ql-key-hint">N</kbd></HudButton>} />

    <section className="ql-welcome hud-panel" aria-label="Launcher overview">
      <div className="ql-welcome-copy"><div className="ql-eyebrow"><span className="ql-live-dot" />CURATED WORKSPACE</div><h2>Everything you use,<br /><span>one launch away.</span></h2><p>Keep useful tools close. Add a link, organize it, and jump back in whenever you need it.</p></div>
      <div className="ql-overview-stats"><div><strong>{loading || loadError ? '—' : links.length}</strong><span>Shortcuts</span></div><div><strong>{loading || loadError ? '—' : favorites.length}</strong><span>Favorites</span></div><div><strong>{loading || loadError ? '—' : categories.length}</strong><span>Categories</span></div></div>
      <div className="ql-welcome-art" aria-hidden="true"><div className="ql-orbit ql-orbit-one" /><div className="ql-orbit ql-orbit-two" /><div className="ql-orbit-core"><Command size={27} /></div></div>
    </section>

    <div className="ql-workspace-layout">
      <aside className="ql-sidebar" aria-label="Shortcut navigation">
        <div className="ql-sidebar-heading">Workspace</div>
        <button className={`ql-nav-item ${scope === 'all' && !category ? 'active' : ''}`} onClick={() => { setScope('all'); setCategory(''); }}><Grid2X2 size={16} /><span>All shortcuts</span><b>{links.length}</b></button>
        <button className={`ql-nav-item ${scope === 'favorites' ? 'active' : ''}`} onClick={() => { setScope('favorites'); setCategory(''); }}><Star size={16} /><span>Favorites</span><b>{favorites.length}</b></button>
        <button className={`ql-nav-item ${scope === 'recent' ? 'active' : ''}`} onClick={() => { setScope('recent'); setCategory(''); }}><LoaderCircle size={16} /><span>Recently opened</span><b>{recents.length}</b></button>
        {categories.length > 0 && <><div className="ql-sidebar-heading ql-category-heading">Categories</div>{categories.map((item) => <button key={item} className={`ql-nav-item ${category === item ? 'active' : ''}`} onClick={() => { setScope('all'); setCategory((current) => current === item ? '' : item); }}><span className="ql-category-dot" style={{ backgroundColor: colorForCategory(item) }} /><span>{labelForCategory(item)}</span><b>{links.filter((link) => link.category === item).length}</b></button>)}</>}
        <div className="ql-sidebar-foot"><span className="ql-key-hint">/</span> focus search<span className="ql-sidebar-separator">·</span><span className="ql-key-hint">N</span> new shortcut</div>
      </aside>

      <main className="ql-main">
        {favorites.length > 0 && scope === 'all' && !category && !search && <section className="ql-section ql-favorites-section"><div className="ql-section-heading"><div><span className="ql-eyebrow">YOUR GO-TO DESTINATIONS</span><h2><Star size={17} />Favorites</h2></div><button className="ql-text-button" onClick={() => setScope('favorites')}>View all <ArrowUpRight size={14} /></button></div>{cards(favorites.slice(0, 4), true)}</section>}
        {recents.length > 0 && scope === 'all' && !category && !search && <section className="ql-section ql-recents-section"><div className="ql-section-heading"><div><span className="ql-eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>Recently opened</h2></div><button className="ql-text-button" onClick={() => setScope('recent')}>View all <ArrowUpRight size={14} /></button></div><div className="ql-recent-strip">{recents.slice(0, 4).map((link) => <button key={link.id} className="ql-recent-item" onClick={() => openLink(link)}><DestinationIcon link={link} /><span><strong>{link.title}</strong><small>{hostFor(link.url)}</small></span><ArrowUpRight size={14} /></button>)}</div></section>}

        <section className="ql-section ql-library-section">
          <div className="ql-library-heading"><div><span className="ql-eyebrow">BROWSE YOUR COLLECTION</span><h2>{scope === 'favorites' ? 'Favorite shortcuts' : scope === 'recent' ? 'Recently opened' : category ? labelForCategory(category) : 'All shortcuts'} <span className="ql-result-count">{filtered.length}</span></h2></div>
            <div className="ql-view-switch" role="group" aria-label="View style"><button className={view === 'grid' ? 'active' : ''} aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={16} /></button><button className={view === 'list' ? 'active' : ''} aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><LayoutList size={16} /></button></div>
          </div>
          <div className="ql-toolbar"><label className="ql-search"><Search size={16} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search shortcuts, URLs, tags…" aria-label="Search shortcuts" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}<kbd>/</kbd></label>
            <label className="ql-select-wrap"><span className="sr-only">Filter by type</span><HudSelect aria-label="Filter by type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">Any type</option><option value="external">External</option><option value="internal">Embedded</option></HudSelect><ChevronDown size={13} /></label>
            <label className="ql-select-wrap ql-tag-select"><span className="sr-only">Filter by tag</span><HudSelect aria-label="Filter by tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">Any tag</option>{allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</HudSelect><ChevronDown size={13} /></label>
            <label className="ql-select-wrap"><span className="sr-only">Sort shortcuts</span><HudSelect aria-label="Sort shortcuts" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="manual">{scope === 'recent' ? 'Last opened' : 'Manual order'}</option><option value="title">Title A–Z</option><option value="updated">Recently updated</option><option value="created">Recently added</option></HudSelect><ChevronDown size={13} /></label>
            <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importJSON(file); }} />
            <button className="ql-toolbar-button" onClick={() => fileRef.current?.click()} disabled={busyId === 'import'}><Upload size={15} />Import</button><button className="ql-toolbar-button" onClick={exportJSON} disabled={!filtered.length}><Download size={15} />Export</button>
          </div>
          {importError && <div className="ql-inline-error" role="alert">{importError}<button aria-label="Dismiss import message" onClick={() => setImportError('')}><X size={14} /></button></div>}
          {loading ? <LoadingState message="Loading shortcuts…" /> : loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : filtered.length ? <>{cards(filtered)}{sort === 'manual' && !manualUnfiltered && <p className="ql-sort-note">Clear search and filters to reorder shortcuts.</p>}</> : <div className="ql-empty"><div className="ql-empty-icon">{links.length ? <Search size={22} /> : <Plus size={22} />}</div><h3>{links.length ? 'No shortcuts found' : 'Your launchpad is ready'}</h3><p>{links.length ? 'Try a different search or clear the current filters.' : 'Add the tools and destinations you reach for every day.'}</p>{links.length ? <HudButton variant="ghost" onClick={() => { setSearch(''); setCategory(''); setTypeFilter(''); setTagFilter(''); setScope('all'); }}>Clear filters</HudButton> : <HudButton onClick={openAdd}><Plus size={15} className="mr-1 inline" />Add your first shortcut</HudButton>}</div>}
        </section>
      </main>
    </div>

    {activeEmbed && <section className="ql-embed hud-panel" aria-label={`${activeEmbed.title} embedded destination`}><header><div><span className="ql-eyebrow">INTERNAL DESTINATION</span><h2>{activeEmbed.title}</h2></div><div className="ql-embed-actions"><a className="ql-toolbar-button" href={activeEmbed.url} target="_blank" rel="noopener noreferrer">Open in new tab <ExternalLink size={14} /></a><button className="ql-icon-button" onClick={() => { setEmbedState('loading'); setEmbedVersion((value) => value + 1); }} aria-label="Reload embedded destination" title="Reload"><LoaderCircle size={16} /></button><button className="ql-icon-button" onClick={() => setActiveEmbed(null)} aria-label="Close embedded destination"><X size={17} /></button></div></header><p className="ql-embed-note" role="status">{embedState === 'loading' ? 'Loading the destination… If the page blocks embedding, open it in a new tab.' : 'The frame loaded. Its content cannot be verified here; some sites restrict embedding.'}</p><iframe key={`${activeEmbed.id}-${embedVersion}`} src={activeEmbed.url} title={activeEmbed.title} onLoad={() => setEmbedState('loaded')} referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-same-origin allow-scripts allow-forms allow-popups" /></section>}

    <LauncherDialog open={!!detailTarget} onClose={() => setDetailTarget(null)} title={detailTarget?.title ?? ''} className="ql-detail-dialog">{detailTarget && <div className="ql-detail-content">
      <div className="ql-detail-summary"><DestinationIcon link={detailTarget} /><div><h3>{detailTarget.title}</h3><span>{labelForCategory(detailTarget.category)} · {detailTarget.type === 'internal' ? 'Embedded destination' : 'External destination'}</span></div></div>
      {detailTarget.description && <div className="ql-markdown markdown-body" dangerouslySetInnerHTML={{ __html: safeDescriptionHtml(detailTarget.description) }} />}
      <div className="ql-detail-url"><span>DESTINATION URL</span><div><a href={safeHttpUrl(detailTarget.url)?.href} target="_blank" rel="noopener noreferrer">{detailTarget.url}</a><button className="ql-icon-button" onClick={() => void copyUrl(detailTarget.url)} aria-label="Copy URL"><Copy size={15} /></button></div></div>
      {!!detailTarget.tags.length && <div className="ql-detail-tags"><span>TAGS</span><div>{detailTarget.tags.map((tag) => <b key={tag}>#{tag}</b>)}</div></div>}
      <div className="ql-detail-actions"><HudButton size="sm" onClick={() => openLink(detailTarget)}>{detailTarget.type === 'internal' ? 'Open here' : 'Launch'} <ArrowUpRight size={14} className="ml-1 inline" /></HudButton><HudButton size="sm" variant="ghost" onClick={() => { setDetailTarget(null); openEdit(detailTarget); }}><Pencil size={14} className="mr-1 inline" />Edit</HudButton><HudButton size="sm" variant="ghost" onClick={() => void duplicate(detailTarget)}><Files size={14} className="mr-1 inline" />Duplicate</HudButton></div>
    </div>}</LauncherDialog>

    <LauncherDialog open={showForm} onClose={() => !saving && setShowForm(false)} title={editing ? 'Edit shortcut' : 'Add shortcut'} className="ql-form-dialog"><div className="ql-form-grid">
      <HudInput label="Name" aria-label="Shortcut name" value={form.title} onChange={(event) => setForm((state) => ({ ...state, title: event.target.value }))} placeholder="e.g. Project dashboard" maxLength={100} />
      <HudInput label="URL" aria-label="Shortcut URL" type="url" value={form.url} onChange={(event) => setForm((state) => ({ ...state, url: event.target.value }))} placeholder="https://example.com" />
      <div className="ql-form-two"><HudSelect label="Open behavior" aria-label="Open behavior" value={form.type} onChange={(event) => setForm((state) => ({ ...state, type: event.target.value }))}><option value="external">Open in new tab</option><option value="internal">Embed in launcher</option></HudSelect><HudSelect label="Category" aria-label="Shortcut category" value={form.category} onChange={(event) => setForm((state) => ({ ...state, category: event.target.value }))}>{CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}{!CATEGORIES.some((item) => item.value === form.category) && <option value={form.category}>{labelForCategory(form.category)}</option>}</HudSelect></div>
      <div><label className="ql-form-label" htmlFor="ql-custom-icon">Icon</label><div className="ql-emoji-row">{ICONS.map((icon) => <button type="button" key={icon} className={form.icon === icon ? 'active' : ''} aria-label={`Choose ${icon} icon`} onClick={() => setForm((state) => ({ ...state, icon }))}>{icon}</button>)}</div><HudInput id="ql-custom-icon" aria-label="Custom icon or emoji" className="mt-2" value={form.icon} onChange={(event) => setForm((state) => ({ ...state, icon: event.target.value }))} placeholder="Or enter an emoji" maxLength={20} /></div>
      <HudTextarea label="Description" aria-label="Shortcut description" value={form.description} onChange={(event) => setForm((state) => ({ ...state, description: event.target.value }))} rows={3} placeholder="A short note about this destination" maxLength={2000} />
      <HudInput label="Tags" aria-label="Shortcut tags" value={form.tags} onChange={(event) => setForm((state) => ({ ...state, tags: event.target.value }))} placeholder="Separate tags with commas" />
      <label className="ql-checkbox"><input type="checkbox" checked={form.favorite} onChange={(event) => setForm((state) => ({ ...state, favorite: event.target.checked }))} /><Star size={15} />Add to favorites</label>
    </div>{formError && <p className="ql-inline-error" role="alert">{formError}</p>}<footer className="ql-dialog-footer"><HudButton variant="ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</HudButton><HudButton onClick={() => void save()} disabled={saving || !form.title.trim() || !form.url.trim()}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add shortcut'}</HudButton></footer></LauncherDialog>

    <LauncherDialog open={!!deleteTarget} onClose={() => !busyId && setDeleteTarget(null)} title="Delete shortcut">
      <p className="text-sm text-text-primary">Remove “{deleteTarget?.title}” from your launcher?</p>
      <footer className="ql-dialog-footer">
        <HudButton variant="ghost" onClick={() => setDeleteTarget(null)} disabled={!!busyId}>Cancel</HudButton>
        <HudButton variant="danger" onClick={() => void remove()} disabled={!!busyId}>{busyId === deleteTarget?.id ? 'Deleting…' : 'Delete'}</HudButton>
      </footer>
    </LauncherDialog>
  </PageContainer>;
}
