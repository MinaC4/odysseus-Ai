import { isWorkspaceShortcutBlocked } from "@/lib/dom";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Trash2, Code2, ChevronDown, ChevronUp, Pencil, Star, Copy, Check,
  LayoutList, LayoutGrid, Download, Upload, Files, Eye, Search,
  BarChart3, X, GripVertical, Maximize2, Minimize2, Expand, Globe, Zap, Terminal, Server, Play, Plus, RefreshCw,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { apiService as api } from '@/lib/api';
import './ScriptsLibrary.css';
import { PageContainer, PageHeader } from '@/components/PageLayout';
import { HudButton } from '@/components/HudButton';
import { HudInput, HudSelect, HudTextarea } from '@/components/HudInputs';
import { HudModal } from '@/components/HudModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { renderMarkdown } from '@/lib/markdown';
import { formatRelative } from '@/lib/utils';

interface Script {
  id: string;
  title: string;
  description: string | null;
  language: string;
  content: string;
  tags: string[];
  favorite: boolean;
  copy_count: number;
  created_at: string;
  updated_at: string;
  sort_order: number;
}

const LANGUAGES = [
  { value: 'bash', label: 'Bash' },
  { value: 'python', label: 'Python' },
  { value: 'ansible', label: 'Ansible' },
  { value: 'yaml', label: 'YAML' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'sql', label: 'SQL' },
  { value: 'dockerfile', label: 'Dockerfile' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'go', label: 'Go' },
  { value: 'json', label: 'JSON' },
  { value: 'other', label: 'Other' },
];

const LANG_COLORS: Record<string, string> = {
  bash: '#26e2f6',
  python: '#f0a020',
  ansible: '#ff6b9d',
  yaml: '#7ec7d4',
  javascript: '#facc15',
  typescript: '#4ade80',
  sql: '#a78bfa',
  dockerfile: '#38bdf8',
  powershell: '#f87171',
  go: '#60a5fa',
  json: '#e879c9',
  other: '#5d7f88',
};

/** Rainbow palette for tag chips (v5 skin). */
const TAG_COLORS = ['#2de2e6', '#7cf7f9', '#f0a020', '#34d399', '#a8b7d8', '#d946ef', '#f87319', '#ec4899'];

type ViewMode = 'workspace' | 'list' | 'grid';
type SortMode = 'newest' | 'oldest' | 'title' | 'copied';
interface Device { id: string; name: string; host: string; port: number; username: string; registered: boolean }
interface RunResult { deviceId: string; deviceName: string; exitCode: number | null; output: string; truncated: boolean; timedOut: boolean }
interface RunHistory { id: string; actor: string; outcome: string; created_at: string; metadata: { scriptTitle?: string; deviceName?: string; status?: string; exitCode?: number | null } }

/* ---------- shared components ---------- */

function TagChips({ tags, selected = [], onTagClick }: { tags: string[]; selected?: string[]; onTagClick?: (t: string) => void }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.slice(0, 6).map((t, i) => {
        const active = selected.includes(t);
        const c = TAG_COLORS[i % TAG_COLORS.length];
        return (
          <span
            key={t}
            onClick={onTagClick ? () => onTagClick(t) : undefined}
            className={`pc-chip cursor-${onTagClick ? 'pointer' : 'default'} transition-all ${
              active ? 'ring-2 ring-offset-2' : ''
            }`}
            style={{
              color: c,
              borderColor: active ? c : `${c}55`,
              ...(active ? { background: `${c}1a`, '--ring-offset-color': '#0d1621' } : {}),
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
            {t}
          </span>
        );
      })}
    </div>
  );
}

