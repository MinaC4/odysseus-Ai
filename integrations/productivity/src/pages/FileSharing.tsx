import { eventTarget } from "@/lib/dom";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronLeft, ChevronRight, Download, ExternalLink, Eye, FileText, Files, HardDrive, Image, LayoutGrid, LayoutList, Link2, Loader2, Maximize2, Minimize2, Pencil, RefreshCw, RotateCcw, Search, Terminal, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PageContainer, PageHeader } from '@/components/PageLayout';
import { HudModal } from '@/components/HudModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CopyButton } from '@/components/CopyButton';
import { decodeAttachment, downloadName, isTextFile, MAX_FILE_SIZE, MAX_TEXT_PREVIEW, rasterMime, safeExternalUrl, type ArchivedFile } from '@/components/project-archive/archiveModel';
import { formatBytes, formatRelative } from '@/lib/utils';
import './FileSharing.css';

type ItemKind = 'file' | 'image' | 'command' | 'link';
type SortMode = 'recent' | 'oldest' | 'name' | 'name-desc' | 'largest' | 'smallest' | 'manual';
interface SharedItem {
  id: string; kind: ItemKind; title: string; file_name: string | null;
  mime_type: string | null; size_bytes: number; content: string | null;
  note: string | null; created_at: string; sort_order: number;
}
interface SharedItemFile { id: string; item_id: string; file_name: string; mime_type: string | null; size_bytes: number }
type StoredFile = Pick<SharedItem, 'id' | 'file_name' | 'mime_type' | 'size_bytes'> & { item_id?: string; title?: string };
const KINDS = { file: { label: 'Files', icon: FileText }, image: { label: 'Images', icon: Image }, command: { label: 'Commands', icon: Terminal }, link: { label: 'Links', icon: Link2 } };
const ITEM_COLUMNS = 'id,kind,title,file_name,mime_type,size_bytes,content,note,created_at,sort_order';
const FILE_COLUMNS = 'id,item_id,file_name,mime_type,size_bytes';
const PAGE_SIZE = 24;
const messageOf = (error: unknown) => error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Please try again.';

async function readFile(file: Pick<StoredFile, 'id' | 'item_id' | 'title'>) {
  const { data, error } = await supabase.from(file.item_id ? 'shared_item_files' : 'shared_items').select('data_base64,mime_type,file_name,size_bytes').eq('id', file.id).single();
  if (error) throw error;
  if (!data) throw new Error('The file is no longer available.');
  const record = { ...data, file_name: data.file_name ?? file.title ?? 'download', mime_type: data.mime_type ?? 'application/octet-stream' } as ArchivedFile;
  return { record, bytes: decodeAttachment(record) };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error(`Cannot read ${file.name}`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was canceled`));
    reader.readAsDataURL(file);
  });
}

/** Image controls work for both legacy records and collection attachments. */
function ImageViewer({ src, alt, onDownload, onPrevious, onNext }: { src: string; alt: string; onDownload: () => void; onPrevious?: () => void; onNext?: () => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const zoomBy = useCallback((amount: number) => setZoom(value => Math.max(.05, Math.min(5, Math.round((value + amount) * 100) / 100))), []);
  const fit = useCallback(() => { setZoom(fitZoom); setPan({ x: 0, y: 0 }); }, [fitZoom]);
  const measure = useCallback(() => {
    const image = imageRef.current, viewport = viewportRef.current;
    if (!image?.naturalWidth || !viewport) return;
    const value = Math.max(.01, Math.min(1, (viewport.clientWidth - 32) / image.naturalWidth, (viewport.clientHeight - 32) / image.naturalHeight));
    setFitZoom(value); setZoom(value); setPan({ x: 0, y: 0 });
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    const change = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', change);
    return () => { observer.disconnect(); document.removeEventListener('fullscreenchange', change); };
  }, [measure]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select')) return;
      if (['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.preventDefault();
      if (event.key === '+' || event.key === '=') zoomBy(.15);
      if (event.key === '-') zoomBy(-.15);
      if (event.key === '0') fit();
      if (event.key === 'ArrowLeft') onPrevious?.();
      if (event.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [fit, onPrevious, onNext, zoomBy]);
  const toggleFullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await shellRef.current?.requestFullscreen(); } catch { /* Browser fullscreen policy leaves the normal viewer usable. */ }
  };
  return <div ref={shellRef} className={`fs-image-viewer ${fullscreen ? 'fs-fullscreen' : ''}`}>
    <div className="fs-image-toolbar">
      <span>{Math.round(zoom * 100)}%</span><div className="fs-actions">
        <button className="fs-icon" aria-label="Zoom out" onClick={() => zoomBy(-.15)}><ZoomOut size={16} /></button>
        <button className="fs-button" onClick={fit} aria-label="Fit image to viewport">Fit</button>
        <button className="fs-button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="Show image at actual size">100%</button>
        <button className="fs-icon" aria-label="Zoom in" onClick={() => zoomBy(.15)}><ZoomIn size={16} /></button>
        <button className="fs-icon" aria-label="Reset image view" onClick={fit}><RotateCcw size={16} /></button>
        <button className="fs-icon" aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen image'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        <button className="fs-icon" aria-label="Download image" onClick={onDownload}><Download size={16} /></button>
      </div>
    </div>
    <div ref={viewportRef} className="fs-image-stage" onWheel={event => { event.preventDefault(); zoomBy(event.deltaY < 0 ? .12 : -.12); }}
      onPointerDown={event => { if ((eventTarget(event) as HTMLElement).closest('button')) return; dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
      onPointerMove={event => { const drag = dragRef.current; if (drag) setPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y }); }}
      onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }} title="Scroll to zoom · drag to pan · 0 to fit">
      <img ref={imageRef} src={src} alt={alt} draggable={false} onLoad={measure} style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})` }} />
      {onPrevious && <button className="fs-image-prev fs-icon" aria-label="Previous image" onClick={onPrevious}><ChevronLeft size={20} /></button>}
      {onNext && <button className="fs-image-next fs-icon" aria-label="Next image" onClick={onNext}><ChevronRight size={20} /></button>}
    </div><p className="fs-image-hint">Scroll to zoom · drag to pan · use arrow keys to browse</p>
  </div>;
}

