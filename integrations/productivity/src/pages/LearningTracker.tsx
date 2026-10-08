import { eventTarget } from "@/lib/dom";
/* eslint-disable react-refresh/only-export-components -- Page-local calculations are exported for focused checks. */
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, GraduationCap, Pencil, Star, LayoutGrid, LayoutList,
  Download, Upload, ExternalLink, Copy, Check, Clock, ImageIcon,
  Search, Tag, Files, BarChart3, ChevronUp, ChevronDown, X,
  GripVertical, FileText, Link2, Paperclip, Play, Pause, ArrowUpRight, Target, AlertCircle, BookOpen,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PageContainer, PageHeader, EmptyState } from '@/components/PageLayout';
import { HudButton } from '@/components/HudButton';
import { HudInput, HudSelect, HudTextarea } from '@/components/HudInputs';
import { HudModal } from '@/components/HudModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RadioBar } from '@/components/project/RadioBar';
import { renderMarkdown } from '@/lib/markdown';
import { formatDate, formatRelative } from '@/lib/utils';
import './LearningTracker.css';

interface LearningItem {
  id: string;
  title: string;
  provider: string | null;
  status: string;
  progress_percent: number;
  start_date: string | null;
  target_end_date: string | null;
  link: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  category: string;
  priority: string;
  tags: string[];
  favorite: boolean;
  estimated_hours: number;
  hours_spent: number;
  completed_at: string | null;
  score: string | null;
  image_mime_type: string | null;
  image_base64?: string | null;
  sort_order: number;
}

// Study material attached to a learning item (PDF / image / reference link).
interface LearningMaterial {
  id: string;
  item_id: string;
  kind: 'file' | 'link';
  title: string;
  url: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number;
}

const MAX_MATERIAL_SIZE = 10 * 1024 * 1024;