function TrackCopy({ script, onCopy, onToast }: { script: Script; onCopy: (s: Script) => void; onToast: (msg: string) => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handle = async () => {
    try {
      await navigator.clipboard.writeText(script.content);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = script.content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    onCopy(script);
    onToast('Script copied to clipboard');
    setCopied(true);
  };

  return (
    <button
      onClick={handle}
      className={`inline-flex items-center gap-1.5 hud-btn clip-corner-small px-3 py-1.5 text-xs font-display uppercase tracking-wider transition-all ${
        copied ? 'text-accent-cyan-glow' : ''
      }`}
      style={copied ? { borderColor: '#26e2f6' } : undefined}
      title="Copy code"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// Animated count-up number for stat widgets.
function CountUp({ value, duration = 900, className, style }: { value: number; duration?: number; className?: string; style?: CSSProperties }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const from = prevRef.current;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else prevRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);
  return <span className={className} style={style}>{display}</span>;
}

// Language distribution donut — click a legend row to filter the library.
function LangDonut({ segs, total, active, onSelect }: {
  segs: { label: string; value: number; color: string }[];
  total: number;
  active: string | null;
  onSelect: (lang: string | null) => void;
}) {
  const size = 112;
  const r = 44;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle cx={cx} cy={cx} r={r + 6} fill="none" stroke="rgba(38,226,246,0.12)" strokeWidth="0.7" strokeDasharray="1.5 3.5" />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(45,212,191,0.08)" strokeWidth="11" />
        {total > 0 && segs.filter((s) => s.value > 0).map((s) => {
          const frac = s.value / total;
          const dash = Math.max(0, frac * c - 2);
          const off = -acc * c;
          acc += frac;
          return (
            <circle key={s.label} cx={cx} cy={cx} r={r} fill="none" stroke={s.color} strokeWidth="11"
              strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={off} transform={`rotate(-90 ${cx} ${cx})`}
              style={{ filter: `drop-shadow(0 0 3px ${s.color}66)`, transition: 'stroke-dasharray 0.7s ease' }} />
          );
        })}
        <text x={cx} y={cx - 1} textAnchor="middle" fill="#ddfeff" fontFamily="'JetBrains Mono', monospace" fontSize="17" fontWeight="700">{total}</text>
        <text x={cx} y={cx + 12} textAnchor="middle" fill="#5b6b80" fontFamily="'JetBrains Mono', monospace" fontSize="6" letterSpacing="2">SCRIPTS</text>
      </svg>
      <div className="max-h-[128px] min-w-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {segs.map((s) => (
          <button
            key={s.label}
            onClick={() => onSelect(active === s.label ? null : s.label)}
            className="flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left font-mono text-[10px] transition-colors hover:bg-[rgba(38,226,246,0.06)]"
            title={`Filter by ${s.label}`}
          >
            <span className="inline-block shrink-0" style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, boxShadow: s.value ? `0 0 4px ${s.color}` : 'none', opacity: s.value ? 1 : 0.3 }} />
            <span className="min-w-0 flex-1 truncate uppercase" style={{ color: active === s.label ? '#26e2f6' : '#8fa8b8' }}>{s.label}</span>
            <span style={{ color: s.value ? '#c8d6e8' : '#5b6b80' }}>{s.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Code viewer with three display modes for large scripts:
// normal (compact window) -> expanded (near full height) -> fullscreen overlay.
// Gutter + code live in ONE scroll container so line numbers never desync.
function CodeBlock({ content, language, maxHeight = 384 }: { content: string; language?: string; maxHeight?: number }) {
  const [mode, setMode] = useState<'normal' | 'expanded' | 'full'>('normal');
  const color = LANG_COLORS[language ?? 'other'] ?? '#5d7f88';
  const lines = content.split('\n');
  const big = lines.length > 22;

  useEffect(() => {
    if (mode !== 'full') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMode('normal'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const code = (
    <div className="flex w-max min-w-full">
      <div
        className="sticky left-0 z-[1] shrink-0 select-none border-r border-border-line px-2 py-3 text-right font-mono text-sm leading-relaxed"
        style={{ color: 'rgba(133,147,168,0.55)', background: 'rgba(8, 13, 20, 0.96)' }}
      >
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="flex-1 p-3 font-mono text-sm leading-relaxed">{content}</pre>
    </div>
  );

  const toolbar = (
    <div className="flex items-center gap-2 border-b px-3 py-1.5" style={{ borderColor: `${color}22`, background: 'rgba(13, 22, 33, 0.6)' }}>
      <span className="pc-chip" style={{ color, borderColor: `${color}55` }}>{(language ?? 'other').toUpperCase()}</span>
      <span className="font-mono text-[10px] tracking-wider" style={{ color: '#5b6b80' }}>{lines.length} LINES</span>
      <span className="ml-auto flex items-center gap-1.5">
        {big && (
          <button
            onClick={() => setMode(mode === 'expanded' ? 'normal' : 'expanded')}
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider transition-colors hover:text-accent-cyan"
            style={{ color: '#8fa8b8' }}
            title={mode === 'expanded' ? 'Collapse back to compact view' : 'Expand to near-full height'}
          >
            {mode === 'expanded' ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            {mode === 'expanded' ? 'COLLAPSE' : 'EXPAND'}
          </button>
        )}
        <button
          onClick={() => setMode('full')}
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider transition-colors hover:text-accent-cyan"
          style={{ color: '#8fa8b8' }}
          title="Fullscreen viewer (ESC to close)"
        >
          <Expand size={11} /> FULL
        </button>
      </span>
    </div>
  );

  if (mode === 'full') {
    return (
      <div className="fixed inset-0 z-[80] flex flex-col p-4 sm:p-6" style={{ background: 'rgba(3, 6, 10, 0.97)' }}>
        <div className="mb-3 flex items-center gap-3">
          <span className="pc-chip" style={{ color, borderColor: `${color}55` }}>{(language ?? 'other').toUpperCase()}</span>
          <span className="font-mono text-xs text-text-muted">{lines.length} LINES</span>
          <span className="ml-auto hidden font-mono text-[10px] uppercase tracking-wider text-text-muted sm:inline">[ESC] CLOSE</span>
          <button onClick={() => setMode('normal')} className="hud-btn clip-corner-small px-3 py-1.5 font-display text-xs uppercase tracking-wider">✕ Close</button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto clip-corner-small"
          style={{ border: `1px solid ${color}33`, background: 'rgba(8, 13, 20, 0.94)', boxShadow: `inset 0 0 14px ${color}1a` }}
        >
          {code}
        </div>
      </div>
    );
  }

  return (
    <div
      className="clip-corner-small"
      style={{ border: `1px solid ${color}33`, background: 'rgba(8, 13, 20, 0.94)', boxShadow: `inset 0 0 10px ${color}1a` }}
    >
      {toolbar}
      <div className="overflow-auto" style={mode === 'expanded' ? { maxHeight: 'calc(100vh - 300px)' } : { maxHeight }}>
        {code}
      </div>
      {mode === 'normal' && big && (
        <div
          className="pointer-events-none flex items-center justify-center pb-1.5 font-mono text-[9px] uppercase tracking-widest"
          style={{ color: 'rgba(133,147,168,0.45)', background: 'linear-gradient(180deg, transparent, rgba(8,13,20,0.9))', marginTop: -14 }}
        >
          ▾ {lines.length} lines — use EXPAND / FULL
        </div>
      )}
    </div>
  );
}

export function ScriptsLibrary() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [langFilter, setLangFilter] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');
  const [view, setView] = useState<ViewMode>('workspace');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [deviceDraft, setDeviceDraft] = useState<string[]>([]);
  const [showDevices, setShowDevices] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const [runError, setRunError] = useState('');
  const [runResults, setRunResults] = useState<RunResult[]>([]);
  const [runTitle, setRunTitle] = useState('');
  const [runHistory, setRunHistory] = useState<RunHistory[]>([]);
  const [running, setRunning] = useState(false);
  const [confirmRun, setConfirmRun] = useState<Script | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editScript, setEditScript] = useState<Script | null>(null);
  const [detailScript, setDetailScript] = useState<Script | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [importError, setImportError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gRef = useRef<HTMLInputElement>(null);

  // global search (jump-to) state
  const [gQuery, setGQuery] = useState('');
  const [gOpen, setGOpen] = useState(false);

  // form state
  const [fTitle, setFTitle] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fLang, setFLang] = useState('bash');
  const [fContent, setFContent] = useState('');
  const [fTags, setFTags] = useState('');
  const [descMode, setDescMode] = useState<'edit' | 'preview'>('edit');
  const [codeMode, setCodeMode] = useState<'edit' | 'preview'>('edit');

  const loadScripts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('scripts').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    setLoadError(error ? 'Could not load saved scripts. Retry to reconnect to the library.' : '');
    if (!error) setScripts(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadScripts();
  }, [loadScripts]);

  const loadDevices = useCallback(async () => {
    try {
      const data = await api.request<{ devices: Device[] }>('/api/internal/scripts/devices');
      setDevices(data.devices); setDeviceDraft(data.devices.filter((device) => device.registered).map((device) => device.id));
      setSelectedDevices((prev) => prev.filter((id) => data.devices.some((device) => device.id === id && device.registered)));
      setDeviceError('');
    } catch (error) { setDeviceError((error as Error).message); }
  }, []);
  const loadHistory = useCallback(async () => {
    try { setRunHistory(await api.request<RunHistory[]>('/api/internal/scripts/runs')); }
    catch { /* Device permission state already explains execution access. */ }
  }, []);
  useEffect(() => { void loadDevices(); void loadHistory(); }, [loadDevices, loadHistory]);

  const registerDevices = async () => {
    setSaving(true);
    try {
      await api.request('/api/internal/scripts/devices', { method: 'PUT', body: JSON.stringify({ deviceIds: deviceDraft }) });
      await loadDevices(); setShowDevices(false); setToast('Device registration updated');
    } catch (error) { setDeviceError((error as Error).message); }
    finally { setSaving(false); }
  };
  const execute = async () => {
    const script = confirmRun;
    if (!script || running) return;
    setConfirmRun(null); setRunning(true); setRunError(''); setRunResults([]); setRunTitle(script.title);
    try {
      const reviewed = await api.request<{ content: string; contentHash: string }>(`/api/internal/scripts/review/${encodeURIComponent(script.id)}`);
      if (reviewed.content !== script.content) throw new Error('Script changed since review. Reload and confirm the saved version.');
      const contentHash = reviewed.contentHash;
      const result = await api.request<{ results: RunResult[] }>('/api/internal/scripts/run', { method: 'POST', body: JSON.stringify({ scriptId: script.id, deviceIds: selectedDevices, contentHash, confirmed: true }) });
      setRunResults(result.results);
    } catch (error) { setRunError((error as Error).message); }
    finally { setRunning(false); void loadHistory(); }
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  /* ── Global search (jump-to script) ─────────────────────────────── */

  const closeG = () => {
    setGOpen(false);
    setGQuery('');
  };

  const globalResults = useMemo(() => {
    const q = gQuery.trim().toLowerCase();
    if (!q) return [];
    return scripts
      .filter((s) => {
        const hay = `${s.title} ${s.description ?? ''} ${s.content} ${s.tags.join(' ')}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [gQuery, scripts]);

  // ── Keyboard shortcuts: / search · 1-2 views · N new script ──────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || isWorkspaceShortcutBlocked(e)) return;
      if (e.key === '/') {
        e.preventDefault();
        gRef.current?.focus();
        setGOpen(true);
      } else if (e.key === 'Escape') {
        closeG();
        setGQuery('');
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setShowModal(true);
        setEditScript(null);
        setFTitle(''); setFDesc(''); setFLang('bash'); setFContent(''); setFTags('');
        setDescMode('edit'); setCodeMode('edit');
      } else if (/^[1-3]$/.test(e.key)) {
        const idx = parseInt(e.key, 10);
        const tabs: ViewMode[] = ['workspace', 'list', 'grid'];
        if (idx >= 1 && idx <= tabs.length) setView(tabs[idx - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ── derived data ──────────────────────────────────────────────── */

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of scripts) for (const t of s.tags) set.add(t);
    return [...set].sort();
  }, [scripts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = scripts.filter((s) => {
      if (langFilter && s.language !== langFilter) return false;
      if (favOnly && !s.favorite) return false;
      if (tagFilter && !s.tags.includes(tagFilter)) return false;
      if (q) {
        const hay = `${s.title} ${s.description ?? ''} ${s.content} ${s.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    switch (sort) {
      case 'oldest': list = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at)); break;
      case 'title': list = [...list].sort((a, b) => a.title.localeCompare(b.title)); break;
      case 'copied': list = [...list].sort((a, b) => b.copy_count - a.copy_count); break;
      default: list = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    }
    return list;
  }, [scripts, search, langFilter, favOnly, tagFilter, sort]);
  const selectedScript = filtered.find((script) => script.id === selectedId) ?? filtered[0] ?? null;

  // pagination for large lists
  const PAGE_SIZE = 20;
  const isPaginated = filtered.length > 50;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [search, langFilter, favOnly, tagFilter, sort]);
  const paginated = useMemo(
    () => (isPaginated ? filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : filtered),
    [isPaginated, filtered, page],
  );

  const stats = useMemo(() => ({
    total: scripts.length,
    favorites: scripts.filter((s) => s.favorite).length,
    languages: new Set(scripts.map((s) => s.language)).size,
    lines: scripts.reduce((acc, s) => acc + s.content.split('\n').length, 0),
  }), [scripts]);

  /** Language distribution for RadioBar. */
  const languageDist = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of scripts) {
      counts[s.language] = (counts[s.language] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [scripts]);

  /** Copy velocity — total copies per language (max-normalized for RadioBar). */

  const recentCopies = useMemo(() => {
    return [...scripts]
      .filter((s) => s.copy_count > 0)
      .sort((a, b) => b.copy_count - a.copy_count)
      .slice(0, 5);
  }, [scripts]);

  const toggleFav = async (script: Script) => {
    const next = !script.favorite;
    setScripts((prev) => prev.map((s) => (s.id === script.id ? { ...s, favorite: next } : s)));
    const { error } = await supabase.from('scripts').update({ favorite: next }).eq('id', script.id);
    if (error) { setScripts((prev) => prev.map((s) => s.id === script.id ? { ...s, favorite: script.favorite } : s)); setToast('Could not update favorite'); return; }
    setToast(next ? 'Added to favorites' : 'Removed from favorites');
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const trackCopy = async (script: Script) => {
    const next = script.copy_count + 1;
    setScripts((prev) => prev.map((s) => (s.id === script.id ? { ...s, copy_count: next } : s)));
    await supabase.from('scripts').update({ copy_count: next }).eq('id', script.id);
  };


  const openEdit = (s: Script) => {
    setEditScript(s);
    setFTitle(s.title); setFDesc(s.description ?? ''); setFLang(s.language);
    setFContent(s.content); setFTags(s.tags.join(', '));
    setDescMode('edit'); setCodeMode('edit');
    setDetailScript(null);
    setShowModal(true);
  };

  const save = async () => {
    if (!fTitle.trim() || !fContent.trim() || saving) return;
    const tags = fTags.split(',').map((t) => t.trim()).filter(Boolean);
    if (!editScript && scripts.some((s) => s.title.toLowerCase() === fTitle.trim().toLowerCase())) {
      setToast('Duplicate skipped — script already exists');
      setShowModal(false);
      return;
    }
    setSaving(true);
    if (editScript) {
      const { data, error } = await supabase
        .from('scripts')
        .update({
          title: fTitle.trim(),
          description: fDesc.trim() || null,
          language: fLang,
          content: fContent,
          tags,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editScript.id)
        .select()
        .single();
      if (error) { setToast(`Could not save script: ${error.message}`); setSaving(false); return; }
      if (data) setScripts((prev) => prev.map((s) => (s.id === data.id ? (data as Script) : s)));
      setToast('Script updated');
    } else {
      const minOrder = scripts.length ? Math.min(...scripts.map((x) => x.sort_order ?? 0)) : 0;
      const { data, error } = await supabase
        .from('scripts')
        .insert({ title: fTitle.trim(), description: fDesc.trim() || null, language: fLang, content: fContent, tags, sort_order: minOrder - 1 })
        .select()
        .single();
      if (error) { setToast(`Could not save script: ${error.message}`); setSaving(false); return; }
      if (data) setScripts((prev) => [data as Script, ...prev]);
      setToast('Script created');
    }
    setShowModal(false);
    setSaving(false);
  };

  const duplicate = async (s: Script) => {
    const minOrder = scripts.length ? Math.min(...scripts.map((x) => x.sort_order ?? 0)) : 0;
    const { data, error } = await supabase
      .from('scripts')
      .insert({
        title: `${s.title} (copy)`,
        description: s.description,
        language: s.language,
        content: s.content,
        tags: s.tags,
        sort_order: minOrder - 1,
      })
      .select()
      .single();
    if (error) { setToast(`Could not duplicate script: ${error.message}`); return; }
    if (data) setScripts((prev) => [data as Script, ...prev]);
    setToast('Script duplicated');
  };

  const onDragStart = (id: string) => setDragId(id);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const sIdx = filtered.findIndex((x) => x.id === dragId);
    const dIdx = filtered.findIndex((x) => x.id === targetId);
    if (sIdx === -1 || dIdx === -1) return;
    const reordered = [...filtered];
    const [moved] = reordered.splice(sIdx, 1);
    reordered.splice(dIdx, 0, moved);
    // assign new sequential sort_order and update DB
    const updates = reordered.map((it, idx) => ({ id: it.id, sort_order: idx }));
    setScripts((prev) => {
      const map = new Map(updates.map((u) => [u.id, u.sort_order]));
      return [...prev].map((p) => (map.has(p.id) ? { ...p, sort_order: map.get(p.id)! } : p)).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    });
    for (const u of updates) await supabase.from('scripts').update({ sort_order: u.sort_order }).eq('id', u.id);
    setDragId(null);
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('scripts').delete().eq('id', deleteId);
    if (error) { setToast(`Could not delete script: ${error.message}`); return; }
    setScripts((prev) => prev.filter((s) => s.id !== deleteId));
    setDeleteId(null);
    setDetailScript(null);
    setToast('Script deleted');
  };

  const exportJSON = () => {
    if (filtered.length === 0) return;
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hephastos-scripts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(`Exported ${filtered.length} script${filtered.length !== 1 ? 's' : ''}`);
  };

  const importJSON = (file: File) => {
    setImportError('');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? ''));
        if (!Array.isArray(parsed)) throw new Error('not an array');
        const valid = parsed.filter((it) => it && typeof it.title === 'string' && it.title.trim() && typeof it.content === 'string');
        if (valid.length === 0) throw new Error('no valid scripts');
        for (const it of valid) {
          const { error } = await supabase.from('scripts').insert({
            title: it.title.trim(),
            description: typeof it.description === 'string' && it.description.trim() ? it.description.trim() : null,
            language: typeof it.language === 'string' && LANGUAGES.some((l) => l.value === it.language) ? it.language : 'other',
            content: it.content,
            tags: Array.isArray(it.tags) ? it.tags.filter((t: unknown) => typeof t === 'string').slice(0, 12) : [],
          });
          if (error) throw new Error(error.message);
        }
        void loadScripts();
        setToast(`Imported ${valid.length} script${valid.length !== 1 ? 's' : ''}`);
      } catch {
        setImportError('Import failed. Check the JSON file and database access; reload before retrying because earlier entries may already be saved.');
      }
    };
    reader.readAsText(file);
  };

  const lineCount = fContent ? fContent.split('\n').length : 0;
  const langCount = languageDist.length;
  const hasData = scripts.length > 0;

  return (
    <PageContainer>
      <PageHeader title="Scripts Library" subtitle="Saved code, registered devices, and reviewed remote execution" />

      {/* toast */}
      {toast && (
        <div className="fixed right-6 top-6 z-50 hud-panel clip-corner-both px-4 py-2 font-display text-xs uppercase tracking-wider text-accent-cyan">
          {toast}
        </div>
      )}

      {/* tactical header */}
      <div className="scripts-hero">
        <div><span className="scripts-eyebrow">OPERATIONS / SCRIPT WORKSPACE</span><h2>Keep the command.<br />Choose where it runs.</h2><p>{stats.total} saved scripts · {stats.languages} languages · {devices.filter((device) => device.registered).length} registered devices</p></div>
        <div className="scripts-hero-actions"><HudButton onClick={() => { setEditScript(null); setFTitle(''); setFDesc(''); setFLang('bash'); setFContent(''); setFTags(''); setShowModal(true); }}><Plus size={15} /> New script</HudButton><HudButton variant="ghost" onClick={() => { setShowDevices(true); void loadDevices(); }}><Server size={15} /> Register devices</HudButton></div>
      </div>

      {/* command palette search overlay */}
      <div className="relative mb-4">
        <label className="flex items-center gap-2 w-[280px] border border-border-line bg-bg-void px-3 py-2.5 clip-corner-small">
          <Search size={14} className="text-text-muted" />
          <input
            ref={gRef}
            value={gQuery}
            onChange={(e) => { setGQuery(e.target.value); setGOpen(true); }}
            onFocus={() => setGOpen(true)}
            onBlur={() => setTimeout(() => setGOpen(false), 150)}
            placeholder="GLOBAL SEARCH SCRIPTS..."
            className="w-full bg-transparent font-mono text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          <kbd className="shrink-0 border border-border-line px-1.5 py-0.5 font-mono text-[10px] text-accent-cyan">/</kbd>
        </label>
        {gOpen && gQuery.trim() && (
          <div className="gs-panel absolute right-0 top-full z-30 mt-2 w-[340px]">
            <div className="max-h-[60vh] overflow-y-auto py-1">
              {globalResults.length > 0 ? (
                globalResults.map((s) => (
                  <button
                    key={s.id}
                    className="gs-row w-full text-left"
                    onMouseDown={() => {
                      closeG();
                      setTimeout(() => {
                        const el = document.getElementById(`script-${s.id}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }, 100);
                    }}
                  >
                    <span
                      className="shrink-0 font-mono text-[9px] uppercase tracking-wider"
                      style={{ color: LANG_COLORS[s.language] ?? '#5b6b80' }}
                    >{s.language}</span>
                    <span className="flex-1 truncate font-mono text-xs text-text-primary">{s.title}</span>
                    <span className="shrink-0 font-mono text-[9px] text-text-muted">{s.copy_count}×</span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 font-mono text-xs text-text-muted">NO MATCHES</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* KEYS hint */}
      <p className="mb-4 font-display text-xs uppercase tracking-wider text-text-muted">
        KEYS — [ / ] GLOBAL SEARCH · [ 1-3 ] VIEWS · [ N ] NEW SCRIPT · [ ESC ] CLOSE
      </p>

      {/* ws-chip telemetry */}
      {/* ── analytics widgets — count-up stats + interactive donut + top copies ── */}
      {view !== 'workspace' && <><div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icon: Code2, label: 'Total Scripts', value: stats.total, color: '#26e2f6', sub: `${langCount} languages` },
          { icon: Star, label: 'Favorites', value: stats.favorites, color: '#facc15', sub: 'starred' },
          { icon: Copy, label: 'Total Copies', value: scripts.reduce((sum, s) => sum + s.copy_count, 0), color: '#4ade80', sub: 'clipboard hits' },
          { icon: BarChart3, label: 'Lines of Code', value: stats.lines, color: '#a78bea', sub: 'across library' },
        ].map((s, i) => (
          <div key={s.label} className="wg stat-lift entrance-reveal relative overflow-hidden p-3.5" style={{ animationDelay: `${i * 90}ms` }}>
            <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full" style={{ background: `radial-gradient(circle, ${s.color}26, transparent 70%)` }} />
            <div className="flex items-center gap-2 font-display text-[10px] uppercase tracking-[0.16em] text-text-muted">
              <s.icon size={14} style={{ color: s.color }} /> {s.label}
            </div>
            <div className="mt-1.5 flex items-end justify-between gap-2">
              <CountUp value={s.value} className="font-mono text-3xl font-bold leading-none" style={{ color: '#ddfeff' }} />
              <span className="truncate font-mono text-[9px] uppercase tracking-wider" style={{ color: s.color, opacity: 0.75 }}>{s.sub}</span>
            </div>
            <div className="mt-2.5 h-[2px] w-full overflow-hidden rounded-sm" style={{ background: 'rgba(45,212,191,0.08)' }}>
              <div className="h-full" style={{ width: `${Math.min(100, s.value * 2)}%`, background: s.color, boxShadow: `0 0 8px ${s.color}90`, transition: 'width 1s cubic-bezier(0.22,1,0.36,1)' }} />
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* language donut — click a row to filter */}
        <div className="wg entrance-reveal p-3.5" style={{ animationDelay: '360ms' }}>
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2 font-display text-xs uppercase tracking-wider text-text-muted">
              <Globe size={14} style={{ color: '#26e2f6' }} /> Distribution — by language
            </div>
            {langFilter && (
              <button onClick={() => setLangFilter('')} className="font-mono text-[10px] uppercase tracking-wider text-accent-cyan hover:text-accent-cyan-glow" title="Clear language filter">
                ✕ {langFilter}
              </button>
            )}
          </div>
          <LangDonut
            segs={languageDist.map(([lang, count]) => ({ label: lang, value: count, color: LANG_COLORS[lang] ?? '#5b6b80' }))}
            total={stats.total}
            active={langFilter || null}
            onSelect={(lang) => { setLangFilter(lang ?? ''); setPage(0); }}
          />
        </div>

        {/* top copied scripts */}
        <div className="wg entrance-reveal p-3.5" style={{ animationDelay: '440ms' }}>
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2 font-display text-xs uppercase tracking-wider text-text-muted">
              <Zap size={14} style={{ color: '#f0a020' }} /> Most copied
            </div>
            <span className="font-mono text-[10px] text-text-muted">{recentCopies.reduce((sum, s) => sum + s.copy_count, 0)} TOTAL</span>
          </div>
          {recentCopies.length === 0 ? (
            <p className="py-6 text-center font-display text-xs text-text-muted">No copies yet — scripts you copy will rank here.</p>
          ) : (
            <div className="max-h-[128px] space-y-1 overflow-y-auto pr-1">
              {recentCopies.map((s, i) => {
                const c = LANG_COLORS[s.language] ?? '#5b6b80';
                const max = recentCopies[0]?.copy_count || 1;
                return (
                  <button
                    key={s.id}
                    onClick={() => setDetailScript(s)}
                    className="group flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left transition-colors hover:bg-[rgba(38,226,246,0.06)]"
                    title={`Open ${s.title}`}
                  >
                    <span className="w-5 shrink-0 text-center font-mono text-[11px] font-bold" style={{ color: i === 0 ? '#f0a020' : '#5b6b80' }}>{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary transition-colors group-hover:text-accent-cyan">{s.title}</span>
                    <span className="hidden w-16 shrink-0 sm:inline">
                      <span className="block h-[3px] w-full overflow-hidden rounded-sm" style={{ background: 'rgba(45,212,191,0.08)' }}>
                        <span className="block h-full" style={{ width: `${(s.copy_count / max) * 100}%`, background: c, boxShadow: `0 0 6px ${c}90` }} />
                      </span>
                    </span>
                    <span className="w-10 shrink-0 text-right font-mono text-[10px]" style={{ color: '#26e2f6' }}>{s.copy_count}×</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      </>}
      {/* view tabs */}
      <div className="mb-4 flex items-center gap-1.5">
        <button onClick={() => setView('workspace')} className={`pc-tab ${view === 'workspace' ? 'on' : ''}`}><Terminal size={13} /> Workspace</button>
        <button
          onClick={() => setView('list')}
          className={`pc-tab ${view === 'list' ? 'on' : ''}`}
        >
          <span className="font-mono text-[10px] opacity-70">01</span>
          <LayoutList size={13} className="mr-1" />
          List
        </button>
        <button
          onClick={() => setView('grid')}
          className={`pc-tab ${view === 'grid' ? 'on' : ''}`}
        >
          <span className="font-mono text-[10px] opacity-70">02</span>
          <LayoutGrid size={13} className="mr-1" />
          Grid
        </button>

        {/* tag cloud */}
        {allTags.length > 0 && (
          <>
            <span className="h-4 w-px shrink-0" style={{ background: 'rgba(45,212,191,0.2)' }} />
            <div className="flex flex-wrap items-center gap-1.5">
              {allTags.slice(0, 10).map((tag) => {
                const active = tag === tagFilter;
                const idx = allTags.indexOf(tag);
                const c = TAG_COLORS[idx % TAG_COLORS.length];
                return (
                  <button
                    key={tag}
                    onClick={() => setTagFilter(active ? '' : tag)}
                    className={`ws-chip ${active ? 'on' : ''}`}
                    style={{
                      color: c,
                      borderColor: active ? c : `${c}55`,
                      ...(active ? { background: `${c}1a` } : {}),
                    }}
                  >
                    {tag}
                  </button>
                );
              })}
              {tagFilter && (
                <button
                  onClick={() => setTagFilter('')}
                  className="ws-chip on"
                  style={{ color: '#f87171', borderColor: '#f8717155' }}
                >
                  <X size={10} /> Clear
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <HudInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, description, tags, or code..."
          className="min-w-56 flex-1"
        />
        <HudSelect value={langFilter} onChange={(e) => setLangFilter(e.target.value)} className="w-40">
          <option value="">All Languages</option>
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </HudSelect>
        <HudSelect value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="w-44">
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="title">Title A-Z</option>
          <option value="copied">Most Copied</option>
        </HudSelect>
        <button
          onClick={() => setFavOnly((v) => !v)}
          className={`hud-btn clip-corner-small px-3 py-2.5 font-display text-xs uppercase tracking-wider transition-all ${favOnly ? 'text-accent-cyan-glow' : ''}`}
          style={favOnly ? { borderColor: '#26e2f6' } : undefined}
        >
          <Star size={13} className="mr-1.5 inline" style={{ color: '#facc15', fill: favOnly ? '#facc15' : 'none' }} />
          Favorites
        </button>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJSON(f);
              e.target.value = '';
            }}
          />
          <HudButton size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} className="mr-1 inline" />
            Import
          </HudButton>
          <HudButton size="sm" variant="ghost" onClick={exportJSON} disabled={filtered.length === 0}>
            <Download size={14} className="mr-1 inline" />
            Export
          </HudButton>
        </div>
      </div>
      {importError && (
        <div
          className="mb-3 border px-3 py-2 font-mono text-sm"
          style={{ borderColor: 'rgba(217,45,45,0.5)', color: '#f87171' }}
        >{importError}</div>
      )}

      {loadError && <div className="scripts-notice" role="alert">{loadError} <button onClick={() => void loadScripts()}>Retry</button></div>}
      {/* content */}
      {loading ? (
        <div className="wg py-12 flex flex-col items-center justify-center">
          <Code2 size={32} className="mb-3 text-text-muted opacity-40" />
          <p className="font-display text-sm text-text-muted">Loading script registry...</p>
        </div>
      ) : !hasData ? (
        <div className="wg py-12 flex flex-col items-center justify-center">
          <Code2 size={32} className="mb-3 text-text-muted opacity-40" />
          <p className="font-display text-sm text-text-muted">No scripts found. Add one to get started.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="wg py-12 flex flex-col items-center justify-center">
          <Search size={32} className="mb-3 text-text-muted opacity-40" />
          <p className="font-display text-sm text-text-muted">No scripts match the current filters.</p>
        </div>
      ) : view === 'workspace' ? (
        <div className="scripts-workspace">
          <aside className="scripts-browser" aria-label="Saved scripts">
            <div className="scripts-section-head"><span>LIBRARY / {filtered.length}</span><Files size={14} /></div>
            <div className="scripts-browser-items">{filtered.map((script) => <button key={script.id} id={`script-${script.id}`} className={`scripts-entry ${selectedScript?.id === script.id ? 'is-selected' : ''}`} onClick={() => { setSelectedId(script.id); setRunResults([]); setRunError(''); }}><span className="scripts-entry-language" style={{ color: LANG_COLORS[script.language] }}>{script.language}{script.favorite && <Star size={11} />}</span><strong>{script.title}</strong><span>{script.content.split('\n').length} lines · {formatRelative(script.updated_at)}</span><span className="scripts-entry-tags">{script.tags.slice(0, 3).join(' / ')}</span></button>)}</div>
          </aside>
          {selectedScript && <section className="scripts-editor" aria-label="Selected script">
            <div className="scripts-editor-title"><div><span className="scripts-eyebrow">SAVED SCRIPT</span><h3>{selectedScript.title}</h3></div><button className="hud-btn px-2 py-2" aria-label={selectedScript.favorite ? 'Remove favorite' : 'Favorite script'} onClick={() => void toggleFav(selectedScript)}><Star size={16} fill={selectedScript.favorite ? 'currentColor' : 'none'} /></button></div>
            {selectedScript.description && <div className="scripts-description" dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedScript.description) }} />}
            <TagChips tags={selectedScript.tags} onTagClick={(tag) => setTagFilter(tagFilter === tag ? '' : tag)} />
            <div className="scripts-code"><CodeBlock content={selectedScript.content} language={selectedScript.language} maxHeight={500} /></div>
            <div className="scripts-editor-actions"><TrackCopy script={selectedScript} onCopy={trackCopy} onToast={setToast} /><HudButton size="sm" variant="ghost" onClick={() => openEdit(selectedScript)}><Pencil size={13} /> Edit</HudButton><HudButton size="sm" variant="ghost" onClick={() => void duplicate(selectedScript)}><Files size={13} /> Duplicate</HudButton><HudButton size="sm" variant="ghost" onClick={() => setDeleteId(selectedScript.id)}><Trash2 size={13} /> Delete</HudButton></div>
          </section>}
          <aside className="scripts-execution" aria-label="Remote execution">
            <div className="scripts-section-head"><span>EXECUTION TARGETS</span><Server size={14} /></div>
            <p className="scripts-help">Run the saved version on selected SSH devices. Review the code and targets before confirming.</p>
            {deviceError && <p role="alert" className="scripts-notice">{deviceError}</p>}
            {!deviceError && !devices.some((device) => device.registered) && <div className="scripts-empty-targets"><Server size={26} /><p>No registered devices.</p><button onClick={() => setShowDevices(true)}>Register a provisioned device</button></div>}
            {devices.filter((device) => device.registered).map((device) => <label key={device.id} className="scripts-device"><input type="checkbox" checked={selectedDevices.includes(device.id)} disabled={running} onChange={(event) => setSelectedDevices((prev) => event.target.checked ? [...prev, device.id] : prev.filter((id) => id !== device.id))} /><span><strong>{device.name}</strong><small>{device.username}@{device.host}:{device.port}</small></span></label>)}
            <button className="scripts-run-button" disabled={running || !selectedScript || !['bash', 'python'].includes(selectedScript.language) || selectedDevices.length < 1 || selectedDevices.length > 5 || !!deviceError} onClick={() => setConfirmRun(selectedScript)}><Play size={15} />{running ? 'Running selected devices…' : `Review & run${selectedDevices.length ? ` on ${selectedDevices.length}` : ''}`}</button>
            <p className="scripts-help">Linux devices with GNU timeout and Bash / Python · up to 5 devices · 45s foreground timeout · 64 KiB output per device. Ansible and other formats remain available for copy/export.</p>
            {running && <p className="scripts-notice" role="status">Devices run in sequence. Keep this workspace open; a batch can take up to five minutes.</p>}
            {runError && <p className="scripts-notice" role="alert">{runError}</p>}
            {runResults.length > 0 && <p className="scripts-help">Results for {runTitle}</p>}
            {runResults.map((result) => <details className="scripts-result" key={result.deviceId} open><summary>{result.deviceName} / {result.timedOut ? 'TIMED OUT' : result.exitCode === 0 ? 'COMPLETED' : 'FAILED'}{result.exitCode !== null ? ` (${result.exitCode})` : ''}</summary><pre>{result.output || '(no output)'}</pre>{result.truncated && <p>Output limited to 64 KiB.</p>}</details>)}
            <div className="scripts-section-head scripts-history-head"><span>RECENT RUNS</span><button aria-label="Refresh execution history" onClick={() => void loadHistory()}><RefreshCw size={13} /></button></div>
            {runHistory.length === 0 ? <p className="scripts-help">No execution evidence yet.</p> : runHistory.slice(0, 8).map((run) => <div className="scripts-history-row" key={run.id}><strong>{run.metadata.scriptTitle ?? 'Saved script'}</strong><span>{run.metadata.deviceName ?? run.actor} · {run.metadata.status ?? run.outcome}</span><small>{formatRelative(run.created_at)}</small></div>)}
          </aside>
        </div>
      ) : view === 'list' ? (
        <div className="space-y-2">
          {paginated.map((script) => {
            const isExpanded = expanded.has(script.id);
            const langColor = LANG_COLORS[script.language] ?? '#5b6b80';
            const isDragging = dragId === script.id;
            return (
              <div
                key={script.id}
                draggable
                onDragStart={() => onDragStart(script.id)}
                onDragOver={onDragOver}
                onDrop={() => onDrop(script.id)}
                className={`wg clip-corner-both group ${isDragging ? 'opacity-40 ring-1 ring-accent-cyan' : ''}`}
              >
                <div
                  className="wg-head cursor-pointer"
                  onClick={() => toggleExpand(script.id)}
                >
                  <span className="cursor-grab text-text-muted hover:text-accent-cyan shrink-0" title="Drag to reorder"><GripVertical size={12} /></span>
                  <span
                    className="flex h-5 w-9 shrink-0 items-center justify-center border font-mono text-[8px] font-bold uppercase tracking-wider"
                    style={{ color: langColor, borderColor: `${langColor}55`, background: `${langColor}12`, borderRadius: 3 }}
                    title={script.language}
                  >
                    {script.language.slice(0, 4)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFav(script);
                    }}
                    className="shrink-0"
                    title={script.favorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star
                      size={15}
                      style={{
                        color: script.favorite ? '#facc15' : '#5b6b80',
                        fill: script.favorite ? '#facc15' : 'none',
                      }}
                    />
                  </button>
                  <span className="flex-1 truncate font-display text-sm font-semibold uppercase tracking-[0.12em] text-text-primary">
                    {script.title}
                  </span>
                  <span
                    className="shrink-0 font-display text-[9px] uppercase tracking-wider"
                    style={{ color: langColor }}
                  >{script.language}</span>
                  {script.tags.length > 0 && <TagChips tags={script.tags} />}
                  {script.copy_count > 0 && (
                    <span className="shrink-0 font-mono text-xs text-accent-cyan" title="Times copied">
                      <Copy size={11} className="mr-1 inline" />{script.copy_count}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-xs text-text-muted">
                    {formatRelative(script.updated_at)}
                  </span>
                  <span className="shrink-0 text-text-muted transition-transform group-hover:rotate-180">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </span>
                </div>
                {isExpanded && (
                  <div className="px-4 py-3">
                    {script.description && (
                      <div
                        className="markdown-body mb-3 text-sm text-text-muted"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(script.description) }}
                      />
                    )}
                    <CodeBlock content={script.content} language={script.language} maxHeight={384} />
                    <div className="mt-2.5 mb-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <HudButton size="sm" variant="ghost" onClick={() => openEdit(script)}>
                          <Pencil size={12} className="mr-1 inline" />Edit
                        </HudButton>
                        <HudButton size="sm" variant="ghost" onClick={() => duplicate(script)}>
                          <Files size={12} className="mr-1 inline" />Duplicate
                        </HudButton>
                        <button
                          onClick={() => setDeleteId(script.id)}
                          className="px-2 py-1.5 text-text-muted hover:text-alert-red transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <TrackCopy script={script} onCopy={trackCopy} onToast={setToast} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {paginated.map((script) => {
            const langColor = LANG_COLORS[script.language] ?? '#5b6b80';
            const preview = script.content.split('\n').slice(0, 8).join('\n');
            const isDragging = dragId === script.id;
            return (
              <div
                key={script.id}
                draggable
                onDragStart={() => onDragStart(script.id)}
                onDragOver={onDragOver}
                onDrop={() => onDrop(script.id)}
                className={`wg group flex flex-col transition-transform duration-200 hover:-translate-y-0.5 ${isDragging ? 'opacity-40 ring-1 ring-accent-cyan' : ''}`}
                style={{ borderTop: `2px solid ${langColor}` }}
              >
                <div className="wg-head">
                  <span
                    className="flex h-6 w-9 shrink-0 items-center justify-center border font-mono text-[8px] font-bold uppercase tracking-wider"
                    style={{ color: langColor, borderColor: `${langColor}55`, background: `${langColor}12`, borderRadius: 3 }}
                    title={script.language}
                  >
                    {script.language.slice(0, 4)}
                  </span>
                  <span className="min-w-0 flex-1 cursor-pointer truncate font-display text-sm font-semibold uppercase tracking-[0.12em] text-text-primary transition-colors group-hover:text-accent-cyan"
                    onClick={() => setDetailScript(script)} title="Open script">
                    {script.title}
                  </span>
                  <button
                    onClick={() => toggleFav(script)}
                    className="shrink-0 transition-transform hover:scale-110"
                    title={script.favorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star
                      size={15}
                      style={{
                        color: script.favorite ? '#facc15' : '#5b6b80',
                        fill: script.favorite ? '#facc15' : 'none',
                      }}
                    />
                  </button>
                </div>
                <div
                  className="flex-1 cursor-pointer px-3 py-2.5"
                  onClick={() => setDetailScript(script)}
                  title="Open script"
                >
                  <CodeBlock content={preview} language={script.language} maxHeight={120} />
                </div>
                <div className="flex flex-col gap-1.5 border-t border-border-line/60 px-3 py-2.5">
                  {script.description && (
                    <p className="line-clamp-1 text-xs text-text-muted">{script.description.replace(/[#*`]/g, '')}</p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {script.tags.length > 0 && <TagChips tags={script.tags.slice(0, 2)} />}
                      {script.copy_count > 0 && (
                        <span className="shrink-0 font-mono text-xs text-accent-cyan" title="Times copied">
                          <Copy size={11} className="mr-1 inline" />{script.copy_count}
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-xs text-text-muted">{formatRelative(script.updated_at)}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <HudButton size="sm" variant="ghost" onClick={() => setDetailScript(script)} title="Open">
                        <Eye size={12} />
                      </HudButton>
                      <TrackCopy script={script} onCopy={trackCopy} onToast={setToast} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* pagination */}
      {isPaginated && (
        <div className="mt-3 flex items-center justify-between border border-border-line bg-bg-panel px-3 py-2 clip-corner-small">
          <span className="font-mono text-[10px] text-text-muted">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex gap-1.5">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="hud-btn clip-corner-small px-2.5 py-1 text-[10px]">Prev</button>
            <button onClick={() => setPage((p) => Math.min(Math.ceil(filtered.length / PAGE_SIZE) - 1, p + 1))} disabled={page >= Math.ceil(filtered.length / PAGE_SIZE) - 1} className="hud-btn clip-corner-small px-2.5 py-1 text-[10px]">Next</button>
          </div>
        </div>
      )}

      {/* Detail modal (grid view) */}
      <HudModal open={!!detailScript} onClose={() => setDetailScript(null)} title={detailScript ? detailScript.title : ''}>
        {detailScript && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="pc-chip"
                style={{
                  color: LANG_COLORS[detailScript.language] ?? '#5b6b80',
                  borderColor: `${LANG_COLORS[detailScript.language] ?? '#5b6b80'}55`,
                }}
              >{detailScript.language}</span>
              <TagChips tags={detailScript.tags} />
              <span className="ml-auto font-mono text-xs text-text-muted">
                UPDATED {formatRelative(detailScript.updated_at)}
              </span>
            </div>
            {detailScript.description && (
              <div
                className="markdown-body border border-border-line bg-bg-void p-3 text-sm text-text-muted"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(detailScript.description) }}
              />
            )}
            <CodeBlock content={detailScript.content} language={detailScript.language} maxHeight={420} />
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <HudButton size="sm" variant="ghost" onClick={() => openEdit(detailScript)}>
                  <Pencil size={12} className="mr-1 inline" />Edit
                </HudButton>
                <HudButton size="sm" variant="ghost" onClick={() => duplicate(detailScript)}>
                  <Files size={12} className="mr-1 inline" />Duplicate
                </HudButton>
                <button
                  onClick={() => setDeleteId(detailScript.id)}
                  className="px-2 py-1.5 text-text-muted hover:text-alert-red transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <TrackCopy script={detailScript} onCopy={trackCopy} onToast={setToast} />
            </div>
          </div>
        )}
      </HudModal>

      {/* Add/Edit Modal */}
      <HudModal open={showModal} onClose={() => setShowModal(false)} title={editScript ? 'Edit Script' : 'Add Script'}>
        <div className="space-y-4">
          <HudInput
            label="Title"
            value={fTitle}
            onChange={(e) => setFTitle(e.target.value)}
            placeholder="Script title..."
          />
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-display text-xs uppercase tracking-wider text-text-muted">Description</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setDescMode('edit')}
                  className={`px-2 py-1 font-display text-xs uppercase tracking-wider transition-colors ${
                    descMode === 'edit' ? 'text-accent-cyan' : 'text-text-muted hover:text-text-primary'
                  }`}
                >Edit</button>
                <button
                  onClick={() => setDescMode('preview')}
                  className={`px-2 py-1 font-display text-xs uppercase tracking-wider transition-colors ${
                    descMode === 'preview' ? 'text-accent-cyan' : 'text-text-muted hover:text-text-primary'
                  }`}
                >Preview</button>
              </div>
            </div>
            {descMode === 'edit' ? (
              <HudTextarea value={fDesc} onChange={(e) => setFDesc(e.target.value)} rows={3} placeholder="What does this script do? (Markdown supported)" />
            ) : (
              <div
                className="markdown-body min-h-16 border border-border-line bg-bg-void p-3 text-sm text-text-muted"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(fDesc) }}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HudSelect label="Language" value={fLang} onChange={(e) => setFLang(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </HudSelect>
            <HudInput
              label="Tags (comma-separated)"
              value={fTags}
              onChange={(e) => setFTags(e.target.value)}
              placeholder="deploy, backup"
              list="scripts-tags-list"
            />
            <datalist id="scripts-tags-list">
              {allTags.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs text-text-muted">SUGGESTED:</span>
              {allTags.filter((t) => !fTags.split(',').map((x) => x.trim()).includes(t)).slice(0, 10).map((tag) => (
                <button
                  key={tag}
                  onClick={() => setFTags((v) => (v.trim() ? `${v.trim()}, ${tag}` : tag))}
                  className="border border-border-line px-1.5 py-0.5 font-mono text-xs text-text-muted hover:text-accent-cyan clip-corner-small transition-colors"
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(38,226,246,0.5)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = '';
                  }}
                >{tag}</button>
              ))}
            </div>
          )}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-display text-xs uppercase tracking-wider text-text-muted">Code</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-text-muted">{lineCount} LINES</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setCodeMode('edit')}
                    className={`px-2 py-1 font-display text-xs uppercase tracking-wider transition-colors ${
                      codeMode === 'edit' ? 'text-accent-cyan' : 'text-text-muted hover:text-text-primary'
                    }`}
                  >Edit</button>
                  <button
                    onClick={() => setCodeMode('preview')}
                    className={`px-2 py-1 font-display text-xs uppercase tracking-wider transition-colors ${
                      codeMode === 'preview' ? 'text-accent-cyan' : 'text-text-muted hover:text-text-primary'
                    }}`}
                  >Preview</button>
                </div>
              </div>
            </div>
            {codeMode === 'edit' ? (
              <textarea
                value={fContent}
                onChange={(e) => setFContent(e.target.value)}
                rows={12}
                className="hud-input clip-corner-small w-full px-3 py-2 text-sm font-mono"
                placeholder="#!/bin/bash..."
              />
            ) : (
              <CodeBlock content={fContent || '// no code yet'} language={fLang} maxHeight={300} />
            )}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <HudButton variant="ghost" onClick={() => setShowModal(false)}>Cancel</HudButton>
            <HudButton onClick={save} disabled={saving || !fTitle.trim() || !fContent.trim()}>
              {saving ? 'Saving…' : editScript ? 'Update' : 'Create'}
            </HudButton>
          </div>
        </div>
      </HudModal>

      <HudModal open={showDevices} onClose={() => setShowDevices(false)} title="Register execution devices">
        <div className="space-y-4"><p className="scripts-help">Choose one or multiple devices provisioned by your platform administrator. SSH credentials and verified host keys are held by the backend.</p>
          {deviceError && <p className="scripts-notice" role="alert">{deviceError}</p>}
          {!devices.length && <div className="scripts-notice">No SSH profiles configured. An administrator must provision a read-only device configuration, private keys and pinned known_hosts in the backend before enrollment. See the script device setup guide.</div>}
          {devices.map((device) => <label className="scripts-device" key={device.id}><input type="checkbox" checked={deviceDraft.includes(device.id)} disabled={saving} onChange={(event) => setDeviceDraft((prev) => event.target.checked ? [...prev, device.id] : prev.filter((id) => id !== device.id))} /><span><strong>{device.name}</strong><small>{device.username}@{device.host}:{device.port}</small></span></label>)}
          <p className="scripts-help">Removing a registration removes it from future runs. Existing execution evidence stays in history.</p>
          <div className="flex justify-end gap-3"><HudButton variant="ghost" onClick={() => setShowDevices(false)}>Cancel</HudButton><HudButton onClick={() => void registerDevices()} disabled={saving || !devices.length || !!deviceError}>{saving ? 'Saving…' : 'Save registrations'}</HudButton></div>
        </div>
      </HudModal>
      <ConfirmDialog open={!!confirmRun} onClose={() => setConfirmRun(null)} onConfirm={() => void execute()} title="Confirm remote execution" confirmLabel="Execute saved script" message={<div className="space-y-3"><p>Execute <strong>{confirmRun?.title}</strong> as the provisioned SSH account on these devices?</p><ul className="space-y-1">{devices.filter((device) => selectedDevices.includes(device.id)).map((device) => <li key={device.id}>{device.name} — {device.username}@{device.host}:{device.port}</li>)}</ul><p>This can change or delete remote data. Scripts execute with the SSH account's permissions. The timeout limits the foreground command; detached processes can continue. Output is shown here and is not stored in history.</p></div>} />
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={remove}
        title="Delete Script"
        message="Remove this script permanently?"
        confirmLabel="Delete"
      />
    </PageContainer>
  );
}