function FilePreview({ file, onDownload, onPrevious, onNext, thumbnail = false }: { file: StoredFile; onDownload?: () => void; onPrevious?: () => void; onNext?: () => void; thumbnail?: boolean }) {
  const { id, item_id: itemId, title: fileTitle } = file;
  const [preview, setPreview] = useState<{ url?: string; text?: string; error?: string; unsupported?: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const [thumbnailVisible, setThumbnailVisible] = useState(!thumbnail);
  const thumbnailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!thumbnail) { setThumbnailVisible(true); return; }
    setThumbnailVisible(false);
    const node = thumbnailRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') { setThumbnailVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      setThumbnailVisible(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [id, thumbnail]);
  useEffect(() => {
    if (thumbnail && !thumbnailVisible) return;
    let alive = true, url: string | undefined;
    setPreview(null);
    void readFile({ id, item_id: itemId, title: fileTitle }).then(({ record, bytes }) => {
      if (!alive) return;
      const mime = rasterMime(bytes);
      if (mime) { url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: mime })); setPreview({ url }); }
      else if (!thumbnail && isTextFile(record) && bytes.length <= MAX_TEXT_PREVIEW) setPreview({ text: new TextDecoder().decode(bytes) });
      else setPreview({ unsupported: true });
    }).catch(error => { if (alive) setPreview({ error: messageOf(error) }); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [id, itemId, fileTitle, thumbnail, thumbnailVisible, retry]);
  if (thumbnail) return <div ref={thumbnailRef} className="fs-thumbnail">{preview?.url ? <img src={preview.url} alt={file.file_name ?? file.title ?? 'Image'} loading="lazy" /> : <Image size={32} />}</div>;
  if (!preview) return <div className="fs-preview-placeholder" role="status"><Loader2 size={24} className="animate-spin" />Loading preview…</div>;
  if (preview.error) return <div className="fs-preview-placeholder" role="alert"><p>{preview.error}</p><button className="fs-button" onClick={() => setRetry(value => value + 1)}>Retry preview</button></div>;
  if (preview.url) return <ImageViewer src={preview.url} alt={file.file_name ?? file.title ?? 'Image'} onDownload={onDownload ?? (() => {})} onPrevious={onPrevious} onNext={onNext} />;
  if (preview.text !== undefined) return <pre className="fs-text-preview">{preview.text || '(Empty file)'}</pre>;
  return <div className="fs-preview-placeholder"><FileText size={38} /><p>Download this file to open it.</p><span>Text previews support files up to 1 MiB. Images support PNG, JPEG, GIF and WebP.</span></div>;
}