function fmtBytes(n: number): string {
  if (!n) return '';
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

type PRIORITY = (typeof PRIORITIES)[number];

const CATEGORIES = [
  { value: 'course', label: 'Course' },
  { value: 'certification', label: 'Certification' },
  { value: 'book', label: 'Book' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'other', label: 'Other' },
];

const CATEGORY_COLOR: Record<string, string> = {
  course: '#26e2f6',
  certification: '#a78bea',
  book: '#facc15',
  workshop: '#4ade80',
  other: '#5d7f88',
};

const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

const PRIORITY_COLOR: Record<string, string> = {
  low: '#5d7f88',
  medium: '#26e2f6',
  high: '#f0a020',
  critical: '#d92d2d',
};

const STATUSES = [
  { id: 'not_started', label: 'NOT STARTED', color: '#5d7f88' },
  { id: 'in_progress', label: 'IN PROGRESS', color: '#f0a020' },
  { id: 'completed', label: 'COMPLETED', color: '#4ade80' },
];

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

const catLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? 'Other';
const statusLabel = (s: string) => STATUSES.find((x) => x.id === s)?.label ?? s.toUpperCase();
const statusColor = (s: string) => STATUSES.find((x) => x.id === s)?.color ?? '#5d7f88';
export function learningDeadline(target: string | null, now = Date.now()): number | null {
  if (!target) return null;
  const date = new Date(`${target.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return null;
  // Target dates are entered as calendar days; allow the whole local day.
  date.setHours(23, 59, 59, 999);
  return date.getTime() - now;
}

const isOverdue = (item: LearningItem, now = Date.now()) => item.status !== 'completed' && (learningDeadline(item.target_end_date, now) ?? Infinity) < 0;

export function learningProgress(value: number, completedAt: string | null, now = new Date().toISOString()) {
  if (!Number.isFinite(value)) throw new Error('Progress must be a finite number.');
  const progress = Math.min(100, Math.max(0, Math.round(value)));
  return { progress_percent: progress, status: progress === 100 ? 'completed' : progress > 0 ? 'in_progress' : 'not_started', completed_at: progress === 100 ? completedAt ?? now : null };
}

export function studyHours(hours: number, minutes: number): number {
  if (!Number.isFinite(hours) || hours < 0 || !Number.isFinite(minutes) || minutes <= 0) throw new Error('Enter a positive number of study minutes.');
  return Math.round((hours + minutes / 60) * 10000) / 10000;
}

export function studyElapsed(session: { elapsed: number; startedAt: number }, running: boolean, now = Date.now()): number {
  return session.elapsed + (running ? Math.max(0, now - session.startedAt) : 0);
}

export function learningStatusProgress(status: string, progress: number): number {
  return status === 'completed' ? 100 : status === 'not_started' ? 0 : Math.min(99, Math.max(1, progress));
}

const fmtHours = (value: number) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const safeLink = (value: string | null) => {
  if (!value) return undefined;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
};

type ViewMode = 'in_progress' | 'board' | 'list';
type SortMode = 'updated' | 'progress' | 'target' | 'title' | 'manual' | 'priority';

/** Remaining-time label to a deadline (re-rendered by caller each second). */
function deadlineLabel(target: string | null): React.ReactNode {
  if (!target) return <span className="font-mono text-xs text-text-muted">—</span>;
  const ms = learningDeadline(target);
  if (ms === null) return <span>Invalid date</span>;
  if (ms > 0) {
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return (
      <span className="lp-countdown">
        {d > 0 ? `${d}d ` : ''}
        {h}h {m}m
      </span>
    );
  }
  const od = -ms;
  const d = Math.floor(od / 86400000);
  const h = Math.floor((od % 86400000) / 3600000);
  return (
    <span className="lp-countdown lp-overdue">
      OVERDUE {d > 0 ? `${d}d ` : ''}{h}h
    </span>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="lp-chip"
      style={{ color, borderColor: `${color}55`, background: `${color}0a` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function ProgressRail({ value, color }: { value: number; color: string }) {
  return <RadioBar segments={10} value={value / 100} color={color} height={6} />;
}

function CertThumb({ item }: { item: LearningItem }) {
  if (!item.image_mime_type || !item.image_base64) return null;
  return (
    <img
      src={`data:${item.image_mime_type};base64,${item.image_base64}`}
      alt="certificate"
      className="lp-cert object-cover"
      loading="lazy"
    />
  );
}

function LearningCard({
  item,
  onOpen,
  onEdit,
  onFav,
  onComplete,
  onDelete,
  onCertClick,
  materialCount = 0,
  compact = false,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
}: {
  item: LearningItem;
  onOpen: () => void;
  onEdit: () => void;
  onFav: () => void;
  onComplete: () => void;
  onDelete: () => void;
  onCertClick?: (item: LearningItem) => void;
  materialCount?: number;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  const catC = CATEGORY_COLOR[item.category] ?? '#5d7f88';
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`lp-card group relative p-3 cursor-pointer ${compact ? 'min-w-[180px] w-60' : ''} ${isDragging ? 'opacity-40 ring-1 ring-accent-cyan' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ '--lp-rail': catC } as CSSProperties}
      onClick={onOpen}
    >
      <div className="lp-rail" />
      <div className="flex items-start gap-2">
        {compact && <CertThumb item={item} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="flex items-center gap-1 min-w-0">
              {draggable && <span className="shrink-0 cursor-grab text-text-muted hover:text-accent-cyan" title="Drag to reorder"><GripVertical size={12} /></span>}
              <button onClick={(e) => { e.stopPropagation(); onOpen(); }} className={`block text-left font-medium text-text-primary ${compact ? 'text-xs' : 'text-sm'} truncate`} title={`Open ${item.title}`}>{item.title}</button>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button onClick={(e) => { e.stopPropagation(); onFav(); }} title={item.favorite ? 'Remove from favorites' : 'Add to favorites'}>
                <Star size={compact ? 11 : 13} style={{ color: item.favorite ? '#facc15' : '#5d7f88', fill: item.favorite ? '#facc15' : 'none' }} />
              </button>
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge label={catLabel(item.category)} color={catC} />
            <Badge label={statusLabel(item.status)} color={statusColor(item.status)} />
            {(item.priority === 'high' || item.priority === 'critical') && (
              <Badge label={item.priority.toUpperCase()} color={PRIORITY_COLOR[item.priority] ?? '#5d7f88'} />
            )}
            {materialCount > 0 && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[9px]"
                style={{ color: '#26e2f6', border: '1px solid rgba(38,226,246,0.35)', padding: '1px 5px', background: 'rgba(38,226,246,0.06)' }}
                title={`${materialCount} study material${materialCount === 1 ? '' : 's'} attached`}
              >
                <Paperclip size={8} />{materialCount}
              </span>
            )}
          </div>
        </div>
      </div>
      {item.provider && <span className="mt-1 block font-mono text-xs text-text-muted">{item.provider}</span>}
      {!compact && item.status === 'completed' && item.image_base64 && (
        <div className="relative mt-2 overflow-hidden border" style={{ borderColor: 'rgba(74,222,128,0.4)', background: 'rgba(4,8,12,0.6)' }} title="Course certificate">
          {/* full certificate at natural aspect ratio — no fixed height, no empty space */}
          <div className="relative w-full cursor-zoom-in" onClick={(e) => { e.stopPropagation(); onCertClick?.(item); }} title="Click to view certificate full size">
            <img src={`data:${item.image_mime_type};base64,${item.image_base64}`} alt={`${item.title} certificate`} className="block w-full h-auto object-contain transition-opacity hover:opacity-90" loading="lazy" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-1.5 px-2 pb-1.5" style={{ background: 'linear-gradient(180deg, transparent, rgba(4,8,12,0.92))' }}>
              <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold tracking-wider" style={{ color: '#4ade80', border: '1px solid rgba(74,222,128,0.55)', background: 'rgba(4,8,12,0.85)', padding: '2px 8px' }}>
                <Check size={10} /> CERTIFIED
              </span>
              {item.score && (
                <span className="font-mono text-[13px] font-bold tracking-wide" style={{ color: '#facc15', border: '1px solid rgba(250,204,21,0.55)', background: 'rgba(4,8,12,0.85)', padding: '2px 10px', textShadow: '0 0 10px rgba(250,204,21,0.55)' }}>
                  ★ {item.score}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between text-xs text-text-muted"><span>Progress</span><span>{item.progress_percent}%</span></div>
        <ProgressRail value={item.progress_percent} color={catC} />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="font-mono text-xs text-text-muted">{fmtHours(item.hours_spent)}h studied{Number(item.estimated_hours) > 0 ? ` / ${item.estimated_hours}h planned` : ''}</span>
        <span className="flex items-center gap-1.5">
          {item.status === 'completed' && item.score && (
            <span className="font-mono text-[11px] font-bold" style={{ color: '#facc15', textShadow: '0 0 6px rgba(250,204,21,0.4)' }} title="Score">★ {item.score}</span>
          )}
          {item.target_end_date && item.status !== 'completed' && deadlineLabel(item.target_end_date)}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 border-t border-border-line pt-1">
        {safeLink(item.link) && (
          <a href={safeLink(item.link)} target="_blank" rel="noopener noreferrer" className="p-1 text-text-muted hover:text-accent-cyan" title="Open link" onClick={stop}>
            <ExternalLink size={13} />
          </a>
        )}
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-1 text-text-muted hover:text-accent-cyan" title="Edit">
          <Pencil size={13} />
        </button>
        {item.status !== 'completed' && (
          <button onClick={(e) => { e.stopPropagation(); onComplete(); }} className="p-1 text-text-muted hover:text-accent-cyan" title="Mark complete">
            <Check size={13} />
          </button>
        )}
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 text-text-muted hover:text-alert-red" title="Delete">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function Toast({ msg }: { msg: string }) {
  return (
    <div className="lp-toast" role="status">
      <Check size={12} className="text-accent-cyan" />
      <span>{msg}</span>
    </div>
  );
}

// Compact hours-by-category donut with side legend.
function CategoryDonut({ segs, total }: { segs: { label: string; value: number; color: string }[]; total: number }) {
  const size = 118;
  const r = 45;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle cx={cx} cy={cx} r={r + 6} fill="none" stroke="rgba(38,226,246,0.12)" strokeWidth="0.7" strokeDasharray="1.5 3.5" />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(45,212,191,0.08)" strokeWidth="10" />
        {total > 0 && segs.filter((s) => s.value > 0).map((s) => {
          const frac = s.value / total;
          const dash = Math.max(0, frac * c - 2);
          const off = -acc * c;
          acc += frac;
          return (
            <circle key={s.label} cx={cx} cy={cx} r={r} fill="none" stroke={s.color} strokeWidth="10"
              strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={off} transform={`rotate(-90 ${cx} ${cx})`}
              style={{ filter: `drop-shadow(0 0 3px ${s.color}66)`, transition: 'stroke-dasharray 0.7s ease' }} />
          );
        })}
        <text x={cx} y={cx - 1} textAnchor="middle" fill="#ddfeff" fontFamily="'JetBrains Mono', monospace" fontSize="17" fontWeight="700">{fmtHours(total)}h</text>
        <text x={cx} y={cx + 12} textAnchor="middle" fill="#5b6b80" fontFamily="'JetBrains Mono', monospace" fontSize="6" letterSpacing="2">FOCUS</text>
      </svg>
      <div className="min-w-0 flex-1 space-y-1">
        {segs.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 font-mono text-[10px]">
            <span className="inline-block shrink-0" style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, boxShadow: s.value ? `0 0 4px ${s.color}` : 'none', opacity: s.value ? 1 : 0.3 }} />
            <span className="min-w-0 flex-1 truncate" style={{ color: '#8fa8b8' }}>{s.label}</span>
            <span style={{ color: s.value ? '#c8d6e8' : '#5b6b80' }}>{fmtHours(s.value)}h</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────── page ──────────────────────────────── */

export function LearningTracker() {
  const [items, setItems] = useState<LearningItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const writeBusy = useRef(false);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [attentionFilter, setAttentionFilter] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>('updated');
  const [sortAsc, setSortAsc] = useState(false);
  const [view, setView] = useState<ViewMode>('board');
  const [studyMinutes, setStudyMinutes] = useState('25');
  const [studySession, setStudySession] = useState<{ itemId: string; startedAt: number; elapsed: number } | null>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('learning-study-session') ?? 'null');
      return stored && typeof stored.itemId === 'string' && stored.itemId && Number.isFinite(stored.elapsed) && stored.elapsed >= 0 ? { itemId: stored.itemId, elapsed: stored.elapsed, startedAt: Date.now() } : null;
    } catch { return null; }
  });
  const [studyRunning, setStudyRunning] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<LearningItem | null>(null);
  const [detailItem, setDetailItem] = useState<LearningItem | null>(null);
  const [progressDraft, setProgressDraft] = useState(0);
  const [certPreview, setCertPreview] = useState<LearningItem | null>(null);
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [fMatTitle, setFMatTitle] = useState('');
  const [fMatUrl, setFMatUrl] = useState('');
  const [matBusy, setMatBusy] = useState(false);
  const materialFileRef = useRef<HTMLInputElement>(null);
  const [deleteMatId, setDeleteMatId] = useState<string | null>(null);
  const [editingMatId, setEditingMatId] = useState<string | null>(null);
  const [fMatEditTitle, setFMatEditTitle] = useState('');
  const [fMatEditUrl, setFMatEditUrl] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [importError, setImportError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gRef = useRef<HTMLInputElement>(null);
  const [gQuery, setGQuery] = useState('');
  const [gOpen, setGOpen] = useState(false);
  const [dragId, setDragId] = useState<string|null>(null);

  // form state
  const [fTitle, setFTitle] = useState('');
  const [fProvider, setFProvider] = useState('');
  const [fStatus, setFStatus] = useState('not_started');
  const [fProgress, setFProgress] = useState(0);
  const [fStart, setFStart] = useState('');
  const [fEnd, setFEnd] = useState('');
  const [fLink, setFLink] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [fCategory, setFCategory] = useState('course');
  const [fPriority, setFPriority] = useState<PRIORITY>('medium');
  const [fTags, setFTags] = useState('');
  const [fEstHours, setFEstHours] = useState(0);
  const [fHoursSpent, setFHoursSpent] = useState(0);
  const [fCompletedAt, setFCompletedAt] = useState('');
  const [fScore, setFScore] = useState('');
  const [notesMode, setNotesMode] = useState<'edit' | 'preview'>('edit');
  const [fImageMime, setFImageMime] = useState('');
  const [fImageBase64, setFImageBase64] = useState('');
  const [imageError, setImageError] = useState('');
  const imageDirtyRef = useRef(false);
  const imageLoadId = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number>();

  const notify = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
    const { data, error } = await supabase
      .from('learning_items')
      .select(
        'id,title,provider,status,progress_percent,start_date,target_end_date,link,notes,created_at,updated_at,category,priority,tags,favorite,estimated_hours,hours_spent,completed_at,score,image_mime_type,sort_order',
      )
      .order('sort_order', { ascending: true })
      .order('updated_at', { ascending: false });
    if (error) { setLoadError('Your learning library could not be loaded. Try again.'); setLoading(false); return; }
    setItems((data ?? []) as LearningItem[]);
    setLoading(false);
    const { data: mats, error: materialError } = await supabase
      .from('learning_materials')
      .select('id,item_id,kind,title,url,file_name,mime_type,size_bytes');
    if (!materialError) setMaterials((mats ?? []) as LearningMaterial[]);
    if (materialError) setLoadError('Learning items loaded, but study materials could not be loaded. Retry to recover them.');
    // pull certificate images for completed items so cards can showcase them
    const { data: certs } = await supabase
      .from('learning_items')
      .select('id,image_base64')
      .eq('status', 'completed')
      .not('image_base64', 'is', null);
    if (certs && certs.length > 0) {
      const certMap: Record<string, string> = {};
      for (const c of certs) certMap[c.id] = c.image_base64 ?? '';
      setItems((prev) => prev.map((i) => (certMap[i.id] ? { ...i, image_base64: certMap[i.id] } : i)));
    }
    } catch { setLoadError('Your learning library could not be loaded. Check your connection and try again.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!certPreview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCertPreview(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [certPreview]);

  // One write path keeps progress, completion and failures consistent across controls.
  const patchItem = useCallback(async (item: LearningItem, fields: Partial<LearningItem>) => {
    if (writeBusy.current) return false;
    writeBusy.current = true;
    setSaving(true);
    setSaveError('');
    try {
    const payload = { ...fields, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('learning_items').update(payload).eq('id', item.id).select('id').single();
    if (error) { setSaveError('Changes could not be saved. Your previous values are preserved. Try again.'); return false; }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...payload } : i)));
    setDetailItem((d) => (d && d.id === item.id ? { ...d, ...payload } : d));
    notify('Saved');
    return true;
    } catch { setSaveError('Changes could not be saved. Check your connection and try again.'); return false; }
    finally { writeBusy.current = false; setSaving(false); }
  }, [notify]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), studyRunning ? 1000 : 60000);
    return () => clearInterval(timer);
  }, [studyRunning]);

  const sessionElapsed = studySession ? studyElapsed(studySession, studyRunning, clockNow) : 0;
  useEffect(() => {
    const persist = () => {
      try {
        if (studySession) sessionStorage.setItem('learning-study-session', JSON.stringify({ itemId: studySession.itemId, elapsed: studyElapsed(studySession, studyRunning) }));
        else sessionStorage.removeItem('learning-study-session');
      } catch { /* The active timer still works when browser storage is unavailable. */ }
    };
    persist();
    return persist;
  }, [studySession, studyRunning, sessionElapsed]);
  const pauseStudy = () => {
    if (!studySession) return;
    setStudySession({ ...studySession, elapsed: studyElapsed(studySession, studyRunning) });
    setStudyRunning(false);
  };
  const startStudy = (item: LearningItem) => {
    if (studySession && studySession.itemId !== item.id) { notify('Save or discard your current study session first.'); setDetailItem(items.find((i) => i.id === studySession.itemId) ?? null); return; }
    setClockNow(Date.now());
    setStudySession({ itemId: item.id, startedAt: Date.now(), elapsed: studySession ? studyElapsed(studySession, studyRunning) : 0 });
    setStudyRunning(true);
    setDetailItem(item);
  };
  const logStudy = async (item: LearningItem, minutes: number) => {
    try {
    const fields: Partial<LearningItem> = { hours_spent: studyHours(Number(item.hours_spent), minutes) };
      if (item.status === 'not_started') Object.assign(fields, { status: 'in_progress', start_date: item.start_date ?? new Date().toISOString() });
      return await patchItem(item, fields);
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'Unable to save study time.'); return false; }
  };
  const saveStudy = async () => {
    if (!studySession) return;
    const item = items.find((i) => i.id === studySession.itemId);
    const elapsed = studyElapsed(studySession, studyRunning);
    setStudySession({ ...studySession, elapsed });
    setStudyRunning(false);
    if (item && await logStudy(item, elapsed / 60000)) setStudySession(null);
  };

  useEffect(() => {
    if (!studySession) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [studySession]);

  useEffect(() => {
    void load();
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [load]);

  useEffect(() => { setProgressDraft(detailItem?.progress_percent ?? 0); setStudyMinutes('25'); }, [detailItem?.id, detailItem?.progress_percent]);

  const materialsOf = useCallback((id: string) => materials.filter((m) => m.item_id === id), [materials]);
  const materialCountOf = useCallback((id: string) => materials.reduce((n, m) => (m.item_id === id ? n + 1 : n), 0), [materials]);

  const addMaterialLink = async () => {
    if (matBusy || !detailItem || !fMatTitle.trim() || !fMatUrl.trim()) return;
    if (!safeLink(fMatUrl.trim())) { notify('Use a valid http or https reference link.'); return; }
    setMatBusy(true);
    try {
    const { data, error } = await supabase
      .from('learning_materials')
      .insert({ item_id: detailItem.id, kind: 'link', title: fMatTitle.trim(), url: fMatUrl.trim() })
      .select('id,item_id,kind,title,url,file_name,mime_type,size_bytes')
      .single();
    if (error || !data) { notify('Could not add link'); return; }
    setMaterials((prev) => [...prev, data as LearningMaterial]);
    setFMatTitle(''); setFMatUrl('');
    notify('Reference link attached');
    } catch { notify('Could not add link. Check your connection and try again.'); }
    finally { setMatBusy(false); }
  };

  const handleMaterialFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !detailItem) return;
    if (file.size > MAX_MATERIAL_SIZE) { notify(`MAX SIZE ${MAX_MATERIAL_SIZE / 1024 / 1024}MB`); return; }
    setMatBusy(true);
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] ?? '');
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const { data, error } = await supabase
        .from('learning_materials')
        .insert({
          item_id: detailItem.id, kind: 'file', title: file.name, file_name: file.name,
          mime_type: file.type || 'application/octet-stream', size_bytes: file.size, data_base64: b64,
        })
        .select('id,item_id,kind,title,url,file_name,mime_type,size_bytes')
        .single();
      if (error || !data) { notify('Upload failed'); return; }
      setMaterials((prev) => [...prev, data as LearningMaterial]);
      notify('File attached');
    } catch {
      notify('The file could not be attached. Try again.');
    } finally {
      setMatBusy(false);
    }
  };

  const downloadMaterial = async (m: LearningMaterial) => {
    const { data } = await supabase.from('learning_materials').select('data_base64,mime_type,file_name').eq('id', m.id).single();
    if (!data?.data_base64) { notify('No file data stored'); return; }
    const bytes = Uint8Array.from(atob(data.data_base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: data.mime_type ?? 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data.file_name ?? m.title;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Download started');
  };

  const removeMaterial = async () => {
    if (!deleteMatId) return;
    const { error } = await supabase.from('learning_materials').delete().eq('id', deleteMatId);
    if (error) { notify('Material could not be removed. Try again.'); return; }
    setMaterials((prev) => prev.filter((m) => m.id !== deleteMatId));
    setDeleteMatId(null);
    notify('Material removed');
  };

  const startMaterialEdit = (m: LearningMaterial) => {
    setEditingMatId(m.id);
    setFMatEditTitle(m.title);
    setFMatEditUrl(m.url ?? '');
  };

  const saveMaterialEdit = async () => {
    if (!editingMatId) return;
    const title = fMatEditTitle.trim();
    if (!title) { setEditingMatId(null); return; }
    const m = materials.find((x) => x.id === editingMatId);
    const patch: Partial<LearningMaterial> = { title };
    if (m?.kind === 'link' && !safeLink(fMatEditUrl.trim())) { notify('Use a valid http or https reference link.'); return; }
    if (m?.kind === 'link' && fMatEditUrl.trim()) patch.url = fMatEditUrl.trim();
    const { error } = await supabase.from('learning_materials').update(patch).eq('id', editingMatId);
    if (error) { notify('Update failed'); return; }
    setMaterials((prev) => prev.map((x) => (x.id === editingMatId ? { ...x, ...patch } : x)));
    setEditingMatId(null);
    notify('Material updated');
  };

  // lazily fetch certificate image for the open detail modal
  useEffect(() => {
    if (!detailItem || !detailItem.image_mime_type || detailItem.image_base64) return;
    let active = true;
    void (async () => {
      const { data } = await supabase.from('learning_items').select('image_base64').eq('id', detailItem.id).single();
      if (active && data?.image_base64) {
        setDetailItem((prev) => (prev?.id === detailItem.id ? { ...prev, image_base64: data.image_base64 as string } : prev));
      }
    })();
    return () => {
      active = false;
    };
  }, [detailItem]);

  /* ── derived data ─────────────────────────────────────────────── */

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) for (const t of it.tags) set.add(t);
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items.filter((it) => {
      if (catFilter && it.category !== catFilter) return false;
      if (statusFilter && it.status !== statusFilter) return false;
      if (attentionFilter === 'overdue' && !isOverdue(it)) return false;
      if (attentionFilter === 'priority' && (it.status === 'completed' || !['high', 'critical'].includes(it.priority))) return false;
      if (attentionFilter === 'due' && (it.status === 'completed' || (learningDeadline(it.target_end_date, clockNow) ?? Infinity) < 0 || (learningDeadline(it.target_end_date, clockNow) ?? Infinity) > 7 * 86400000)) return false;
      if (favOnly && !it.favorite) return false;
      if (q) {
        const hay = `${it.title} ${it.provider ?? ''} ${it.notes ?? ''} ${it.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sortAsc) [a, b] = [b, a];
      switch (sort) {
        case 'manual': return a.sort_order - b.sort_order;
        case 'priority': return PRIORITIES.indexOf(b.priority as PRIORITY) - PRIORITIES.indexOf(a.priority as PRIORITY);
        case 'progress':
          return b.progress_percent - a.progress_percent;
        case 'target':
          return (a.target_end_date ?? '9999-12-31').localeCompare(b.target_end_date ?? '9999-12-31');
        case 'title':
          return a.title.localeCompare(b.title);
        default:
          return b.updated_at.localeCompare(a.updated_at);
      }
    });
    return list;
  }, [items, search, catFilter, statusFilter, attentionFilter, favOnly, sort, sortAsc, clockNow]);

  /** hero lane: courses & certifications in progress */
  const inProgressHero = useMemo(
    () =>
      [...filtered]
        .filter((it) => it.status !== 'completed')
        .sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || PRIORITIES.indexOf(b.priority as PRIORITY) - PRIORITIES.indexOf(a.priority as PRIORITY) || Number(b.status === 'in_progress') - Number(a.status === 'in_progress') || (a.target_end_date ?? '9999').localeCompare(b.target_end_date ?? '9999')),
    [filtered],
  );

  const stats = useMemo(() => {
    const total = items.length;
    const inProgress = items.filter((i) => i.status === 'in_progress').length;
    const completed = items.filter((i) => i.status === 'completed').length;
    const avgProgress = total ? Math.round(items.reduce((a, i) => a + i.progress_percent, 0) / total) : 0;
    const hours = items.reduce((a, i) => a + Number(i.hours_spent || 0), 0);
    const completionRate = total ? Math.round((completed / total) * 100) : 0;
    const remainingHours = items.filter((i) => i.status !== 'completed').reduce((a, i) => a + Math.max(0, Number(i.estimated_hours) - Number(i.hours_spent)), 0);
    return { total, inProgress, completed, avgProgress, hours, completionRate, remainingHours };
  }, [items]);

  const categoryMix = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of items) counts[it.category] = (counts[it.category] ?? 0) + Number(it.hours_spent || 0);
    return CATEGORIES.map((c) => ({ label: c.label, value: counts[c.value] ?? 0, color: CATEGORY_COLOR[c.value] ?? '#5d7f88' }));
  }, [items]);

  const overdueCount = useMemo(() => items.filter((item) => isOverdue(item, clockNow)).length, [items, clockNow]);
  const upcoming = useMemo(
    () =>
      items.filter(
        (it) => it.target_end_date && it.status !== 'completed' && (learningDeadline(it.target_end_date, clockNow) ?? Infinity) >= 0 && (learningDeadline(it.target_end_date, clockNow) ?? Infinity) <= 7 * 86400000,
      ).length,
    [items, clockNow],
  );

  /* ── mutations ──────────────────────────────────────────────────── */

  const toggleFav = async (item: LearningItem) => {
    await patchItem(item, { favorite: !item.favorite });
  };

  const completeItem = async (item: LearningItem) => {
    if (await patchItem(item, learningProgress(100, item.completed_at))) notify(`${item.title} marked complete`);
  };

  const openAdd = useCallback(() => {
    setSaveError('');
    imageLoadId.current = null;
    setEditItem(null);
    setFTitle(''); setFProvider(''); setFStatus('not_started'); setFProgress(0);
    setFStart(''); setFEnd(''); setFLink(''); setFNotes('');
    setFCategory('course'); setFPriority('medium'); setFTags('');
    setFEstHours(0); setFHoursSpent(0); setFCompletedAt(''); setFScore('');
    setFImageMime(''); setFImageBase64(''); setImageError('');
    imageDirtyRef.current = false;
    setNotesMode('edit');
    setShowModal(true);
  }, []);

  const openEdit = (item: LearningItem) => {
    try {
    setSaveError('');
    setEditItem(item);
    imageLoadId.current = item.id;
    setFTitle(item.title ?? '');
    setFProvider(item.provider ?? '');
    setFStatus(item.status ?? 'not_started');
    setFProgress(Number(item.progress_percent ?? 0));
    setFStart(item.start_date ? String(item.start_date).split('T')[0] : '');
    setFEnd(item.target_end_date ? String(item.target_end_date).split('T')[0] : '');
    setFLink(item.link ?? '');
    setFNotes(item.notes ?? '');
    setFCategory(item.category || 'course');
    setFPriority((item.priority || 'medium') as PRIORITY);
    setFTags((item.tags ?? []).join(', '));
    setFEstHours(Number(item.estimated_hours ?? 0));
    setFHoursSpent(Number(item.hours_spent ?? 0));
    setFCompletedAt(item.completed_at ? String(item.completed_at).split('T')[0] : '');
    setFScore(item.score ?? '');
    setFImageMime('');
    setFImageBase64('');
    setImageError('');
    imageDirtyRef.current = false;
    setNotesMode('edit');
    setDetailItem(null);
    setShowModal(true);
    if (item.image_mime_type) {
      void (async () => {
        const { data } = await supabase.from('learning_items').select('image_base64').eq('id', item.id).single();
        if (data?.image_base64 && imageLoadId.current === item.id && !imageDirtyRef.current) {
          setFImageBase64(data.image_base64 as string);
          setFImageMime(item.image_mime_type as string);
        }
      })();
    }
    } catch (err) {
      console.error('openEdit failed:', err);
      notify('Could not open editor — check console');
    }
  };

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return void setImageError('ONLY IMAGE FILES ARE SUPPORTED');
    if (file.size > MAX_IMAGE_SIZE) return void setImageError(`MAX IMAGE SIZE IS ${MAX_IMAGE_SIZE / 1024 / 1024}MB`);
    setImageError('');
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const b64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
      imageDirtyRef.current = true;
      setFImageBase64(b64);
      setFImageMime(file.type || 'image/png');
    };
    reader.onerror = () => setImageError('The certificate image could not be read. Choose the file again.');
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    imageDirtyRef.current = true;
    setFImageBase64('');
    setFImageMime('');
    setImageError('');
  };

  const save = async () => {
    if (!fTitle.trim() || writeBusy.current) return;
    if (![fEstHours, fHoursSpent, fProgress].every((n) => Number.isFinite(n) && n >= 0) || !Number.isInteger(fEstHours)) { setSaveError('Hours cannot be negative, and planned hours must be a whole number.'); return; }
    if (fLink.trim() && !safeLink(fLink.trim())) { setSaveError('Use a valid http or https course link.'); return; }
    if (fStart && fEnd && fEnd < fStart) { setSaveError('The target date must be on or after the start date.'); return; }
    writeBusy.current = true;
    setSaving(true);
    setSaveError('');
    try {
    const isCompleted = fStatus === 'completed';
    const tags = fTags.split(',').map((t) => t.trim()).filter(Boolean);
    const payload = {
      title: fTitle.trim(),
      provider: fProvider.trim() || null,
      ...learningProgress(learningStatusProgress(fStatus, fProgress), editItem?.completed_at ?? null),
      status: fStatus,
      start_date: fStart || null,
      target_end_date: fEnd || null,
      link: fLink.trim() || null,
      notes: fNotes.trim() || null,
      category: fCategory,
      priority: fPriority,
      tags,
      estimated_hours: fEstHours,
      hours_spent: fHoursSpent,
      completed_at: isCompleted ? (fCompletedAt ? editItem?.completed_at?.slice(0, 10) === fCompletedAt ? editItem.completed_at : `${fCompletedAt}T00:00:00.000Z` : new Date().toISOString()) : null,
      score: isCompleted ? fScore.trim() || null : null,
      updated_at: new Date().toISOString(),
      ...((!editItem || imageDirtyRef.current) ? { image_mime_type: fImageMime || null, image_base64: fImageBase64 || null } : {}),
    };
    if (editItem) {
      const { data, error } = await supabase.from('learning_items').update(payload).eq('id', editItem.id).select().single();
      if (error || !data) { setSaveError('The learning item could not be updated. Your edits are still here; try again.'); return; }
      setItems((prev) => prev.map((i) => (i.id === data.id ? (data as LearningItem) : i)));
      notify('Item updated');
    } else {
      const minOrder = items.length ? Math.min(...items.map(x=>x.sort_order??0)) : 0;
      const { data, error } = await supabase.from('learning_items').insert({...payload, sort_order: minOrder-1}).select().single();
      if (error || !data) { setSaveError('The learning item could not be created. Your edits are still here; try again.'); return; }
      if (data) setItems((prev) => [data as LearningItem, ...prev]);
      notify('Item created');
    }
    setShowModal(false);
    } catch { setSaveError('The learning item could not be saved. Check your connection and try again.'); }
    finally { writeBusy.current = false; setSaving(false); }
  };

  const duplicate = async (item: LearningItem) => {
    const { data: full } = await supabase.from('learning_items').select('*').eq('id', item.id).single();
    const src = (full ?? item) as LearningItem;
    const minOrder = items.length ? Math.min(...items.map(x=>x.sort_order??0)) : 0;
    const { data, error } = await supabase
      .from('learning_items')
      .insert({
        title: `${item.title} (copy)`,
        provider: item.provider,
        status: item.status,
        progress_percent: item.progress_percent,
        start_date: item.start_date,
        target_end_date: item.target_end_date,
        link: item.link,
        notes: item.notes,
        category: item.category,
        priority: item.priority,
        tags: item.tags,
        favorite: false,
        estimated_hours: item.estimated_hours,
        hours_spent: item.hours_spent,
        completed_at: item.completed_at,
        score: item.score,
        image_mime_type: src.image_mime_type,
        image_base64: src.image_base64,
        sort_order: minOrder-1,
      })
      .select()
      .single();
    if (error || !data) { setSaveError('The learning item could not be duplicated. Try again.'); return; }
    if (data) setItems((prev) => [data as LearningItem, ...prev]);
    notify('Item duplicated');
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('learning_items').delete().eq('id', deleteId);
    if (error) { setSaveError('The learning item could not be deleted. Try again.'); return; }
    if (studySession?.itemId === deleteId) { setStudySession(null); setStudyRunning(false); }
    setItems((prev) => prev.filter((i) => i.id !== deleteId));
    setMaterials((prev) => prev.filter((m) => m.item_id !== deleteId));
    setDeleteId(null);
    setDetailItem(null);
    notify('Item deleted');
  };

  const onDragStart = (id:string)=>setDragId(id);
  const onDragOver = (e:React.DragEvent)=>e.preventDefault();
  const onDrop = async (targetId: string) => {
    const sourceId = dragId;
    setDragId(null);
    if (!sourceId || sourceId === targetId || writeBusy.current) return;
    if (sort !== 'manual' || sortAsc) { notify('Choose My Order in its default direction before dragging.'); return; }
    const source = filtered.findIndex((item) => item.id === sourceId);
    const target = filtered.findIndex((item) => item.id === targetId);
    if (source < 0 || target < 0) return;
    const reordered = [...filtered];
    const [moved] = reordered.splice(source, 1);
    reordered.splice(target, 0, moved);
    const visibleIds = new Set(filtered.map((item) => item.id));
    let index = 0;
    const ordered = [...items].sort((a, b) => a.sort_order - b.sort_order).map((item) => visibleIds.has(item.id) ? reordered[index++] : item);
    writeBusy.current = true;
    setSaving(true);
    const results = await Promise.all(ordered.map((item, sort_order) => supabase.from('learning_items').update({ sort_order }).eq('id', item.id)));
    writeBusy.current = false;
    setSaving(false);
    if (results.some((result) => result.error)) { setSaveError('The order could not be fully saved. Your persisted library has been reloaded.'); await load(); return; }
    setItems(ordered.map((item, sort_order) => ({ ...item, sort_order })));
    setSortAsc(false);
    notify('Learning order saved');
  };

  const exportJSON = async () => {
    if (filtered.length === 0) return;
    try {
    const { data, error } = await supabase.from('learning_items').select('id,image_base64').in('id', filtered.filter((item) => item.image_mime_type).map((item) => item.id));
    if (error) { setSaveError('Certificates could not be exported. Try again.'); return; }
    const images = new Map((data ?? []).map((item: {id:string;image_base64:string|null}) => [item.id, item.image_base64]));
    const blob = new Blob([JSON.stringify(filtered.map((item) => ({ ...item, image_base64: images.get(item.id) ?? item.image_base64 ?? null })), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hephastos-learning-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    } catch { setSaveError('The learning library could not be exported. Check your connection and try again.'); }
  };

  const importJSON = (file: File) => {
    setImportError('');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? ''));
        if (!Array.isArray(parsed)) throw new Error('not array');
        const valid = parsed.filter((it) => it && typeof it.title === 'string' && it.title.trim());
        if (valid.length === 0) throw new Error('no valid items');
        let imported = 0;
        for (const it of valid) {
          const status = typeof it.status === 'string' && STATUSES.some((s) => s.id === it.status) ? it.status : 'not_started';
          const progress = typeof it.progress_percent === 'number' && Number.isFinite(it.progress_percent) ? Math.max(0, Math.round(it.progress_percent)) : 0;
          const { error } = await supabase.from('learning_items').insert({
            title: it.title.trim(),
            provider: typeof it.provider === 'string' && it.provider.trim() ? it.provider.trim() : null,
            category:
              typeof it.category === 'string' && CATEGORIES.some((c) => c.value === it.category) ? it.category : 'course',
            status,
            priority:
              typeof it.priority === 'string' && PRIORITIES.includes(it.priority as PRIORITY)
                ? it.priority
                : 'medium',
            progress_percent: learningStatusProgress(status, progress),
            tags: Array.isArray(it.tags) ? it.tags.filter((t: unknown) => typeof t === 'string').slice(0, 12) : [],
            estimated_hours: typeof it.estimated_hours === 'number' && Number.isFinite(it.estimated_hours) ? Math.max(0, Math.round(it.estimated_hours)) : 0,
            hours_spent: typeof it.hours_spent === 'number' && Number.isFinite(it.hours_spent) ? Math.max(0, it.hours_spent) : 0,
            start_date: typeof it.start_date === 'string' && it.start_date ? it.start_date : null,
            target_end_date: typeof it.target_end_date === 'string' && it.target_end_date ? it.target_end_date : null,
            link: typeof it.link === 'string' ? safeLink(it.link.trim()) ?? null : null,
            notes: typeof it.notes === 'string' && it.notes.trim() ? it.notes.trim() : null,
            completed_at: it.status === 'completed' ? typeof it.completed_at === 'string' && Number.isFinite(Date.parse(it.completed_at)) ? it.completed_at : new Date().toISOString() : null,
            score: typeof it.score === 'string' ? it.score : null,
            favorite: it.favorite === true,
            image_mime_type:
              typeof it.image_mime_type === 'string' && typeof it.image_base64 === 'string' ? it.image_mime_type : null,
            image_base64:
              typeof it.image_mime_type === 'string' && typeof it.image_base64 === 'string' ? it.image_base64 : null,
          });
          if (error) { await load(); setImportError(`Imported ${imported} of ${valid.length} items. The next item could not be saved. Check your connection before retrying to avoid duplicates.`); return; }
          imported += 1;
        }
        void load();
        notify(`${valid.length} items imported`);
      } catch {
        setImportError('INVALID JSON FILE — EXPECTED AN ARRAY OF LEARNING ITEMS');
      }
    };
    reader.onerror = () => setImportError('This file could not be read. Choose the file again.');
    reader.readAsText(file);
  };

  /* ── global jump-to search ─────────────────────────────── */

  const closeG = () => {
    setGOpen(false);
    setGQuery('');
  };

  const globalResults = useMemo(() => {
    const q = gQuery.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((it) => {
        const hay = `${it.title} ${it.provider ?? ''} ${it.notes ?? ''} ${it.tags.join(' ')}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [gQuery, items]);

  useEffect(() => {
    if (gOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (detailItem || showModal || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = eventTarget(e) as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === '/') {
        e.preventDefault();
        gRef.current?.focus();
        setGOpen(true);
      } else if (e.key === 'Escape') {
        setGOpen(false);
        setGQuery('');
        setDetailItem(null);
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openAdd();
      } else if (/^[1-3]$/.test(e.key)) {
        const tabs: ViewMode[] = ['in_progress', 'board', 'list'];
        setView(tabs[parseInt(e.key, 10) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gOpen, openAdd, detailItem, showModal]);

  const sortHeaders: { k: SortMode | null; l: string }[] = [
    { k: 'title', l: 'Title' },
    { k: null, l: 'Category' },
    { k: null, l: 'Provider' },
    { k: null, l: 'Status' },
    { k: null, l: 'Priority' },
    { k: 'progress', l: 'Progress' },
    { k: null, l: 'Hours' },
    { k: 'target', l: 'Target' },
  ];

  return (
    <PageContainer className="learning-workspace">
      {toast && <Toast msg={toast} />}

      <PageHeader
        title="Learning Tracker"
        subtitle="A focused home for your skills, study time and achievements."
        actions={
          <HudButton size="sm" onClick={openAdd}>
            <Plus size={14} className="mr-1 inline" />
            Add learning
          </HudButton>
        }
      />

      <div className="learning-intro">
        <div><span className="learning-eyebrow">YOUR LEARNING WORKSPACE</span><p>Build skills with a clear next step.</p></div>
        <div className="learning-intro-note"><BookOpen size={16} /><span>Courses, books, certifications & everything you are learning.</span></div>
      </div>
      {loadError && <div className="learning-error" role="alert"><AlertCircle size={18} /><span>{loadError}</span><HudButton size="sm" variant="ghost" onClick={() => void load()}>Retry</HudButton></div>}
      {saveError && <div className="learning-error" role="alert"><AlertCircle size={18} /><span>{saveError}</span><button onClick={() => setSaveError('')} aria-label="Dismiss save error"><X size={16} /></button></div>}
      {studySession && <div className="learning-session" role="status">
        <Clock size={18} /><div><strong>{items.find((i) => i.id === studySession.itemId)?.title ?? 'Study session'}</strong><span>{studyRunning ? 'Session running' : 'Session paused'} · {Math.floor(sessionElapsed / 60000)}:{String(Math.floor(sessionElapsed / 1000) % 60).padStart(2, '0')}</span></div>
        <HudButton size="sm" variant="ghost" onClick={() => { const item = items.find((i) => i.id === studySession.itemId); if (item) setDetailItem(item); }}>Open session</HudButton>
        <HudButton size="sm" variant="ghost" onClick={studyRunning ? pauseStudy : () => { const item = items.find((i) => i.id === studySession.itemId); if (item) startStudy(item); }}>{studyRunning ? 'Pause' : 'Resume'}</HudButton>
        <HudButton size="sm" onClick={() => void saveStudy()} disabled={saving || sessionElapsed < 1000}>Save time</HudButton>
        <HudButton size="sm" variant="ghost" onClick={() => { setStudySession(null); setStudyRunning(false); }}>Discard time</HudButton>
      </div>}

      <div className="learning-metrics">
        <button onClick={() => { setStatusFilter('in_progress'); setAttentionFilter(''); }}><span><Play size={16} /> In progress</span><strong>{stats.inProgress}</strong><small>Learning journeys underway</small></button>
        <button onClick={() => { setStatusFilter('completed'); setAttentionFilter(''); }}><span><Check size={16} /> Completed</span><strong>{stats.completed}<em> / {stats.total}</em></strong><small>{stats.completionRate}% of your library</small></button>
        <div><span><Clock size={16} /> Study time</span><strong>{fmtHours(stats.hours)}<em> hours</em></strong><small>{fmtHours(stats.remainingHours)}h remaining against your estimates</small></div>
        <button onClick={() => { setStatusFilter(''); setAttentionFilter('overdue'); }}><span><Target size={16} /> Needs attention</span><strong>{overdueCount}<em> overdue</em></strong><small>{upcoming} due in the next 7 days</small></button>
      </div>

      <div className="learning-focus-layout">
        <section className="learning-focus">
          <div className="learning-section-heading"><div><span className="learning-eyebrow">KEEP YOUR MOMENTUM</span><h2>Continue learning</h2></div><GraduationCap size={26} /></div>
          {loading ? <p>Finding your next step…</p> : inProgressHero[0] ? (() => {
            const item = inProgressHero[0];
            return <div className="learning-focus-body">
              <div className="flex flex-wrap gap-2"><Badge label={catLabel(item.category)} color={CATEGORY_COLOR[item.category]} /><Badge label={statusLabel(item.status)} color={statusColor(item.status)} />{isOverdue(item) && <Badge label="Overdue" color="#f87171" />}</div>
              <h3>{item.title}</h3><p>{item.provider || 'Your next learning milestone'}{item.target_end_date ? ` · Target ${formatDate(item.target_end_date)}` : ''}</p>
              <div className="learning-focus-progress"><ProgressRail value={item.progress_percent} color="#26e2f6" /><span>{item.progress_percent}%</span></div>
              <div className="learning-focus-meta"><span><Clock size={14} />{fmtHours(item.hours_spent)}h studied</span><span><Paperclip size={14} />{materialCountOf(item.id)} materials</span></div>
              <div className="flex flex-wrap gap-2"><HudButton onClick={() => startStudy(item)} disabled={saving}><Play size={14} className="mr-2 inline" />Start study session</HudButton><HudButton variant="ghost" onClick={() => setDetailItem(item)}>Open workspace <ArrowUpRight size={14} className="ml-1 inline" /></HudButton>{safeLink(item.link) && <a className="learning-course-link" href={safeLink(item.link)} target="_blank" rel="noopener noreferrer">Open course <ExternalLink size={14} /></a>}</div>
            </div>;
          })() : <div className="learning-focus-empty"><BookOpen size={28} /><h3>{items.length ? 'A fresh learning chapter' : 'Make room for your next skill'}</h3><p>{items.length ? 'No unfinished items match these filters. Explore your library or add a new goal.' : 'Add your first course, book or certification, then track time, progress and materials here.'}</p><HudButton onClick={openAdd}><Plus size={14} className="mr-1 inline" />Add learning goal</HudButton></div>}
        </section>
        <section className="learning-next">
          <div className="learning-section-heading"><div><span className="learning-eyebrow">A CLEAR NEXT STEP</span><h2>Up next</h2></div><span className="text-xs text-text-muted">{inProgressHero.length} active</span></div>
          <p className="learning-next-hint">Overdue goals first, then priority and active learning.</p>
          {inProgressHero.slice(0, 4).map((item) => <button className="learning-next-row" key={item.id} onClick={() => setDetailItem(item)}><span className="learning-next-icon"><BookOpen size={17} /></span><span><strong>{item.title}</strong><small>{isOverdue(item) ? 'Overdue · ' : ''}{item.priority} priority · {item.progress_percent}% complete{item.target_end_date ? ` · ${formatDate(item.target_end_date)}` : ''}</small></span><ArrowUpRight size={16} /></button>)}
          {!inProgressHero.length && <p className="learning-next-hint">Your queue is clear. New learning goals appear here.</p>}
        </section>
      </div>

      <div className="learning-library-heading"><div><span className="learning-eyebrow">EVERYTHING IN ONE PLACE</span><h2>Your learning library</h2></div><span>{filtered.length} of {items.length} items</span></div>
      {/* ── toolbar ── */}
      <div className="learning-toolbar mb-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <HudInput
            value={search}
            aria-label="Search learning library"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, provider, notes, or tags..."
            className="pl-8"
          />
        </div>
        <HudSelect aria-label="Filter category" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="w-40">
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </HudSelect>
        <HudSelect aria-label="Filter attention" value={attentionFilter} onChange={(e) => setAttentionFilter(e.target.value)}>
          <option value="">Any deadline / priority</option><option value="overdue">Overdue</option><option value="due">Due in 7 days</option><option value="priority">High / critical priority</option>
        </HudSelect>
        <HudSelect aria-label="Sort learning library" value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="w-44">
          <option value="updated">Recently Updated</option>
          <option value="progress">Most Progress</option>
          <option value="target">Target Date</option>
          <option value="title">Title A-Z</option>
          <option value="priority">Highest Priority</option>
          <option value="manual">My Order</option>
        </HudSelect>
        <button
          onClick={() => setSortAsc((v) => !v)}
          className={`hud-btn clip-corner-small px-2.5 py-2 font-display text-xs uppercase tracking-wider ${sortAsc ? 'text-accent-cyan-glow' : ''}`}
          style={sortAsc ? { borderColor: '#26e2f6' } : undefined}
          title={sortAsc ? 'Reversed order' : 'Default order'}
          aria-label="Reverse sort order"
          aria-pressed={sortAsc}
        >
          {sortAsc ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <button
          onClick={() => setFavOnly((v) => !v)}
          aria-pressed={favOnly}
          className={`hud-btn clip-corner-small px-3 py-2.5 font-display text-xs uppercase tracking-wider ${favOnly ? 'text-accent-cyan-glow' : ''}`}
          style={favOnly ? { borderColor: '#facc15' } : undefined}
        >
          <Star size={13} className="mr-1.5 inline" style={{ color: '#facc15', fill: favOnly ? '#facc15' : 'none' }} />Favorites
        </button>
        <div className="flex border border-border-line">
          <button aria-pressed={view === 'in_progress'} onClick={() => { setView('in_progress'); setStatusFilter('in_progress'); }} className={`px-2.5 py-2 font-mono text-xs ${view === 'in_progress' ? 'text-accent-cyan' : 'text-text-muted'}`} title="In Progress"><Clock size={16} /></button>
          <button aria-pressed={view === 'board'} onClick={() => setView('board')} className={`px-2.5 py-2 font-mono text-xs ${view === 'board' ? 'text-accent-cyan' : 'text-text-muted'}`} title="Board"><LayoutGrid size={16} /></button>
          <button aria-pressed={view === 'list'} onClick={() => setView('list')} className={`px-2.5 py-2 font-mono text-xs ${view === 'list' ? 'text-accent-cyan' : 'text-text-muted'}`} title="List"><LayoutList size={16} /></button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJSON(f); e.target.value = ''; }} />
          <HudButton size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}><Upload size={14} className="mr-1 inline" />Import</HudButton>
          <HudButton size="sm" variant="ghost" onClick={exportJSON} disabled={filtered.length === 0}><Download size={14} className="mr-1 inline" />Export</HudButton>
        </div>
      </div>
      {importError && <div className="mb-3 border px-3 py-2 font-mono text-sm" style={{ borderColor: 'rgba(217,45,45,0.5)', color: '#f87171' }}>{importError}</div>}

      <div className="learning-filter-tabs" aria-label="Filter learning status">
        {[{ id: '', label: 'All learning', count: stats.total }, ...STATUSES.map((s) => ({ id: s.id, label: s.label.toLowerCase(), count: items.filter((i) => i.status === s.id).length }))].map((s) => <button key={s.id} aria-pressed={statusFilter === s.id} className={statusFilter === s.id ? 'is-active' : ''} onClick={() => { setStatusFilter(s.id); if (view === 'in_progress') setView('board'); }}>{s.label}<span>{s.count}</span></button>)}
        {(search || catFilter || statusFilter || attentionFilter || favOnly) && <button className="learning-clear" onClick={() => { setSearch(''); setCatFilter(''); setStatusFilter(''); setAttentionFilter(''); setFavOnly(false); }}>Clear filters <X size={13} /></button>}
      </div>
      {/* ── board / list ── */}
      {loading ? (
        <EmptyState icon={GraduationCap} message="Loading learning registry..." />
      ) : loadError && items.length === 0 ? null : items.length === 0 ? (
        <EmptyState icon={GraduationCap} message="No learning items found. Add one to get started." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={GraduationCap} message="No learning items match the current filters." />
      ) : view === 'in_progress' ? (
        <div className="lp-stat">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-display text-sm uppercase tracking-wider text-text-muted">
              <Clock size={14} style={{ color: '#f0a020' }} /> All items in progress
            </div>
            <span className="font-mono text-xs text-text-muted">{filtered.filter((i) => i.status === 'in_progress').length}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.filter((i) => i.status === 'in_progress').map((item) => (
              <LearningCard
                key={item.id}
                item={item}
                materialCount={materialCountOf(item.id)}
                onOpen={() => setDetailItem(item)}
                onEdit={() => openEdit(item)}
                onCertClick={(it) => setCertPreview(it)}
                onFav={() => toggleFav(item)}
                onComplete={() => completeItem(item)}
                onDelete={() => setDeleteId(item.id)}
                draggable={sort === 'manual' && !sortAsc && !saving}
                isDragging={dragId===item.id}
                onDragStart={()=>onDragStart(item.id)}
                onDragOver={onDragOver}
                onDrop={()=>onDrop(item.id)}
                onDragEnd={() => setDragId(null)}
              />
            ))}
          </div>
        </div>
      ) : view === 'board' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {STATUSES.map((col) => {
            const colItems = filtered.filter((i) => i.status === col.id);
            return (
              <div key={col.id} className="lane-col learning-board-column">
                <div className="mb-3 flex items-center justify-between px-1">
                  <span className="font-display text-sm font-medium uppercase tracking-wider" style={{ color: col.color }}>{col.label}</span>
                  <span className="font-mono text-xs text-text-muted">{colItems.length}</span>
                </div>
                <div className="space-y-2">
                  {colItems.map((item) => (
                    <LearningCard
                      key={item.id}
                      item={item}
                      materialCount={materialCountOf(item.id)}
                      onCertClick={(it) => setCertPreview(it)}
                      onOpen={() => setDetailItem(item)}
                      onEdit={() => openEdit(item)}
                      onFav={() => toggleFav(item)}
                      onComplete={() => completeItem(item)}
                      onDelete={() => setDeleteId(item.id)}
                      draggable={sort === 'manual' && !sortAsc && !saving}
                      isDragging={dragId===item.id}
                      onDragStart={()=>onDragStart(item.id)}
                      onDragOver={onDragOver}
                      onDrop={()=>onDrop(item.id)}
                      onDragEnd={() => setDragId(null)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto border border-border-line bg-bg-void">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-line">
                {sortHeaders.map((h) =>
                  h.k ? (
                    <th
                      key={h.l}
                      className="px-3 py-2.5 font-display text-xs uppercase tracking-wider text-text-muted cursor-pointer select-none"
                    >
                      <button className="flex items-center gap-1" aria-label={`Sort by ${h.l}`} onClick={() => {
                        if (sort === h.k) setSortAsc((v) => !v);
                        else { setSort(h.k!); setSortAsc(false); }
                      }}>
                        {h.l}
                        {sort === h.k && (sortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                      </button>
                    </th>
                  ) : (
                    <th key={h.l} className="px-3 py-2.5 font-display text-xs uppercase tracking-wider text-text-muted">{h.l}</th>
                  )
                )}
                <th className="px-3 py-2.5 font-display text-xs uppercase tracking-wider text-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} draggable={sort === 'manual' && !sortAsc && !saving} onDragStart={()=>onDragStart(item.id)} onDragEnd={() => setDragId(null)} onDragOver={onDragOver} onDrop={()=>onDrop(item.id)} className={`cursor-pointer border-b border-border-line transition-colors hover:bg-bg-panel-alt ${dragId===item.id ? 'opacity-40' : ''}`} onClick={() => setDetailItem(item)}>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {sort === 'manual' && <span className="cursor-grab text-text-muted hover:text-accent-cyan" title="Drag to reorder"><GripVertical size={12} /></span>}
                      <button onClick={(e) => { e.stopPropagation(); toggleFav(item); }} className="shrink-0" title={item.favorite ? 'Remove from favorites' : 'Add to favorites'}>
                        <Star size={13} style={{ color: item.favorite ? '#facc15' : '#5d7f88', fill: item.favorite ? '#facc15' : 'none' }} />
                      </button>
                      <span className="font-medium text-text-primary">{item.title}</span>
                      {item.image_mime_type && <span title="Has certificate image"><ImageIcon size={12} className="text-text-muted" /></span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><Badge label={catLabel(item.category)} color={CATEGORY_COLOR[item.category] ?? '#5d7f88'} /></td>
                  <td className="px-3 py-2.5 font-mono text-sm text-text-muted">{item.provider ?? '-'}</td>
                  <td className="px-3 py-2.5"><Badge label={statusLabel(item.status)} color={statusColor(item.status)} /></td>
                  <td className="px-3 py-2.5"><Badge label={item.priority.toUpperCase()} color={PRIORITY_COLOR[item.priority] ?? '#5d7f88'} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 bg-bg-void border border-border-line clip-corner-small overflow-hidden">
                        <div className="h-full" style={{ width: `${item.progress_percent}%`, background: 'linear-gradient(90deg, #26e2f6, #4ade80)' }} />
                      </div>
                      <span className="font-mono text-xs text-text-muted">{item.progress_percent}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-text-muted">{Number(item.hours_spent)}h / {item.estimated_hours}h</td>
                  <td className="px-3 py-2.5">
                    {item.target_end_date ? (
                      <span className="font-mono text-xs" style={isOverdue(item) ? { color: '#f87171' } : undefined}>
                        {formatDate(item.target_end_date)}{isOverdue(item) ? ' OVERDUE' : ''}
                      </span>
                    ) : <span className="font-mono text-xs text-text-muted">-</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <HudButton size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(item); }}>Edit</HudButton>
                      <HudButton size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDetailItem(item); }}>Open</HudButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && <details className="learning-insights"><summary><BarChart3 size={16} /> Learning insights <span>{stats.avgProgress}% average progress</span></summary><div className="learning-insights-body"><section><h3>Where your study time goes</h3><CategoryDonut segs={categoryMix} total={Number(stats.hours.toFixed(2))} /></section><section><h3>Time against your plan</h3>{items.filter((i) => Number(i.estimated_hours) > 0).slice(0, 5).map((item) => <button key={item.id} className="learning-hours-row" onClick={() => setDetailItem(item)}><span>{item.title}</span><strong>{fmtHours(item.hours_spent)} / {item.estimated_hours}h</strong><progress max={Number(item.estimated_hours)} value={Math.min(Number(item.hours_spent), Number(item.estimated_hours))} aria-label={`${item.title} study hours`} />{Number(item.hours_spent) > Number(item.estimated_hours) && <small>Estimate exceeded</small>}</button>)}{!items.some((i) => Number(i.estimated_hours) > 0) && <p>Add estimated hours to a learning item to compare study time with your plan.</p>}</section></div></details>}

      {/* ── detail modal ── */}
      <HudModal open={!!detailItem} onClose={() => setDetailItem(null)} title={detailItem ? detailItem.title : ''} className="!max-w-3xl">
        {detailItem && (
          <div className="space-y-4">
            {saveError && <div className="learning-error" role="alert">{saveError}</div>}
            <div className="learning-study-controls">
              <div><span className="learning-eyebrow">FOCUSED STUDY</span><h3>Make this session count</h3><p>Save your study time here, then update your progress below.</p></div>
              {studySession?.itemId === detailItem.id ? <div className="flex flex-wrap items-center gap-2"><strong className="learning-timer">{Math.floor(sessionElapsed / 60000)}:{String(Math.floor(sessionElapsed / 1000) % 60).padStart(2, '0')}</strong><HudButton size="sm" variant="ghost" onClick={studyRunning ? pauseStudy : () => startStudy(detailItem)}>{studyRunning ? <Pause size={14} className="mr-1 inline" /> : <Play size={14} className="mr-1 inline" />}{studyRunning ? 'Pause' : 'Resume'}</HudButton><HudButton size="sm" onClick={() => void saveStudy()} disabled={saving || sessionElapsed < 1000}>Save session</HudButton><HudButton size="sm" variant="ghost" onClick={() => { setStudySession(null); setStudyRunning(false); }}>Discard time</HudButton></div> : <div className="flex flex-wrap items-end gap-2"><HudButton size="sm" onClick={() => startStudy(detailItem)} disabled={saving || !!studySession}><Play size={14} className="mr-1 inline" />Start timer</HudButton><label className="learning-minutes-label">Study minutes<input type="number" min="1" step="1" value={studyMinutes} onChange={(e) => setStudyMinutes(e.target.value)} /></label><HudButton size="sm" variant="ghost" onClick={() => void logStudy(detailItem, Number(studyMinutes))} disabled={saving}>Log study time</HudButton></div>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge label={catLabel(detailItem.category)} color={CATEGORY_COLOR[detailItem.category] ?? '#5d7f88'} />
              <Badge label={statusLabel(detailItem.status)} color={statusColor(detailItem.status)} />
              <Badge label={`${detailItem.priority.toUpperCase()} PRIORITY`} color={PRIORITY_COLOR[detailItem.priority] ?? '#5d7f88'} />
              {detailItem.tags.map((tag) => (
                <span key={tag} className="lp-chip" style={{ color: '#8fa8b8', borderColor: 'rgba(45, 212, 191, 0.16)' }}><Tag size={10} />{tag}</span>
              ))}
              <span className="ml-auto font-mono text-xs text-text-muted">UPDATED {formatRelative(detailItem.updated_at)}</span>
            </div>
            {detailItem.image_mime_type && detailItem.image_base64 && (
              <div className="cursor-zoom-in border border-border-line bg-bg-void p-2 clip-corner-small" onClick={() => setCertPreview(detailItem)} title="Click to view full size">
                <img src={`data:${detailItem.image_mime_type};base64,${detailItem.image_base64}`} alt="Certificate" className="max-h-72 w-full object-contain transition-opacity hover:opacity-90" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {/* progress — inline editable (slider + steppers, saves instantly) */}
              <div className="border border-border-line bg-bg-void p-3">
                <div className="font-display text-[10px] uppercase tracking-wider text-text-muted">Progress</div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    disabled={saving}
                    onClick={() => void patchItem(detailItem, learningProgress(detailItem.progress_percent - 5, detailItem.completed_at))}
                    className="flex h-6 w-6 shrink-0 items-center justify-center border border-border-line font-mono text-xs text-text-muted transition-colors hover:border-accent-cyan hover:text-accent-cyan"
                    title="-5%"
                    aria-label="Decrease progress by 5 percent"
                  >−</button>
                  <input
                    type="range" min={0} max={100} step={5}
                    value={progressDraft}
                    onChange={(e) => setProgressDraft(Number(e.target.value))}
                    aria-label="Learning progress"
                    aria-valuetext={`${progressDraft} percent`}
                    disabled={saving}
                    className="min-w-0 flex-1"
                    style={{ accentColor: '#26e2f6', height: 4 }}
                  />
                  <button
                    disabled={saving}
                    onClick={() => void patchItem(detailItem, learningProgress(detailItem.progress_percent + 5, detailItem.completed_at))}
                    className="flex h-6 w-6 shrink-0 items-center justify-center border border-border-line font-mono text-xs text-text-muted transition-colors hover:border-accent-cyan hover:text-accent-cyan"
                    title="+5%"
                    aria-label="Increase progress by 5 percent"
                  >+</button>
                </div>
                <div className="mt-2 flex items-center justify-between gap-1"><span className="font-mono text-sm font-bold text-accent-cyan">{progressDraft}%</span>{progressDraft !== detailItem.progress_percent && <HudButton size="sm" onClick={() => void patchItem(detailItem, learningProgress(progressDraft, detailItem.completed_at))} disabled={saving}>Save progress</HudButton>}</div>
              </div>

              {/* hours spent — inline editable */}
              <div className="border border-border-line bg-bg-void p-3">
                <div className="font-display text-[10px] uppercase tracking-wider text-text-muted">Hours spent</div>
                <input
                  key={`hrs-${detailItem.id}-${detailItem.hours_spent}`}
                  type="number" min={0} step={0.5}
                  aria-label="Total study hours"
                  disabled={saving}
                  defaultValue={Number(detailItem.hours_spent)}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (e.target.value.trim() && Number.isFinite(v) && v >= 0 && v !== Number(detailItem.hours_spent)) void patchItem(detailItem, { hours_spent: v });
                    else e.target.value = String(detailItem.hours_spent);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="hud-input clip-corner-small mt-1.5 w-full px-2 py-1 font-mono text-sm"
                />
                <div className="mt-1 font-mono text-[9px] tracking-wider text-text-muted">OF {detailItem.estimated_hours}h ESTIMATED</div>
              </div>

              {/* status — quick lane switch */}
              <div className="border border-border-line bg-bg-void p-3">
                <div className="font-display text-[10px] uppercase tracking-wider text-text-muted">Status</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {STATUSES.map((s) => (
                    <button
                      key={s.id}
                      disabled={saving}
                      aria-pressed={detailItem.status === s.id}
                      onClick={() => void patchItem(detailItem, learningProgress(learningStatusProgress(s.id, detailItem.progress_percent), detailItem.completed_at))}
                      className="px-1.5 py-0.5 font-display text-[9px] uppercase tracking-wider transition-all"
                      style={{
                        color: detailItem.status === s.id ? '#04121a' : s.color,
                        background: detailItem.status === s.id ? s.color : 'transparent',
                        border: `1px solid ${detailItem.status === s.id ? s.color : `${s.color}55`}`,
                        fontWeight: detailItem.status === s.id ? 700 : 400,
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* score — inline editable when completed */}
              <div className="border border-border-line bg-bg-void p-3">
                <div className="font-display text-[10px] uppercase tracking-wider text-text-muted">Score / Grade</div>
                {detailItem.status === 'completed' ? (
                  <input
                    key={`score-${detailItem.id}-${detailItem.score}`}
                    defaultValue={detailItem.score ?? ''}
                    aria-label="Score or grade"
                    disabled={saving}
                    placeholder="e.g. A, 92%..."
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (detailItem.score ?? '')) patchItem(detailItem, { score: v || null });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="hud-input clip-corner-small mt-1.5 w-full px-2 py-1 font-mono text-sm"
                  />
                ) : (
                  <div className="mt-1 font-mono text-sm text-text-muted">— complete to grade</div>
                )}
              </div>

              <div className="border border-border-line bg-bg-void p-3">
                <div className="font-display text-[10px] uppercase tracking-wider text-text-muted">Start</div>
                <div className="mt-1 font-mono text-sm text-text-muted">{detailItem.start_date ? formatDate(detailItem.start_date) : '-'}</div>
              </div>
              <div className="border border-border-line bg-bg-void p-3">
                <div className="font-display text-[10px] uppercase tracking-wider text-text-muted">Target</div>
                <input key={`target-${detailItem.id}-${detailItem.target_end_date}`} aria-label="Target completion date" type="date" disabled={saving} defaultValue={detailItem.target_end_date?.slice(0, 10) ?? ''} className="hud-input mt-1.5 w-full px-2 py-1 text-sm" onBlur={(e) => { const value = e.target.value; if (value !== (detailItem.target_end_date?.slice(0, 10) ?? '')) void patchItem(detailItem, { target_end_date: value || null }); }} />
                {isOverdue(detailItem) && <p className="mt-1 text-xs text-red-400">Overdue · update your target</p>}
              </div>
            </div>
            {detailItem.status === 'completed' && (
              <div className="flex flex-wrap gap-3">
                {detailItem.completed_at && <span className="font-mono text-xs" style={{ color: '#4ade80' }}>COMPLETED {formatDate(detailItem.completed_at)}</span>}
                {detailItem.score && <span className="font-mono text-xs" style={{ color: '#4ade80' }}>SCORE: {detailItem.score}</span>}
              </div>
            )}
            {detailItem.provider && <p className="font-mono text-sm text-text-muted">PROVIDER: {detailItem.provider}</p>}
            {safeLink(detailItem.link) && (
              <a href={safeLink(detailItem.link)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 break-all text-sm text-accent-cyan hover:text-accent-cyan-glow">
                <ExternalLink size={14} />{detailItem.link}
              </a>
            )}
            {detailItem.notes && (
              <div className="markdown-body border border-border-line bg-bg-void p-3 text-sm text-text-muted" dangerouslySetInnerHTML={{ __html: renderMarkdown(detailItem.notes) }} />
            )}

            {/* ── study materials: files + reference links ── */}
            <div className="border border-border-line bg-bg-void p-3 clip-corner-small">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-display text-[10px] uppercase tracking-[0.16em] text-text-muted">
                  <Paperclip size={12} style={{ color: '#26e2f6' }} /> Study Materials
                </span>
                <span className="font-mono text-[10px] text-text-muted">[{materialsOf(detailItem.id).length}]</span>
              </div>
              <div className="space-y-1.5">
                {materialsOf(detailItem.id).map((m) => (
                  <div key={m.id} className="group flex items-center gap-2 border border-border-line/60 px-2 py-1.5 transition-colors hover:border-accent-cyan/40">
                    {m.kind === 'link'
                      ? <Link2 size={12} className="shrink-0 text-accent-cyan" />
                      : <FileText size={12} className="shrink-0" style={{ color: '#f0a020' }} />}
                    {editingMatId === m.id ? (
                      <>
                        <input
                          autoFocus
                          value={fMatEditTitle}
                          onChange={(e) => setFMatEditTitle(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void saveMaterialEdit(); if (e.key === 'Escape') setEditingMatId(null); }}
                          placeholder="TITLE..."
                          className="hud-input clip-corner-small w-28 px-1.5 py-1 font-mono text-xs"
                        />
                        {m.kind === 'link' && (
                          <input
                            value={fMatEditUrl}
                            onChange={(e) => setFMatEditUrl(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void saveMaterialEdit(); if (e.key === 'Escape') setEditingMatId(null); }}
                            placeholder="https://..."
                            className="hud-input clip-corner-small min-w-0 flex-1 px-1.5 py-1 font-mono text-xs"
                          />
                        )}
                        <button onClick={() => void saveMaterialEdit()} className="shrink-0 text-text-muted transition-colors hover:text-accent-cyan" title="Save">
                          <Check size={12} />
                        </button>
                        <button onClick={() => setEditingMatId(null)} className="shrink-0 text-text-muted transition-colors hover:text-text-primary" title="Cancel">
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">{m.title}</span>
                        <span className="shrink-0 font-mono text-[9px] text-text-muted">
                          {m.kind === 'file' ? `${fmtBytes(m.size_bytes)} · ${(m.mime_type ?? '').split('/')[1]?.toUpperCase() || 'FILE'}` : 'LINK'}
                        </span>
                        {m.kind === 'link' && safeLink(m.url) && (
                          <a href={safeLink(m.url)} target="_blank" rel="noopener noreferrer" className="shrink-0 text-text-muted transition-colors hover:text-accent-cyan" title="Open reference" onClick={(e) => e.stopPropagation()}>
                            <ExternalLink size={12} />
                          </a>
                        )}
                        {m.kind === 'file' && (
                          <button onClick={() => downloadMaterial(m)} className="shrink-0 text-text-muted transition-colors hover:text-accent-cyan" title="Download">
                            <Download size={12} />
                          </button>
                        )}
                        <button onClick={() => startMaterialEdit(m)} className="shrink-0 text-text-muted opacity-0 transition-all hover:text-accent-cyan group-hover:opacity-100" title="Edit">
                          <Pencil size={12} />
                        </button>
                        <button onClick={() => setDeleteMatId(m.id)} className="shrink-0 text-text-muted transition-colors hover:text-alert-red" title="Remove">
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {materialsOf(detailItem.id).length === 0 && (
                  <p className="py-2 text-center font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    No materials yet — attach a PDF or a reference link below
                  </p>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border-line/60 pt-2.5">
                <input value={fMatTitle} aria-label="Study material title" onChange={(e) => setFMatTitle(e.target.value)} placeholder="TITLE..." className="hud-input clip-corner-small w-28 px-2 py-1.5 font-mono text-xs" />
                <input
                  value={fMatUrl}
                  aria-label="Study material reference URL"
                  onChange={(e) => setFMatUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addMaterialLink(); }}
                  placeholder="https://reference-link..."
                  className="hud-input clip-corner-small min-w-0 flex-1 px-2 py-1.5 font-mono text-xs"
                />
                <HudButton size="sm" variant="ghost" onClick={addMaterialLink} disabled={matBusy || !fMatTitle.trim() || !fMatUrl.trim()}><Plus size={12} className="mr-1 inline" />Add Link</HudButton>
                <HudButton size="sm" variant="ghost" onClick={() => materialFileRef.current?.click()} disabled={matBusy}><Upload size={12} className="mr-1 inline" />{matBusy ? 'Uploading...' : 'Upload File'}</HudButton>
                <input ref={materialFileRef} type="file" className="hidden" onChange={handleMaterialFile} accept=".pdf,.md,.txt,.doc,.docx,.ppt,.pptx,.zip,image/*" />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-line pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <HudButton size="sm" variant="primary" onClick={() => openEdit(detailItem)}><Pencil size={12} className="mr-1 inline" />Edit</HudButton>
                <HudButton size="sm" variant="ghost" onClick={() => duplicate(detailItem)}><Files size={12} className="mr-1 inline" />Duplicate</HudButton>
                <HudButton size="sm" variant="ghost" disabled={saving} onClick={() => { const sort_order = Math.min(0, ...items.map((i) => i.sort_order)) - 1; void patchItem(detailItem, { sort_order }).then((saved) => { if (saved) { setSort('manual'); setSortAsc(false); } }); }}>Move to top</HudButton>
                {detailItem.status !== 'completed' && (
                  <HudButton size="sm" variant="ghost" onClick={() => completeItem(detailItem)}><Check size={12} className="mr-1 inline" />Mark Complete</HudButton>
                )}
                {detailItem.link && (
                  <HudButton size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(detailItem.link!).catch(() => {}); notify('Link copied'); }}><Copy size={12} className="mr-1 inline" />Copy Link</HudButton>
                )}
                <button onClick={() => setDeleteId(detailItem.id)} title="Delete learning item" className="px-2 py-1.5 text-text-muted transition-colors hover:text-alert-red"><Trash2 size={14} /></button>
              </div>
              <button onClick={() => setDetailItem(null)} className="font-mono text-xs text-text-muted hover:text-text-primary">Close</button>
            </div>
          </div>
        )}
      </HudModal>

      {/* ── add / edit modal ── */}
      <HudModal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Learning Item' : 'Add Learning Item'}>
        <div className="space-y-4">
          {saveError && <div className="learning-error" role="alert">{saveError}</div>}
          <HudInput label="Title" value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="Course or certification name..." />
          <div className="grid grid-cols-2 gap-3">
            <HudInput label="Provider" value={fProvider} onChange={(e) => setFProvider(e.target.value)} placeholder="e.g. Coursera, Udemy..." />
            <HudInput label="Link" value={fLink} onChange={(e) => setFLink(e.target.value)} placeholder="https://..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HudSelect label="Category" value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </HudSelect>
            <HudSelect label="Priority" value={fPriority} onChange={(e) => setFPriority(e.target.value as PRIORITY)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </HudSelect>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HudSelect label="Status" value={fStatus} onChange={(e) => { setFStatus(e.target.value); setFProgress(learningStatusProgress(e.target.value, fProgress)); }}>
              <option value="not_started">Not Started</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </HudSelect>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-display text-xs uppercase tracking-wider text-text-muted">Progress</span>
                <span className="font-mono text-xs" style={{ color: '#26e2f6' }}>{fProgress}%</span>
              </div>
              <input
                type="range" min={0} max={100} step={5} value={fProgress}
                aria-label="Initial learning progress"
                onChange={(e) => { const progress = Number(e.target.value); setFProgress(progress); setFStatus(learningProgress(progress, null).status); }}
                className="hud-input w-full cursor-pointer"
                style={{ accentColor: '#26e2f6', padding: '6px 0' }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HudInput label="Start Date" type="date" value={fStart} onChange={(e) => setFStart(e.target.value)} />
            <HudInput label="Target End Date" type="date" value={fEnd} onChange={(e) => setFEnd(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HudInput label="Estimated Hours" type="number" min={0} value={fEstHours} onChange={(e) => setFEstHours(Number(e.target.value))} />
            <HudInput label="Hours Spent" type="number" min={0} step={0.5} value={fHoursSpent} onChange={(e) => setFHoursSpent(Number(e.target.value))} />
          </div>
          <HudInput label="Tags (comma-separated)" value={fTags} onChange={(e) => setFTags(e.target.value)} placeholder="devops, kubernetes" />
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs text-text-muted">SUGGESTED:</span>
              {allTags.filter((t) => !fTags.split(',').map((x) => x.trim()).includes(t)).slice(0, 10).map((tag) => (
                <button
                  key={tag}
                  onClick={() => setFTags((v) => (v.trim() ? `${v.trim()}, ${tag}` : tag))}
                  className="lp-chip"
                  style={{ color: '#26e2f6', borderColor: 'rgba(38,226,246,0.4)', background: 'rgba(38,226,246,0.08)' }}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-display text-xs uppercase tracking-wider text-text-muted">Certificate Image</span>
              {fImageMime && <button onClick={removeImage} className="font-display text-xs uppercase tracking-wider text-text-muted hover:text-alert-red">Remove</button>}
            </div>
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
            {fImageMime ? (
              <div className="border border-border-line bg-bg-void p-2 clip-corner-small">
                <img src={`data:${fImageMime};base64,${fImageBase64}`} alt="Certificate" className="lp-cert object-cover" />
              </div>
            ) : (
              <button
                onClick={() => imageInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 border border-dashed border-border-line px-3 py-5 font-display text-xs uppercase tracking-wider text-text-muted transition-colors hover:text-accent-cyan"
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(38,226,246,0.5)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = ''; }}
              >
                <Upload size={14} />Upload Image
              </button>
            )}
            {imageError && <div className="mt-1.5 font-mono text-xs" style={{ color: '#f87171' }}>{imageError}</div>}
          </div>
          {fStatus === 'completed' && (
            <div className="grid grid-cols-2 gap-3">
              <HudInput label="Completed At" type="date" value={fCompletedAt} onChange={(e) => setFCompletedAt(e.target.value)} />
              <HudInput label="Score / Grade" value={fScore} onChange={(e) => setFScore(e.target.value)} placeholder="e.g. A, 92%, Passed..." />
            </div>
          )}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-display text-xs uppercase tracking-wider text-text-muted">Notes</span>
              <div className="flex gap-1">
                <button onClick={() => setNotesMode('edit')} className={`px-2 py-1 font-display text-xs uppercase tracking-wider transition-colors ${notesMode === 'edit' ? 'text-accent-cyan' : 'text-text-muted hover:text-text-primary'}`}>Edit</button>
                <button onClick={() => setNotesMode('preview')} className={`px-2 py-1 font-display text-xs uppercase tracking-wider transition-colors ${notesMode === 'preview' ? 'text-accent-cyan' : 'text-text-muted hover:text-text-primary'}`}>Preview</button>
              </div>
            </div>
            {notesMode === 'edit' ? (
              <HudTextarea value={fNotes} onChange={(e) => setFNotes(e.target.value)} rows={3} placeholder="Notes, syllabus, links... (Markdown supported)" />
            ) : (
              <div className="markdown-body min-h-16 border border-border-line bg-bg-void p-3 text-sm text-text-muted" dangerouslySetInnerHTML={{ __html: renderMarkdown(fNotes) }} />
            )}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <HudButton variant="ghost" disabled={saving} onClick={() => setShowModal(false)}>Cancel</HudButton>
            <HudButton onClick={save} disabled={!fTitle.trim() || saving}>{saving ? 'Saving…' : editItem ? 'Update' : 'Create'}</HudButton>
          </div>
        </div>
      </HudModal>

      {/* ── global jump-to search overlay ── */}
      {gOpen && (
        <div className="gs-panel fixed inset-0 z-50 m-auto flex h-max w-11/12 max-w-2xl flex-col gap-1 p-2 shadow-xl">
          <div className="flex items-center gap-2 border-b border-border-line px-1 pb-1">
            <Search size={14} className="text-text-muted ml-2" />
            <input
              ref={gRef}
              autoFocus
              aria-label="Jump to a learning item"
              className="hud-input flex-1 border-0 bg-transparent text-sm outline-none"
              value={gQuery}
              onChange={(e) => setGQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') closeG(); if (e.key === 'Enter' && globalResults[0]) { setDetailItem(globalResults[0]); closeG(); } }}
              placeholder="Jump to a learning item (Esc to close)..."
            />
            <button onClick={closeG} aria-label="Close learning search" className="text-text-muted hover:text-text-primary"><X size={14} /></button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {globalResults.length === 0 ? (
              <div className="p-2 text-center font-mono text-xs text-text-muted">No matches</div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {globalResults.map((item) => (
                  <button
                    key={item.id}
                    className="gs-row w-full cursor-pointer text-left"
                    onClick={() => {
                      setDetailItem(item);
                      closeG();
                    }}
                  >
                    <span className="gs-group" style={{ color: CATEGORY_COLOR[item.category] ?? '#5d7f88' }}>{catLabel(item.category)}</span>
                    <div className="flex-1">
                      <div className="font-medium text-text-primary">{item.title}</div>
                      {item.provider && <div className="font-mono text-xs text-text-muted">{item.provider}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── certificate lightbox — full size, clear view ── */}
      {certPreview && certPreview.image_mime_type && certPreview.image_base64 && (
        <div
          className="fixed inset-0 z-[85] flex flex-col items-center justify-center p-4 sm:p-8"
          style={{ background: 'rgba(2,4,8,0.94)', backdropFilter: 'blur(6px)' }}
          onClick={() => setCertPreview(null)}
        >
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(74,222,128,0.6), transparent)' }} />
          <div className="mb-4 flex w-full max-w-3xl items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-display text-base font-bold uppercase tracking-[0.12em]" style={{ color: '#ddfeff' }}>{certPreview.title}</div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold tracking-wider" style={{ color: '#4ade80', border: '1px solid rgba(74,222,128,0.55)', background: 'rgba(4,8,12,0.85)', padding: '2px 8px' }}>
                  <Check size={10} /> CERTIFIED
                </span>
                {certPreview.score && (
                  <span className="font-mono text-[13px] font-bold tracking-wide" style={{ color: '#facc15', border: '1px solid rgba(250,204,21,0.55)', background: 'rgba(4,8,12,0.85)', padding: '2px 10px', textShadow: '0 0 10px rgba(250,204,21,0.55)' }}>
                    ★ {certPreview.score}
                  </span>
                )}
                <span className="font-mono text-[10px] tracking-wider text-text-muted">[ESC] CLOSE</span>
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setCertPreview(null); }}
              className="hud-btn clip-corner-small flex h-9 w-9 shrink-0 items-center justify-center font-mono text-sm"
              title="Close (ESC)"
            >
              <X size={16} />
            </button>
          </div>
          <div className="relative max-h-[78vh] w-full max-w-4xl overflow-auto border border-border-line bg-bg-void p-2 clip-corner-small" onClick={(e) => e.stopPropagation()}>
            <img src={`data:${certPreview.image_mime_type};base64,${certPreview.image_base64}`} alt={`${certPreview.title} certificate`} className="mx-auto h-auto max-h-[76vh] w-auto max-w-full object-contain" />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteMatId}
        onClose={() => setDeleteMatId(null)}
        onConfirm={removeMaterial}
        title="Remove Material"
        message="This study material will be detached and deleted."
        confirmLabel="Remove"
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={remove}
        title="Delete Item"
        message="Remove this learning item permanently?"
        confirmLabel="Delete"
      />
    </PageContainer>
  );
}