export function FileSharing() {
  const [items, setItems] = useState<SharedItem[]>([]);
  const [attachments, setAttachments] = useState<Record<string, SharedItemFile[]>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | ItemKind>('all');
  const [sort, setSort] = useState<SortMode>('recent');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [viewItem, setViewItem] = useState<SharedItem | null>(null);
  const [activeAttachment, setActiveAttachment] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ kind: ItemKind; item?: SharedItem } | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ current: string; done: number; total: number } | null>(null);
  const [groupUpload, setGroupUpload] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const loadRef = useRef(false);
  const refreshPending = useRef(false);
  const uploadRef = useRef(false);
  const saveRef = useRef(false);
  const alive = useRef(true);
  const notify = useCallback((text: string) => setNotice(text), []);

  const loadItems = useCallback(async (): Promise<void> => {
    if (loadRef.current) { refreshPending.current = true; return; }
    loadRef.current = true; setSyncing(true);
    try {
      const records: SharedItem[] = [];
      const files: SharedItemFile[] = [];
      // Metadata is paged; file payloads are requested only when displayed or downloaded.
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from('shared_items').select(ITEM_COLUMNS).order('created_at', { ascending: false }).order('id').range(offset, offset + 499);
        if (error) throw error;
        records.push(...(data ?? []) as SharedItem[]);
        if ((data?.length ?? 0) < 500) break;
      }
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from('shared_item_files').select(FILE_COLUMNS).order('id').range(offset, offset + 499);
        if (error) throw error;
        files.push(...(data ?? []) as SharedItemFile[]);
        if ((data?.length ?? 0) < 500) break;
      }
      if (!alive.current) return;
      const grouped: Record<string, SharedItemFile[]> = {};
      for (const file of files) (grouped[file.item_id] ??= []).push(file);
      // Children are authoritative if a previous collection upload only partly succeeded.
      const current = records.map(item => grouped[item.id]?.length ? { ...item, size_bytes: grouped[item.id].reduce((sum, file) => sum + Number(file.size_bytes), 0) } : item);
      setItems(current); setAttachments(grouped); setError(''); setLastSync(new Date());
      setSelected(previous => new Set([...previous].filter(id => records.some(item => item.id === id))));
      setViewItem(previous => previous ? current.find(item => item.id === previous.id) ?? null : null);
    } catch (failure) { if (alive.current) setError(`Could not refresh files. ${messageOf(failure)}`); }
    finally {
      loadRef.current = false;
      if (alive.current) {
        setLoading(false); setSyncing(false);
        if (refreshPending.current) { refreshPending.current = false; void loadItems(); }
      }
    }
  }, []);
  useEffect(() => {
    alive.current = true; void loadItems();
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible' && !uploadRef.current) void loadItems(); }, 15000);
    return () => { alive.current = false; clearInterval(interval); };
  }, [loadItems]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { setPage(1); }, [search, filter, sort]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((eventTarget(event) as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]') || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === 'Escape') setSelected(new Set());
      if (event.key.toLowerCase() === 'u' && !uploadRef.current) inputRef.current?.click();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return items.filter(item => (filter === 'all' || item.kind === filter) && (!query || [item.title, item.file_name, item.content, item.note, ...(attachments[item.id] ?? []).map(file => file.file_name)].some(value => value?.toLocaleLowerCase().includes(query)))).sort((a, b) => {
      switch (sort) {
        case 'name': return a.title.localeCompare(b.title, undefined, { numeric: true });
        case 'name-desc': return b.title.localeCompare(a.title, undefined, { numeric: true });
        case 'largest': return b.size_bytes - a.size_bytes;
        case 'smallest': return a.size_bytes - b.size_bytes;
        case 'oldest': return a.created_at.localeCompare(b.created_at);
        case 'manual': return a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at);
        default: return b.created_at.localeCompare(a.created_at);
      }
    });
  }, [items, attachments, filter, search, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const allVisibleSelected = visible.length > 0 && visible.every(item => selected.has(item.id));
  const storageBytes = items.reduce((sum, item) => sum + Number(item.size_bytes), 0);
  const currentFiles = viewItem ? attachments[viewItem.id] ?? [] : [];
  const previewFile = currentFiles.find(file => file.id === activeAttachment) ?? currentFiles[0] ?? viewItem;
  const images: StoredFile[] = currentFiles.length ? currentFiles.filter(file => file.mime_type?.startsWith('image/')) : filtered.filter(item => item.kind === 'image' && !(attachments[item.id]?.length));
  const imageIndex = images.findIndex(file => file.id === previewFile?.id);
  const toggleSelection = (id: string) => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const openItem = (item: SharedItem) => { setViewItem(item); setActiveAttachment(null); };
  const openEditor = (kind: ItemKind, item?: SharedItem) => { setEditor({ kind, item }); setTitle(item?.title ?? ''); setContent(item?.content ?? ''); setNote(item?.note ?? ''); setFormError(''); };

  const uploadFiles = async (fileList: File[]) => {
    if (uploadRef.current || !fileList.length) return;
    const oversized = fileList.filter(file => file.size > MAX_FILE_SIZE);
    const files = fileList.filter(file => file.size <= MAX_FILE_SIZE);
    if (!files.length) { setError(`Files must be 10 MiB or smaller. Rejected: ${oversized.map(file => file.name).join(', ')}`); return; }
    uploadRef.current = true; setError(''); setUpload({ current: files[0].name, done: 0, total: files.length });
    const failures: string[] = oversized.map(file => `${file.name} exceeds 10 MiB`);
    let success = 0, successfulBytes = 0, parentId: string | undefined;
    const minOrder = Math.min(0, ...items.map(item => item.sort_order));
    try {
      if (groupUpload && files.length > 1) {
        const { data, error } = await supabase.from('shared_items').insert({ kind: files.every(file => file.type.startsWith('image/')) ? 'image' : 'file', title: `${files.length} files collection`, size_bytes: 0, sort_order: minOrder - 1 }).select('id').single();
        if (error || !data) throw error ?? new Error('Could not create the collection.');
        parentId = data.id;
      }
      for (const [index, file] of files.entries()) {
        setUpload({ current: file.name, done: index, total: files.length });
        try {
          const base64 = await fileToBase64(file);
          const payload = { file_name: file.name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size, data_base64: base64 };
          const { error } = parentId
            ? await supabase.from('shared_item_files').insert({ ...payload, item_id: parentId })
            : await supabase.from('shared_items').insert({ ...payload, kind: file.type.startsWith('image/') ? 'image' : 'file', title: file.name, sort_order: minOrder - 1 - index });
          if (error) throw error;
          success++; successfulBytes += file.size;
        } catch (failure) { failures.push(`${file.name}: ${messageOf(failure)}`); }
        setUpload({ current: file.name, done: index + 1, total: files.length });
      }
      if (parentId) {
        if (success) {
          const { error } = await supabase.from('shared_items').update({ title: `${success} files collection`, size_bytes: successfulBytes }).eq('id', parentId).select('id').single();
          if (error) failures.push(`Collection metadata: ${error.message}`);
        } else {
          const { data, error } = await supabase.from('shared_items').delete().eq('id', parentId).select('id');
          if (error || data?.length !== 1) failures.push(`Empty collection cleanup: ${error?.message ?? 'Could not remove the empty collection.'}`);
        }
      }
    } catch (failure) { failures.push(messageOf(failure)); }
    finally { uploadRef.current = false; setUpload(null); await loadItems(); }
    if (success) notify(`${success} ${success === 1 ? 'file' : 'files'} uploaded${parentId ? ' into a collection' : ''}.`);
    if (failures.length) setError(`Some files could not be uploaded. ${failures.join(' · ')}`);
  };

  const downloadFile = async (file: StoredFile) => {
    if (busyId) return;
    setBusyId(file.id);
    try {
      const { record, bytes } = await readFile(file);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = downloadName(record.file_name); link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); notify(`Downloading ${record.file_name}`);
    } catch (failure) { setError(`Download failed. ${messageOf(failure)}`); }
    finally { setBusyId(null); }
  };
  const downloadItem = (item: SharedItem) => {
    if (attachments[item.id]?.length) { openItem(item); notify('Choose an attachment to download.'); }
    else void downloadFile(item);
  };
  const saveEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor || saveRef.current) return;
    if (!title.trim()) { setFormError('Enter a name.'); return; }
    const isText = editor.kind === 'command' || editor.kind === 'link';
    if (isText && !content.trim()) { setFormError(editor.kind === 'link' ? 'Enter a URL.' : 'Enter a command.'); return; }
    if (editor.kind === 'link' && !safeExternalUrl(content.trim())) { setFormError('Use an http:// or https:// URL without embedded credentials.'); return; }
    saveRef.current = true; setSaving(true); setFormError('');
    const payload = { title: title.trim(), note: note.trim() || null, ...(isText ? { content: editor.kind === 'link' ? safeExternalUrl(content.trim()) : content.trim() } : {}) };
    try {
      const result = editor.item
        ? await supabase.from('shared_items').update(payload).eq('id', editor.item.id).select('id').single()
        : await supabase.from('shared_items').insert({ ...payload, kind: editor.kind, sort_order: Math.min(0, ...items.map(item => item.sort_order)) - 1 }).select('id').single();
      if (result.error || !result.data) throw result.error ?? new Error('The item could not be saved.');
      setEditor(null); notify(editor.item ? 'Changes saved.' : `${editor.kind === 'link' ? 'Link' : 'Command'} saved.`); await loadItems();
    } catch (failure) { setFormError(`Could not save. ${messageOf(failure)}`); }
    finally { saveRef.current = false; setSaving(false); }
  };
  const removeItems = async () => {
    if (!deleteIds.length) return;
    try {
      const { data, error } = await supabase.from('shared_items').delete().in('id', deleteIds).select('id');
      if (error) throw error;
      const removed = new Set((data ?? []).map((item: {id:string}) => String(item.id)));
      if (removed.size !== deleteIds.length) {
        setDeleteIds([]);
        await loadItems();
        setError('Some items could not be deleted. The list was refreshed; review the remaining items before retrying.');
        return;
      }
      setItems(previous => previous.filter(item => !removed.has(item.id)));
      setSelected(previous => new Set([...previous].filter(id => !removed.has(id))));
      if (viewItem && removed.has(viewItem.id)) setViewItem(null);
      setDeleteIds([]); notify(`${removed.size} ${removed.size === 1 ? 'item' : 'items'} deleted.`);
    } catch (failure) { setDeleteIds([]); setError(`Delete failed. Your files are still listed. ${messageOf(failure)}`); }
  };
  const moveToTop = async (item: SharedItem) => {
    if (busyId) return; setBusyId(item.id);
    try {
      const { error } = await supabase.from('shared_items').update({ sort_order: Math.min(0, ...items.map(row => row.sort_order)) - 1 }).eq('id', item.id).select('id').single();
      if (error) throw error;
      setSort('manual'); await loadItems(); notify('Moved to the top of your custom order.');
    } catch (failure) { setError(`Could not reorder. ${messageOf(failure)}`); }
    finally { setBusyId(null); }
  };
  const selectImage = (index: number) => { const file = images[index]; if (!file) return; if (file.item_id) setActiveAttachment(file.id); else openItem(file as SharedItem); };
  const itemActions = (item: SharedItem) => <div className="fs-actions" onClick={event => event.stopPropagation()}>
    {(item.kind === 'command' || item.kind === 'link') && item.content && <CopyButton text={item.content} />}
    {(item.kind === 'file' || item.kind === 'image') && <button className="fs-icon" aria-label={`Download ${item.title}`} disabled={!!busyId} onClick={() => downloadItem(item)}>{busyId === item.id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}</button>}
    <button className="fs-icon" aria-label={`Edit ${item.title}`} onClick={() => openEditor(item.kind, item)}><Pencil size={15} /></button>
    <button className="fs-icon fs-danger" aria-label={`Delete ${item.title}`} onClick={() => setDeleteIds([item.id])}><Trash2 size={15} /></button>
  </div>;

  return <PageContainer className="fs-page">
    <PageHeader title="File Sharing" subtitle="One shared space for your files, images, links and commands." actions={<div className="fs-actions fs-header-actions">
      <button className="fs-button" onClick={() => openEditor('command')}><Terminal size={15} />Add command</button>
      <button className="fs-button" onClick={() => openEditor('link')}><Link2 size={15} />Add link</button>
      <button className="fs-button fs-primary" disabled={!!upload} onClick={() => inputRef.current?.click()}><Upload size={16} />{upload ? 'Uploading…' : 'Upload files'}</button>
    </div>} />
    <input ref={inputRef} type="file" multiple className="hidden" aria-label="Choose files to upload" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void uploadFiles(files); }} />
    {notice && <div className="fs-notice" role="status"><Check size={16} /><span>{notice}</span><button className="fs-icon" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {error && <div className="fs-error" role="alert"><span>{error}</span><button className="fs-button" disabled={syncing} onClick={() => void loadItems()}>Retry refresh</button><button className="fs-icon" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
    <div className="fs-workspace" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragOver(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false); }} onDrop={event => { event.preventDefault(); setDragOver(false); void uploadFiles(Array.from(event.dataTransfer.files)); }}>
      {dragOver && <div className="fs-drop-overlay"><Upload size={38} /><strong>{upload ? 'Upload in progress' : 'Drop files to upload'}</strong><span>Up to 10 MiB per file</span></div>}
      <aside className="fs-sidebar">
        <div className="fs-sidebar-heading">Library</div>
        <nav aria-label="File types">
          {(['all', 'file', 'image', 'command', 'link'] as const).map(kind => {
            const Icon = kind === 'all' ? Files : KINDS[kind].icon;
            return <button key={kind} className={`fs-nav ${filter === kind ? 'fs-active' : ''}`} aria-current={filter === kind ? 'page' : undefined} onClick={() => setFilter(kind)}><Icon size={17} /><span>{kind === 'all' ? 'All items' : KINDS[kind].label}</span><span className="fs-count">{kind === 'all' ? items.length : items.filter(item => item.kind === kind).length}</span></button>;
          })}
        </nav>
        <div className="fs-storage"><HardDrive size={17} /><div><strong>{formatBytes(storageBytes)}</strong><span>Shared across your devices</span></div></div>
        <label className="fs-group-setting"><input type="checkbox" checked={groupUpload} disabled={!!upload} onChange={event => setGroupUpload(event.target.checked)} /><span>Group uploads into a collection</span></label>
        <p className="fs-sidebar-note">Drop files anywhere in this library. Maximum 10 MiB per file.</p>
      </aside>
      <main className="fs-main">
        <div className="fs-library-heading"><div><h2>{filter === 'all' ? 'All items' : KINDS[filter].label}</h2><p>{filtered.length} {filtered.length === 1 ? 'item' : 'items'}{search ? ' found' : ' in your library'}</p></div>
          <button className="fs-icon" aria-label="Refresh files" disabled={syncing} onClick={() => void loadItems()} title={lastSync ? `Last refreshed ${lastSync.toLocaleTimeString()}` : 'Refresh'}><RefreshCw size={17} className={syncing ? 'animate-spin' : ''} /></button>
        </div>
        <div className="fs-toolbar"><div className="fs-search"><Search size={17} /><input ref={searchRef} aria-label="Search shared items" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search files, attachments, links and notes" />{search && <button className="fs-icon" aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</div>
          <select className="fs-sort" aria-label="Sort shared items" value={sort} onChange={event => setSort(event.target.value as SortMode)}>
            <option value="recent">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="largest">Largest first</option><option value="smallest">Smallest first</option><option value="manual">Custom order</option>
          </select><div className="fs-view-toggle"><button className="fs-icon" aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><LayoutList size={17} /></button><button className="fs-icon" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={17} /></button></div>
        </div>
        {upload && <div className="fs-upload-status" role="status"><Loader2 size={18} className="animate-spin" /><div><strong>Uploading {upload.current}</strong><span>{upload.done} of {upload.total} files complete</span><progress value={upload.done} max={upload.total} aria-label="Upload progress" /></div></div>}
        {selected.size > 0 && <div className="fs-selection"><span>{selected.size} selected</span><button className="fs-button fs-danger" onClick={() => setDeleteIds([...selected])}><Trash2 size={15} />Delete selected</button><button className="fs-button" onClick={() => setSelected(new Set())}>Clear selection</button></div>}
        {loading ? <div className="fs-empty" role="status"><Loader2 size={28} className="animate-spin" /><h3>Loading your library</h3></div> : filtered.length === 0 ? <div className="fs-empty"><Files size={42} /><h3>{items.length ? 'No matching items' : error ? 'Your library is unavailable' : 'Your library starts here'}</h3><p>{items.length ? 'Try another search or file type.' : error ? 'Retry refreshing to load your stored files.' : 'Upload files or save a link or command to share across devices.'}</p>{items.length ? <button className="fs-button" onClick={() => { setSearch(''); setFilter('all'); }}>Clear filters</button> : !error && <button className="fs-button fs-primary" onClick={() => inputRef.current?.click()} disabled={!!upload}><Upload size={16} />Upload your first file</button>}</div> : <>
          <div className="fs-select-all"><label><input type="checkbox" aria-label="Select all items on this page" checked={allVisibleSelected} onChange={() => setSelected(previous => { const next = new Set(previous); visible.forEach(item => allVisibleSelected ? next.delete(item.id) : next.add(item.id)); return next; })} />Select page</label><span>{lastSync ? `Updated ${formatRelative(lastSync)}` : ''}</span></div>
          {view === 'list' ? <div className="fs-list"><div className="fs-list-head"><span>Name</span><span>Size</span><span>Added</span><span>Actions</span></div>{visible.map(item => {
            const Icon = KINDS[item.kind].icon, files = attachments[item.id] ?? [];
            return <article key={item.id} className={`fs-row ${selected.has(item.id) ? 'fs-selected' : ''}`}>
              <input type="checkbox" aria-label={`Select ${item.title}`} checked={selected.has(item.id)} onChange={() => toggleSelection(item.id)} />
              <button className="fs-item-name" onClick={() => openItem(item)}><span className={`fs-file-icon fs-kind-${item.kind}`}><Icon size={21} /></span><span><strong>{item.title}</strong><small>{files.length ? `${files.length} attachments` : item.file_name && item.file_name !== item.title ? item.file_name : item.kind === 'link' ? item.content : item.kind === 'command' ? item.note || 'Saved command' : item.mime_type || KINDS[item.kind].label}</small></span></button>
              <span className="fs-row-size">{item.kind === 'file' || item.kind === 'image' ? formatBytes(item.size_bytes) : '—'}</span><time className="fs-row-date" dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()}>{formatRelative(item.created_at)}</time>{itemActions(item)}
            </article>;
          })}</div> : <div className="fs-grid">{visible.map(item => {
            const Icon = KINDS[item.kind].icon, files = attachments[item.id] ?? [];
            return <article key={item.id} className={`fs-card ${selected.has(item.id) ? 'fs-selected' : ''}`}><div className="fs-card-top"><input type="checkbox" aria-label={`Select ${item.title}`} checked={selected.has(item.id)} onChange={() => toggleSelection(item.id)} /><span className={`fs-kind-label fs-kind-${item.kind}`}>{KINDS[item.kind].label}</span>{itemActions(item)}</div>
              <button className="fs-card-preview" aria-label={`Preview ${item.title}`} onClick={() => openItem(item)}>{item.kind === 'image' ? <FilePreview key={files[0]?.id ?? item.id} file={files[0] ?? item} thumbnail /> : item.kind === 'command' ? <pre>{item.content?.slice(0, 220)}</pre> : <Icon size={42} />}</button>
              <button className="fs-card-name" onClick={() => openItem(item)}><strong>{item.title}</strong><span>{files.length ? `${files.length} attachments · ` : ''}{item.kind === 'file' || item.kind === 'image' ? `${formatBytes(item.size_bytes)} · ` : ''}{formatRelative(item.created_at)}</span></button>
            </article>;
          })}</div>}
          <div className="fs-pagination"><span>{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}</span><div className="fs-actions"><button className="fs-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button><span>{currentPage} / {pageCount}</span><button className="fs-button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} aria-label="Next page"><ChevronRight size={16} /></button></div></div>
        </>}
      </main>
    </div>
    <HudModal open={!!viewItem} onClose={() => setViewItem(null)} title={viewItem?.title} className="fs-detail-modal max-w-6xl">
      {viewItem && <div className="fs-detail"><div className="fs-detail-main">
        {(viewItem.kind === 'file' || viewItem.kind === 'image') && previewFile && <FilePreview key={previewFile.id} file={previewFile} onDownload={() => void downloadFile(previewFile)} onPrevious={imageIndex > 0 ? () => selectImage(imageIndex - 1) : undefined} onNext={imageIndex >= 0 && imageIndex < images.length - 1 ? () => selectImage(imageIndex + 1) : undefined} />}
        {viewItem.kind === 'command' && <div><div className="fs-command-heading"><Terminal size={17} /><span>Saved command</span>{viewItem.content && <CopyButton text={viewItem.content} />}</div><pre className="fs-text-preview">{viewItem.content}</pre></div>}
        {viewItem.kind === 'link' && <div className="fs-link-preview"><Link2 size={36} /><h3>{viewItem.title}</h3><p>{viewItem.content}</p>{safeExternalUrl(viewItem.content) ? <a className="fs-button fs-primary" href={safeExternalUrl(viewItem.content)} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Open link</a> : <p role="alert">This stored URL cannot be opened safely. Edit it to use http:// or https://.</p>}{viewItem.content && <CopyButton text={viewItem.content} />}</div>}
        {currentFiles.length > 0 && <section className="fs-attachments"><h3>Attachments <span>{currentFiles.length}</span></h3>{currentFiles.map(file => <div key={file.id} className={`fs-attachment ${previewFile?.id === file.id ? 'fs-attachment-active' : ''}`}><button className="fs-item-name" onClick={() => setActiveAttachment(file.id)} aria-label={`Preview ${file.file_name}`}><FileText size={18} /><span><strong>{file.file_name}</strong><small>{formatBytes(file.size_bytes)}</small></span><Eye size={15} /></button><button className="fs-icon" aria-label={`Download ${file.file_name}`} disabled={!!busyId} onClick={() => void downloadFile(file)}>{busyId === file.id ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}</button></div>)}</section>}
      </div><aside className="fs-details-sidebar"><h3>Details</h3><dl><dt>Type</dt><dd>{currentFiles.length ? 'Collection' : KINDS[viewItem.kind].label}</dd>{previewFile?.file_name && <><dt>File name</dt><dd>{previewFile.file_name}</dd></>}{(viewItem.kind === 'file' || viewItem.kind === 'image') && <><dt>Size</dt><dd>{formatBytes(previewFile?.size_bytes ?? viewItem.size_bytes)}</dd><dt>Format</dt><dd>{previewFile?.mime_type ?? 'Unknown'}</dd></>}<dt>Added</dt><dd>{new Date(viewItem.created_at).toLocaleString()}</dd></dl>
        {viewItem.note && <div className="fs-detail-note"><h4>Notes</h4><p>{viewItem.note}</p></div>}
        {(viewItem.kind === 'file' || viewItem.kind === 'image') && previewFile && <button className="fs-button fs-primary" disabled={!!busyId} onClick={() => void downloadFile(previewFile)}><Download size={16} />Download{currentFiles.length ? ' attachment' : ''}</button>}
        <button className="fs-button" onClick={() => { openEditor(viewItem.kind, viewItem); setViewItem(null); }}><Pencil size={15} />Edit details</button>
        <button className="fs-button" disabled={!!busyId} onClick={() => void moveToTop(viewItem)}><ArrowUp size={15} />Move to top</button>
        <button className="fs-button fs-danger" onClick={() => setDeleteIds([viewItem.id])}><Trash2 size={15} />Delete{currentFiles.length ? ' collection' : ''}</button>
      </aside></div>}
    </HudModal>
    <HudModal open={!!editor} onClose={() => { if (!saving) setEditor(null); }} title={editor?.item ? 'Edit details' : editor?.kind === 'command' ? 'Add command' : 'Add link'} className="max-w-xl">
      <form className="fs-editor" onSubmit={saveEntry}><label>Name<input autoFocus className="fs-field" value={title} onChange={event => setTitle(event.target.value)} required maxLength={240} disabled={saving} /></label>
        {editor?.kind === 'command' && <label>Command<textarea className="fs-field fs-code-field" value={content} onChange={event => setContent(event.target.value)} rows={7} required placeholder="Paste the command you want to save" disabled={saving} /></label>}
        {editor?.kind === 'link' && <label>URL<input className="fs-field" value={content} onChange={event => setContent(event.target.value)} required placeholder="https://example.com" disabled={saving} /></label>}
        <label>Notes <span>(optional)</span><textarea className="fs-field" value={note} onChange={event => setNote(event.target.value)} rows={3} disabled={saving} /></label>
        {formError && <p className="fs-form-error" role="alert">{formError}</p>}<div className="fs-editor-actions"><button type="button" className="fs-button" disabled={saving} onClick={() => setEditor(null)}>Cancel</button><button type="submit" className="fs-button fs-primary" disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{saving ? 'Saving…' : 'Save'}</button></div>
      </form>
    </HudModal>
    <ConfirmDialog open={deleteIds.length > 0} onClose={() => setDeleteIds([])} onConfirm={removeItems} title={deleteIds.length > 1 ? `Delete ${deleteIds.length} items?` : 'Delete this item?'} message={<><p>{deleteIds.length > 1 ? 'The selected items' : items.find(item => item.id === deleteIds[0])?.title || 'This item'} will be permanently removed from every device. Collections include all their attachments.</p><p className="mt-2">This cannot be undone.</p></>} confirmLabel="Delete permanently" />
  </PageContainer>;
}
