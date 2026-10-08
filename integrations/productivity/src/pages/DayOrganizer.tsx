import { eventTarget } from "@/lib/dom";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarHeart,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GripVertical,
  LayoutGrid,
  Link as LinkIcon,
  ListTodo,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Search,
  StickyNote,
  Timer,
  Trash2,
  Zap,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDuration, parseDateString, toDateString } from '@/lib/utils';
import { PageContainer } from '@/components/PageLayout';
import './day-organizer.css';
import { HudButton } from '@/components/HudButton';
import { HudInput, HudSelect, HudTextarea } from '@/components/HudInputs';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { HudModal } from '@/components/HudModal';
import { parseNonNegativeInteger } from '@/lib/day-reminders';

export interface CalendarItem {
  id: string;
  date: string;
  time: string | null;
  title: string;
  type: string;
  link: string | null;
  done: boolean;
  priority: string;
  duration_min: number;
  notify_minutes: number;
  notify_message: string | null;
  reminder_time: string | null;
  notes: string;
  sort_order: number;
  created_at: string;
}

interface DailyEntry {
  date: string;
  raw_notes: string;
  ai_summary: string;
}

type ViewMode = 'timeline' | 'list' | 'week' | 'notes';

const ITEM_TYPES = [
  { value: 'task', label: 'Task' },
  { value: 'course', label: 'Course' },
  { value: 'game', label: 'Game' },
  { value: 'rest', label: 'Rest' },
  { value: 'other', label: 'Other' },
];

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const TYPE_COLORS: Record<string, string> = {
  task: '#2de2e6',
  course: '#7cf7f9',
  game: '#f0a020',
  rest: '#5d7f88',
  other: '#0e7a8a',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: '#5d7f88',
  medium: '#2de2e6',
  high: '#f0a020',
  critical: '#d92d2d',
};

const TIMER_PRESETS = [
  { label: 'Focus 25', sec: 1500, kind: 'focus' },
  { label: 'Break 5', sec: 300, kind: 'break' },
  { label: 'Focus 50', sec: 3000, kind: 'focus' },
  { label: 'Break 10', sec: 600, kind: 'break' },
];

const TIMER_KEY = 'hephastos_day_timer_v1';

const TABS: { id: ViewMode; label: string; icon: React.ElementType }[] = [
  { id: 'list', label: 'Tasks', icon: ListTodo },
  { id: 'timeline', label: 'Schedule', icon: Clock3 },
  { id: 'week', label: 'Week', icon: LayoutGrid },
  { id: 'notes', label: 'Notes', icon: StickyNote },
];
export function plannerScheduleConflicts(items: CalendarItem[]) {
  const timed = items.filter(item => !item.done && item.time);
  const unknown = timed.filter(item => !Number.isFinite(item.duration_min) || item.duration_min <= 0 || !Number.isFinite(new Date(`${item.date}T${item.time}`).getTime()));
  const unknownItems = new Set(unknown);
  const spans = timed.filter(item => !unknownItems.has(item)).slice(0,300).map(item => ({ item, start: new Date(`${item.date}T${item.time}`).getTime(), end: new Date(`${item.date}T${item.time}`).getTime() + item.duration_min * 60_000 })).sort((a,b) => a.start - b.start);
  const pairs: { first: CalendarItem; second: CalendarItem }[] = [];
  let active: typeof spans = [];
  let partial = timed.length - unknown.length > 300;
  for (const span of spans) {
    active = active.filter(entry => entry.end > span.start);
    for (const entry of active) { if (pairs.length >= 50) { partial = true; break; } pairs.push({ first: entry.item, second: span.item }); }
    active.push(span);
  }
  return { pairs, unknown, partial };
}

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatPlannerTime(time: string, hour12: boolean): string {
  const [hour, minute] = time.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return time;
  return hour12 ? `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}` : `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function filterDayItems(items: CalendarItem[], search: string, type: string, status: string, priority: string) {
  const query = search.trim().toLowerCase();
  return items.filter((item) =>
    (type === 'all' || item.type === type) &&
    (priority === 'all' || item.priority === priority) &&
    (status === 'all' || (status === 'completed' ? item.done : status === 'scheduled' ? !item.done && !!item.time : status === 'flexible' ? !item.done && !item.time : !item.done)) &&
    (!query || `${item.title} ${item.notes ?? ''}`.toLowerCase().includes(query)),
  );
}

export function reorderDayItems(items: CalendarItem[], sourceId: string, targetId: string) {
  const result = [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at.localeCompare(b.created_at));
  const from = result.findIndex((item) => item.id === sourceId);
  const to = result.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) return result;
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result.map((item, sort_order) => ({ ...item, sort_order }));
}

function ItemRow({ item, onToggle, onEdit, onDelete, onUp, onDown, canUp, canDown, hour12, busy, selecting, selected, onSelect, draggable, onDragStart, onDragOver, onDrop, onDragEnd, isDragging }: {
  item: CalendarItem;
  onToggle: (item: CalendarItem) => void;
  onEdit: (item: CalendarItem) => void;
  onDelete: (item: CalendarItem) => void;
  onUp?: (item: CalendarItem) => void;
  onDown?: (item: CalendarItem) => void;
  canUp?: boolean;
  canDown?: boolean;
  hour12: boolean;
  busy: boolean;
  selecting?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  const externalLink = item.link && /^https?:\/\//i.test(item.link) ? item.link : null;
  return (
    <article id={`item-${item.id}`} draggable={draggable && !busy} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd}
      className={`planner-task ${item.done ? 'is-complete' : ''} ${selected ? 'is-selected' : ''} ${isDragging ? 'is-dragging' : ''}`}>
      {selecting && <input type="checkbox" aria-label={`Select ${item.title}`} checked={!!selected} disabled={busy} onChange={() => onSelect?.(item.id)} className="planner-select-checkbox" />}
      <button onClick={() => onToggle(item)} disabled={busy} aria-label={`${item.done ? 'Mark incomplete' : 'Complete'}: ${item.title}`} aria-pressed={item.done} className="planner-checkbox">
        {item.done && <Check size={15} />}
      </button>
      <div className="planner-task-copy">
        <button onClick={() => onEdit(item)} disabled={busy} className="planner-task-title">{item.title}</button>
        <div className="planner-task-meta">
          {item.time && <span><Clock3 size={12} />{formatPlannerTime(item.time, hour12)}</span>}
          {item.duration_min > 0 && <span>{item.duration_min} min</span>}
          <span className="planner-type-label" style={{ color: TYPE_COLORS[item.type] }}>{ITEM_TYPES.find((type) => type.value === item.type)?.label ?? item.type}</span>
          {(item.priority === 'high' || item.priority === 'critical') && <span className="planner-priority-label" style={{ color: PRIORITY_COLORS[item.priority] }}>{item.priority === 'critical' ? 'Critical' : 'High priority'}</span>}
          {item.reminder_time && <span title={item.notify_message ?? undefined}>Reminder {formatPlannerTime(item.reminder_time, hour12)}</span>}
          {item.time && !item.reminder_time && <span title={item.notify_message ?? undefined}>{item.notify_minutes === 0 ? 'Alert at start' : `Alert ${item.notify_minutes ?? 10}m before`}</span>}
        </div>
        {item.notes && <p className="planner-task-note">{item.notes}</p>}
      </div>
      {externalLink && <a href={externalLink} target="_blank" rel="noopener noreferrer" aria-label={`Open link for ${item.title}`} className="planner-icon-button"><LinkIcon size={16} /></a>}
      {draggable && <GripVertical size={15} className="planner-drag-handle" aria-hidden="true" />}
      <details className="planner-task-menu">
        <summary aria-label={`Actions for ${item.title}`} className="planner-icon-button"><MoreHorizontal size={19} /></summary>
        <div>
          <button disabled={busy} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onEdit(item); }}><Pencil size={14} /> Edit task</button>
          {onUp && <button disabled={busy || !canUp} onClick={() => onUp(item)}><ArrowUp size={14} /> Move up</button>}
          {onDown && <button disabled={busy || !canDown} onClick={() => onDown(item)}><ArrowDown size={14} /> Move down</button>}
          <button disabled={busy} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onDelete(item); }} className="planner-delete-action"><Trash2 size={14} /> Delete task</button>
        </div>
      </details>
    </article>
  );
}

function ItemEditModal({ item, onClose, onSave }: {
  item: CalendarItem | null;
  onClose: () => void;
  onSave: (values: Partial<CalendarItem>) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('task');
  const [time, setTime] = useState('');
  const [priority, setPriority] = useState('medium');
  const [duration, setDuration] = useState('0');
  const [notifyMinutes, setNotifyMinutes] = useState('10');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [link, setLink] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setSaveError(null);
    setTitle(item.title);
    setType(item.type);
    setTime(item.time ? item.time.slice(0, 5) : '');
    setPriority(item.priority);
    setDuration(String(item.duration_min ?? 0));
    setNotifyMinutes(String(item.notify_minutes ?? 10));
    setNotifyMessage(item.notify_message ?? '');
    setReminderTime(item.reminder_time ? item.reminder_time.slice(0, 5) : '');
    setLink(item.link ?? '');
    setDate(item.date);
    setNotes(item.notes ?? '');
  }, [item]);

  if (!item) return null;

  const save = async () => {
    if (link.trim() && !/^https?:\/\/\S+$/i.test(link.trim())) {
      setSaveError('Use a complete http:// or https:// link.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
    const saved = await onSave({
      title: title.trim() || item.title,
      type,
      time: time || null,
      priority,
      duration_min: parseNonNegativeInteger(duration, 0),
      notify_minutes: parseNonNegativeInteger(notifyMinutes, 10),
      notify_message: notifyMessage.trim() || null,
      reminder_time: reminderTime || null,
      link: link.trim() || null,
      date: date || item.date,
      notes,
    });
    if (saved) onClose();
    else setSaveError('Changes could not be saved. Your draft is still here; please try again.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save changes. Please try again.');
    } finally { setSaving(false); }
  };

  return (
    <HudModal open={!!item} onClose={onClose} title="Task details" className="planner-detail-modal">
      <p className="mb-4 text-xs text-text-muted">Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. An exact reminder replaces the minutes-before alert; the start-time alert still applies.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <HudInput label="Title" maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <HudSelect label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          {ITEM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </HudSelect>
        <HudSelect label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </HudSelect>
        <div>
          <HudInput label="Scheduled time (optional)" type="time" step={60} value={time} onChange={(e) => setTime(e.target.value)} />
          {time ? <button type="button" onClick={() => setTime('')} className="mt-2 text-xs text-accent-cyan">Clear scheduled time</button> : <p className="mt-2 text-xs text-text-muted">Unscheduled</p>}
        </div>
        <HudInput label="Duration (min)" type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
        <HudInput label="Alert — minutes before (0 = at start)" type="number" min={0} disabled={!!reminderTime} value={notifyMinutes} onChange={(e) => setNotifyMinutes(e.target.value)} />
        <HudInput label="Exact reminder time (optional)" type="time" step={60} value={reminderTime} onChange={(e) => setReminderTime(e.target.value)} />
        <HudInput label="Custom alert message" value={notifyMessage} onChange={(e) => setNotifyMessage(e.target.value)} placeholder="Custom notification text (optional)..." />
        <HudInput label="Link (https://…)" type="url" value={link} onChange={(e) => setLink(e.target.value)} />
        <HudInput label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="sm:col-span-2">
          <HudTextarea label="Notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <HudButton variant="ghost" onClick={onClose} disabled={saving}>Cancel</HudButton>
        <HudButton onClick={() => void save()} disabled={saving || !title.trim()}>{saving ? 'Saving…' : 'Save Changes'}</HudButton>
      </div>
      {saveError && <p role="alert" className="mt-3 text-sm text-red-300">{saveError}</p>}
    </HudModal>
  );
}

function FocusTimer() {
  const [durationSec, setDurationSec] = useState(1500);
  const [remaining, setRemaining] = useState(1500);
  const [running, setRunning] = useState(false);
  const [kind, setKind] = useState<'focus' | 'break'>('focus');
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [customMin, setCustomMin] = useState('');
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = (s: { durationSec: number; remaining: number; running: boolean; kind: 'focus' | 'break'; endsAt: number | null }) => {
    try {
      localStorage.setItem(TIMER_KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable — timer keeps running in memory only */
    }
  };

  // restore from localStorage (survives refresh/navigation)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TIMER_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s?.durationSec !== 'number') return;
      let rem = s.remaining;
      let stillRunning = s.running;
      if (s.running && typeof s.endsAt === 'number') {
        rem = Math.max(0, Math.round((s.endsAt - Date.now()) / 1000));
        if (rem === 0) stillRunning = false;
      }
      setDurationSec(s.durationSec);
      setRemaining(rem);
      setRunning(stillRunning);
      setKind(s.kind === 'break' ? 'break' : 'focus');
      setEndsAt(stillRunning && rem > 0 ? s.endsAt : null);
    } catch {
      /* corrupt state — fall back to defaults */
    }
  }, []);

  // live countdown
  useEffect(() => {
    if (!running || !endsAt) return;
    const t = setInterval(() => {
      const rem = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      setRemaining(rem);
      if (rem === 0) {
        setRunning(false);
        setEndsAt(null);
        setFlash(true);
        if (flashRef.current) clearTimeout(flashRef.current);
        flashRef.current = setTimeout(() => setFlash(false), 5000);
        persist({ durationSec, remaining: 0, running: false, kind, endsAt: null });
      }
    }, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, endsAt]);

  const start = (sec: number, k: 'focus' | 'break') => {
    const e = Date.now() + sec * 1000;
    setDurationSec(sec);
    setRemaining(sec);
    setKind(k);
    setRunning(true);
    setEndsAt(e);
    persist({ durationSec: sec, remaining: sec, running: true, kind: k, endsAt: e });
  };

  const pause = () => {
    setRunning(false);
    setEndsAt(null);
    persist({ durationSec, remaining, running: false, kind, endsAt: null });
  };

  const resume = () => {
    if (remaining <= 0) {
      start(durationSec, kind);
      return;
    }
    const e = Date.now() + remaining * 1000;
    setRunning(true);
    setEndsAt(e);
    persist({ durationSec, remaining, running: true, kind, endsAt: e });
  };

  const reset = () => {
    setRunning(false);
    setEndsAt(null);
    setRemaining(durationSec);
    persist({ durationSec, remaining: durationSec, running: false, kind, endsAt: null });
  };

  const applyCustom = () => {
    const m = Math.min(240, Math.max(1, parseInt(customMin, 10) || 25));
    setCustomMin('');
    start(m * 60, 'focus');
  };

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const pct = durationSec > 0 ? (remaining / durationSec) * 100 : 0;
  const ringColor = flash ? '#d92d2d' : kind === 'break' ? '#f0a020' : '#2de2e6';

  return (
    <section className="wg planner-focus" aria-label="Focus timer">
      <div className="wg-head">
        <Timer size={15} style={{ color: ringColor }} />
        <span className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-accent-cyan">Focus Timer</span>
        <span className="ml-auto font-mono text-[10px] text-text-muted">[{flash ? 'TIME UP' : kind === 'break' ? 'BREAK' : 'FOCUS'}]</span>
      </div>
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-shrink-0">
            <div className="planner-timer-digits" role="timer" aria-label={`${mm} minutes ${ss} seconds`}>{mm}<span>:</span>{ss}</div>
            <div className="planner-progress-track"><div style={{ width: `${pct}%`, background: ringColor }} /></div>
            <div className="mt-1 font-display text-[9px] uppercase tracking-widest" style={{ color: ringColor }}>
              {flash ? 'Time Up' : kind === 'break' ? 'Break' : 'Focus'}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {TIMER_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => start(p.sec, p.kind as 'focus' | 'break')}
                className={`border px-1.5 py-1 font-display text-[9px] uppercase tracking-wider transition-colors clip-corner-small ${
                  kind === p.kind && durationSec === p.sec
                    ? 'border-accent-cyan text-accent-cyan'
                    : 'border-border-line text-text-muted hover:border-accent-cyan hover:text-accent-cyan'
                }`}
              >
                {p.label}
              </button>
            ))}
            <div className="ml-1 flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={240}
                value={customMin}
                onChange={(e) => setCustomMin(e.target.value)}
                placeholder="min"
                aria-label="Custom focus duration in minutes"
                className="hud-input clip-corner-small w-14 px-2 py-1 font-mono text-xs"
              />
              <button
                onClick={applyCustom}
                className="border border-border-line px-1.5 py-1 font-display text-[9px] uppercase text-text-muted transition-colors hover:border-accent-cyan hover:text-accent-cyan"
              >
                Set
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {!running ? (
              <button onClick={resume} title="Start" aria-label="Start focus timer" className="hud-btn clip-corner-small p-2 text-accent-cyan">
                <Play size={16} />
              </button>
            ) : (
              <button onClick={pause} title="Pause" aria-label="Pause focus timer" className="hud-btn clip-corner-small p-2 text-warn-amber">
                <Pause size={16} />
              </button>
            )}
            <button onClick={reset} title="Reset" aria-label="Reset focus timer" className="hud-btn clip-corner-small p-2 text-text-muted hover:text-alert-red">
              <RotateCcw size={16} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- main page ---------- */

export function DayOrganizer() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [view, setView] = useState<ViewMode>('list');
  const [items, setItems] = useState<CalendarItem[]>([]);
  const scheduleReview = useMemo(() => plannerScheduleConflicts(items), [items]);
  const [entry, setEntry] = useState<DailyEntry | null>(null);
  const [weekItems, setWeekItems] = useState<CalendarItem[]>([]);
  const [monthStats, setMonthStats] = useState<Record<string, { total: number; done: number }>>({});
  const [loading, setLoading] = useState(true);
  const [dayReady, setDayReady] = useState(false);
  const [weekLoading, setWeekLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [monthError, setMonthError] = useState<string | null>(null);
  const overviewError = weekError ?? monthError;
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const writeLock = useRef(false);
  const dayLoadSequence = useRef(0);
  const weekLoadSequence = useRef(0);
  const monthLoadSequence = useRef(0);
  const [editing, setEditing] = useState<CalendarItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [moveDate, setMoveDate] = useState('');
  const [focusId, setFocusId] = useState('');
  const [now, setNow] = useState(new Date());
  const [hour12, setHour12] = useState(() => {
    try { return localStorage.getItem('hephastos_day_hour12') !== 'false'; } catch { return true; }
  });

  const [qTitle, setQTitle] = useState('');
  const [qType, setQType] = useState('task');
  const [qTime, setQTime] = useState('');
  const [qPriority, setQPriority] = useState('medium');
  const [qDuration, setQDuration] = useState('');
  const [qReminder, setQReminder] = useState('10');
  const [qExactReminder, setQExactReminder] = useState('');
  const [qMessage, setQMessage] = useState('');
  const qTitleRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [fType, setFType] = useState('all');
  const [fStatus, setFStatus] = useState('all');
  const [fPriority, setFPriority] = useState('all');
  const [sort, setSort] = useState('manual');
  const [showCompleted, setShowCompleted] = useState(false);
  const [rawNotes, setRawNotes] = useState('');
  const [summary, setSummary] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesStatus, setNotesStatus] = useState('');
  const notesDirty = rawNotes !== (entry?.raw_notes ?? '') || summary !== (entry?.ai_summary ?? '');
  const dateStr = toDateString(selectedDate);
  const today = toDateString(now);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Request failed. Please try again.';

  const weekDays = useMemo(() => {
    const start = new Date(selectedDate);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(day.getDate() + index);
      return day;
    });
  }, [dateStr]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekStart = toDateString(weekDays[0]);
  const weekEnd = toDateString(weekDays[6]);

  const loadData = useCallback(async () => {
    const sequence = ++dayLoadSequence.current;
    setLoading(true);
    setDayReady(false);
    try {
      const [tasks, notes] = await Promise.all([
        supabase.from('calendar_items').select('*').eq('date', dateStr).order('sort_order'),
        supabase.from('daily_entries').select('*').eq('date', dateStr).maybeSingle(),
      ]);
      if (sequence !== dayLoadSequence.current) return;
      if (tasks.error || notes.error) throw new Error(tasks.error?.message ?? notes.error?.message);
      const nextEntry = notes.data as DailyEntry | null;
      setItems((tasks.data ?? []) as CalendarItem[]);
      setEntry(nextEntry);
      let draft: { raw_notes: string; ai_summary: string } | null = null;
      try {
        const stored = JSON.parse(localStorage.getItem('hephastos_day_notes_' + dateStr) ?? 'null');
        if (typeof stored?.raw_notes === 'string' && typeof stored?.ai_summary === 'string') draft = stored;
      } catch { /* Saved database notes remain usable if browser storage is unavailable. */ }
      setRawNotes(draft?.raw_notes ?? nextEntry?.raw_notes ?? '');
      setSummary(draft?.ai_summary ?? nextEntry?.ai_summary ?? '');
      setNotesStatus(draft ? 'Unsaved draft restored' : '');
      setSelectedIds([]);
      setPageError(null);
      setDayReady(true);
    } catch (error) {
      if (sequence === dayLoadSequence.current) setPageError('Could not load this day: ' + errorMessage(error));
    } finally {
      if (sequence === dayLoadSequence.current) setLoading(false);
    }
  }, [dateStr]);

  const loadWeek = useCallback(async () => {
    const sequence = ++weekLoadSequence.current;
    setWeekLoading(true);
    try {
      const { data, error } = await supabase.from('calendar_items').select('*').gte('date', weekStart).lte('date', weekEnd).order('time', { nullsFirst: false });
      if (sequence !== weekLoadSequence.current) return;
      if (error) throw new Error(error.message);
      setWeekItems((data ?? []) as CalendarItem[]);
      setWeekError(null);
    } catch (error) {
      if (sequence === weekLoadSequence.current) setWeekError('Week overview unavailable: ' + errorMessage(error));
    } finally {
      if (sequence === weekLoadSequence.current) setWeekLoading(false);
    }
  }, [weekStart, weekEnd]);

  const loadMonth = useCallback(async () => {
    const sequence = ++monthLoadSequence.current;
    try {
      const { data, error } = await supabase.from('calendar_items').select('date,done').gte('date', toDateString(new Date(viewYear, viewMonth, 1))).lte('date', toDateString(new Date(viewYear, viewMonth + 1, 0)));
      if (sequence !== monthLoadSequence.current) return;
      if (error) throw new Error(error.message);
      const stats: Record<string, { total: number; done: number }> = {};
      for (const row of data ?? []) {
        stats[row.date] ??= { total: 0, done: 0 };
        stats[row.date].total += 1;
        if (row.done) stats[row.date].done += 1;
      }
      setMonthStats(stats);
      setMonthError(null);
    } catch (error) {
      if (sequence === monthLoadSequence.current) setMonthError('Calendar totals unavailable: ' + errorMessage(error));
    }
  }, [viewMonth, viewYear]);

  useEffect(() => { void loadData(); return () => { dayLoadSequence.current += 1; }; }, [loadData]);
  useEffect(() => { void loadWeek(); return () => { weekLoadSequence.current += 1; }; }, [loadWeek]);
  useEffect(() => { void loadMonth(); return () => { monthLoadSequence.current += 1; }; }, [loadMonth]);
  useEffect(() => {
    if (!dayReady) return;
    try {
      if (notesDirty) localStorage.setItem('hephastos_day_notes_' + dateStr, JSON.stringify({ raw_notes: rawNotes, ai_summary: summary }));
      else localStorage.removeItem('hephastos_day_notes_' + dateStr);
    } catch { /* The visible draft can still be saved to the database. */ }
  }, [dayReady, dateStr, notesDirty, rawNotes, summary]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notesDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [notesDirty]);

  const refreshOverview = () => { void loadWeek(); void loadMonth(); };
  const selectDay = (day: Date) => {
    if (writeLock.current || notesSaving || toDateString(day) === dateStr) return;
    if (notesDirty && !window.confirm('Your daily notes have unsaved changes. Leave this day without saving?')) return;
    dayLoadSequence.current += 1;
    setSelectedDate(day);
    setViewMonth(day.getMonth());
    setViewYear(day.getFullYear());
    setItems([]);
    setEntry(null);
    setRawNotes('');
    setSummary('');
    setLoading(true);
    setDayReady(false);
    setFocusId('');
    setSelectedIds([]);
    setSelecting(false);
    setNotice('');
    setNotesStatus('');
  };
  const moveDay = (offset: number) => {
    const day = new Date(selectedDate);
    day.setDate(day.getDate() + offset * (view === 'week' ? 7 : 1));
    selectDay(day);
  };
  const captureTask = () => {
    qTitleRef.current?.focus();
    qTitleRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = eventTarget(event) as HTMLElement;
      if (event.ctrlKey || event.metaKey || event.altKey || editing || deleteId || target?.isContentEditable || target?.closest('[role="dialog"]') || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY'].includes(target?.tagName)) return;
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); }
      else if (event.key.toLowerCase() === 'n') { event.preventDefault(); captureTask(); }
      else if (/^[1-4]$/.test(event.key)) setView(TABS[Number(event.key) - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, deleteId]);

  const addItem = async () => {
    const title = qTitle.trim();
    if (!title || writeLock.current || !dayReady) return;
    writeLock.current = true;
    setBusy(true);
    try {
      const { data, error } = await supabase.from('calendar_items').insert({
        date: dateStr, title, type: qType, time: qTime || null, priority: qPriority,
        duration_min: parseNonNegativeInteger(qDuration, 0),
        notify_minutes: parseNonNegativeInteger(qReminder, 10),
        notify_message: qMessage.trim() || null, reminder_time: qExactReminder || null,
        notes: '', sort_order: items.length ? Math.max(...items.map((item) => item.sort_order ?? 0)) + 1 : 0,
      }).select().single();
      if (error || !data) throw new Error(error?.message ?? 'No task was returned.');
      setItems((current) => [...current, data as CalendarItem]);
      setQTitle('');
      setQTime('');
      setQDuration('');
      setQExactReminder('');
      setQMessage('');
      setPageError(null);
      setNotice('Task added to ' + selectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '.');
      refreshOverview();
    } catch (error) { setPageError('Could not add task: ' + errorMessage(error)); }
    finally { writeLock.current = false; setBusy(false); }
  };

  const updateItems = async (ids: string[], values: Partial<CalendarItem>): Promise<boolean> => {
    if (!ids.length || writeLock.current || !dayReady) return false;
    writeLock.current = true;
    setBusy(true);
    try {
      const { data, error } = await supabase.from('calendar_items').update(values).in('id', ids).select('id');
      if (error) throw new Error(error.message);
      if (data?.length !== ids.length) {
        const updatedIds = new Set((data ?? []).map((row: {id:string}) => row.id));
        setItems((current) => current.map((item) => updatedIds.has(item.id) ? { ...item, ...values } : item).filter((item) => item.date === dateStr));
        setSelectedIds((current) => current.filter((id) => !updatedIds.has(id)));
        refreshOverview();
        throw new Error('Some tasks could not be updated. Saved changes are shown; the remaining tasks are still selected.');
      }
      setItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, ...values } : item).filter((item) => item.date === dateStr));
      setPageError(null);
      setNotice(values.date && values.date !== dateStr ? ids.length + ' task(s) moved to ' + values.date + '.' : 'Changes saved.');
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
      refreshOverview();
      return true;
    } catch (error) { setPageError('Could not save changes: ' + errorMessage(error)); return false; }
    finally { writeLock.current = false; setBusy(false); }
  };
  const toggleDone = (item: CalendarItem) => { void updateItems([item.id], { done: !item.done }); };
  const deleteItem = async () => {
    if (!deleteId || writeLock.current) return;
    writeLock.current = true;
    setBusy(true);
    try {
      const { data, error } = await supabase.from('calendar_items').delete().eq('id', deleteId).select('id').maybeSingle();
      if (error || !data) throw new Error(error?.message ?? 'Task not found or access denied.');
      setItems((current) => current.filter((item) => item.id !== deleteId));
      setSelectedIds((current) => current.filter((id) => id !== deleteId));
      setDeleteId(null);
      setPageError(null);
      setNotice('Task deleted.');
      refreshOverview();
    } catch (error) { setPageError('Could not delete task: ' + errorMessage(error)); }
    finally { writeLock.current = false; setBusy(false); }
  };

  const reorderItems = async (sourceId: string, targetId: string) => {
    setDragId(null);
    if (sourceId === targetId || writeLock.current) return;
    const reordered = reorderDayItems(items, sourceId, targetId);
    const updates = reordered.filter((item) => item.sort_order !== items.find((old) => old.id === item.id)?.sort_order);
    if (!updates.length) return;
    writeLock.current = true;
    setBusy(true);
    try {
      // ponytail: individual row writes; use a database RPC if atomic ordering becomes necessary.
      const results = await Promise.allSettled(updates.map((item) => supabase.from('calendar_items').update({ sort_order: item.sort_order }).eq('id', item.id).select('id').maybeSingle()));
      if (results.some((result) => result.status === 'rejected' || result.value.error || !result.value.data)) {
        const saved = await supabase.from('calendar_items').select('*').eq('date', dateStr).order('sort_order');
        if (saved.error) setDayReady(false);
        else setItems((saved.data ?? []) as CalendarItem[]);
        throw new Error('Not every task could be reordered. The saved order has been reloaded.');
      }
      setItems(reordered);
      setPageError(null);
      setNotice('Task order saved.');
    } catch (error) { setPageError('Could not reorder: ' + errorMessage(error)); }
    finally { writeLock.current = false; setBusy(false); }
  };

  const saveNotes = async () => {
    if (!dayReady || notesSaving || !notesDirty) return;
    const sequence = dayLoadSequence.current;
    const values = { date: dateStr, raw_notes: rawNotes, ai_summary: summary };
    setNotesSaving(true);
    setNotesStatus('Saving…');
    try {
      const { data, error } = await supabase.from('daily_entries').upsert(values, { onConflict: 'date' }).select().single();
      if (error || !data) throw new Error(error?.message ?? 'No daily notes were returned.');
      if (sequence === dayLoadSequence.current) {
        setEntry(data as DailyEntry);
        setNotesStatus('Saved');
        setPageError(null);
      }
    } catch (error) {
      setNotesStatus('Save failed — your draft is still here.');
      setPageError('Could not save daily notes: ' + errorMessage(error));
    } finally { setNotesSaving(false); }
  };

  const manualItems = useMemo(() => [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at.localeCompare(b.created_at)), [items]);
  const visibleItems = useMemo(() => {
    const result = filterDayItems(manualItems, search, fType, fStatus, fPriority);
    if (sort === 'time') result.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
    if (sort === 'priority') result.sort((a, b) => PRIORITIES.findIndex((priority) => priority.value === b.priority) - PRIORITIES.findIndex((priority) => priority.value === a.priority));
    return result;
  }, [manualItems, search, fType, fStatus, fPriority, sort]);
  const pending = visibleItems.filter((item) => !item.done);
  const completed = visibleItems.filter((item) => item.done);
  const selectableItems = visibleItems.filter((item) => !item.done || showCompleted || fStatus === 'completed');
  const scheduled = pending.filter((item) => item.time).sort((a, b) => a.time!.localeCompare(b.time!));
  const flexible = pending.filter((item) => !item.time);
  const pendingItems = manualItems.filter((item) => !item.done);
  const upcoming = pendingItems.filter((item) => item.time && new Date(dateStr + 'T' + item.time).getTime() >= now.getTime()).sort((a, b) => a.time!.localeCompare(b.time!))[0];
  const focusItem = pendingItems.find((item) => item.id === focusId) ?? upcoming ?? [...pendingItems].sort((a, b) => PRIORITIES.findIndex((priority) => priority.value === b.priority) - PRIORITIES.findIndex((priority) => priority.value === a.priority))[0];
  const doneCount = items.filter((item) => item.done).length;
  const completion = items.length ? Math.round(doneCount / items.length * 100) : 0;
  const plannedMinutes = items.reduce((total, item) => total + (item.duration_min ?? 0), 0);
  const remainingMinutes = pendingItems.reduce((total, item) => total + (item.duration_min ?? 0), 0);
  const missed = pendingItems.filter((item) => item.time && new Date(dateStr + 'T' + item.time).getTime() < now.getTime());
  const filtersActive = !!search.trim() || fType !== 'all' || fStatus !== 'all' || fPriority !== 'all';
  const canReorder = sort === 'manual' && !filtersActive && !selecting;
  const selectItem = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]);
  const clearFilters = () => { setSearch(''); setFType('all'); setFStatus('all'); setFPriority('all'); };
  const calendarDays = useMemo(() => {
    const days: (Date | null)[] = Array.from({ length: new Date(viewYear, viewMonth, 1).getDay() }, () => null);
    for (let day = 1; day <= new Date(viewYear, viewMonth + 1, 0).getDate(); day++) days.push(new Date(viewYear, viewMonth, day));
    return days;
  }, [viewMonth, viewYear]);

  const renderTask = (item: CalendarItem, reorder = false) => {
    const siblingItems = manualItems.filter((sibling) => sibling.done === item.done);
    const index = siblingItems.findIndex((sibling) => sibling.id === item.id);
    return <ItemRow key={item.id} item={item} onToggle={toggleDone} onEdit={setEditing} onDelete={(task) => setDeleteId(task.id)} hour12={hour12} busy={busy}
      selecting={selecting} selected={selectedIds.includes(item.id)} onSelect={selectItem}
      draggable={reorder && canReorder} isDragging={dragId === item.id}
      onDragStart={() => setDragId(item.id)} onDragEnd={() => setDragId(null)}
      onDragOver={(event) => { if (dragId) event.preventDefault(); }}
      onDrop={() => { if (dragId && canReorder) void reorderItems(dragId, item.id); }}
      onUp={reorder && canReorder ? () => { if (siblingItems[index - 1]) void reorderItems(item.id, siblingItems[index - 1].id); } : undefined}
      onDown={reorder && canReorder ? () => { if (siblingItems[index + 1]) void reorderItems(item.id, siblingItems[index + 1].id); } : undefined}
      canUp={index > 0} canDown={index < siblingItems.length - 1} />;
  };

  const emptyState = <div className="planner-empty-state" role="status">
    <ListTodo size={30} aria-hidden="true" />
    <h2>{loading ? 'Getting your day ready…' : !dayReady ? 'Your day is unavailable' : filtersActive ? 'No tasks match these filters' : 'Start with one small thing'}</h2>
    <p>{loading ? 'Loading your saved plan.' : !dayReady ? 'Retry loading your saved tasks before adding to this day.' : filtersActive ? 'Clear the filters to see the rest of your day.' : 'Capture a task, give it a time if you need one, and make it yours.'}</p>
    {dayReady && <button className="planner-secondary-button" onClick={filtersActive ? clearFilters : captureTask}>{filtersActive ? 'Clear filters' : 'Add your first task'}</button>}
  </div>;

  return (
    <PageContainer className="day-planner">
      <header className="planner-hero">
        <div>
          <p className="planner-eyebrow"><CalendarHeart size={15} /> Day Organizer <span> / </span> Make space for your day</p>
          <h1>{dateStr === today ? 'My day' : selectedDate.toLocaleDateString(undefined, { weekday: 'long' })}<span>{selectedDate.toLocaleDateString(undefined, { weekday: dateStr === today ? 'long' : undefined, month: 'long', day: 'numeric', year: 'numeric' })}</span></h1>
          <p className="planner-hero-description">{items.length && doneCount === items.length ? 'Everything checked off. Enjoy a little breathing room.' : 'A little structure. A little breathing room. One thing at a time.'}</p>
        </div>
        <div className="planner-hero-actions">
          <button className="planner-secondary-button" disabled={busy || notesSaving} onClick={() => selectDay(new Date())}><CalendarHeart size={16} /> Today</button>
          <button className="planner-primary-button" onClick={captureTask}><Zap size={16} /> Add task <kbd>N</kbd></button>
        </div>
      </header>

      <section className="planner-day-overview" aria-label="Day progress">
        <div className="planner-overview-stat"><span className="planner-overview-icon"><ListTodo size={18} /></span><div><strong>{loading ? '—' : pendingItems.length}</strong><span>tasks remaining</span></div></div>
        <div className="planner-overview-stat"><span className="planner-overview-icon complete"><CheckCheck size={18} /></span><div><strong>{loading ? '—' : doneCount}</strong><span>completed</span></div></div>
        <div className="planner-overview-stat"><span className="planner-overview-icon"><Clock3 size={18} /></span><div><strong>{loading ? '—' : formatDuration(remainingMinutes * 60)}</strong><span>remaining estimate</span></div></div>
        <div className="planner-overview-progress"><div><span>Daily progress</span><strong>{completion}%</strong></div><div className="planner-progress-track" role="progressbar" aria-label="Completed tasks" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}><div style={{ width: completion + '%' }} /></div><span>{doneCount} of {items.length} tasks · {formatDuration(plannedMinutes * 60)} planned</span></div>
      </section>
      {pageError && <div role="alert" className="planner-error"><span>{pageError}</span>{!dayReady && <button onClick={() => void loadData()} disabled={loading}>Retry loading</button>}<button aria-label="Dismiss error" onClick={() => setPageError(null)}>Dismiss</button></div>}
      <p className="planner-live-status" role="status" aria-live="polite">{busy ? 'Saving your changes…' : notice}</p>

      <nav className="planner-date-navigation" aria-label="Choose planner date">
        <div className="planner-date-controls"><button className="planner-icon-button" aria-label={view === 'week' ? 'Previous week' : 'Previous day'} disabled={busy || notesSaving} onClick={() => moveDay(-1)}><ChevronLeft size={18} /></button><span className="planner-date-label">{selectedDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span><button className="planner-icon-button" aria-label={view === 'week' ? 'Next week' : 'Next day'} disabled={busy || notesSaving} onClick={() => moveDay(1)}><ChevronRight size={18} /></button></div>
        <div className="planner-date-jump"><span>{timeZone}</span><select aria-label="Time display format" value={hour12 ? '12' : '24'} onChange={(event) => { const value = event.target.value === '12'; setHour12(value); try { localStorage.setItem('hephastos_day_hour12', String(value)); } catch { /* Display still works without storage. */ } }}><option value="12">12-hour</option><option value="24">24-hour</option></select><input aria-label="Jump to date" type="date" value={dateStr} disabled={busy || notesSaving} onChange={(event) => { if (event.target.value) selectDay(parseDateString(event.target.value)); }} /></div>
      </nav>
      <nav className="planner-week-strip" aria-label="Choose a day this week">
        {weekDays.map((day) => {
          const date = toDateString(day);
          const dayTasks = date === dateStr ? items : weekItems.filter((item) => item.date === date);
          const pendingCount = dayTasks.filter((item) => !item.done).length;
          return <button key={date} disabled={busy || notesSaving} aria-label={day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + (weekLoading ? '' : ', ' + pendingCount + ' tasks remaining')} aria-pressed={date === dateStr} aria-current={date === today ? 'date' : undefined} onClick={() => selectDay(day)} className={date === dateStr ? 'is-selected' : ''}><span>{day.toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>{day.getDate()}</strong><small>{weekError && date !== dateStr ? 'Unavailable' : weekLoading ? '…' : pendingCount ? pendingCount + ' to do' : dayTasks.length ? 'All done' : 'Open day'}</small></button>;
        })}
      </nav>

      <div className="planner-workspace">
        <section className="planner-agenda" aria-label="Daily agenda">
          <section className="planner-capture" aria-label="Add a task">
            <form onSubmit={(event) => { event.preventDefault(); void addItem(); }}>
              <div className="planner-capture-main"><Zap size={19} aria-hidden="true" /><input ref={qTitleRef} aria-label="New task title" value={qTitle} onChange={(event) => setQTitle(event.target.value)} disabled={busy} placeholder="What would you like to get done?" required maxLength={500} /><button className="planner-primary-button" type="submit" disabled={busy || !dayReady || !qTitle.trim()}>Add task</button></div>
              <details className="planner-capture-details"><summary>Schedule & task details <span>Optional</span></summary>
                <div className="planner-capture-fields">
                  <HudSelect label="Category" value={qType} onChange={(event) => setQType(event.target.value)}>{ITEM_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</HudSelect>
                  <HudInput label="Start time" type="time" step={60} value={qTime} onChange={(event) => setQTime(event.target.value)} />
                  <HudInput label="Duration (minutes)" type="number" min={0} step={1} value={qDuration} onChange={(event) => setQDuration(event.target.value)} placeholder="e.g. 30" />
                  <HudSelect label="Priority" value={qPriority} onChange={(event) => setQPriority(event.target.value)}>{PRIORITIES.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}</HudSelect>
                  <HudInput label="Alert minutes before" type="number" min={0} step={1} disabled={!!qExactReminder} value={qReminder} onChange={(event) => setQReminder(event.target.value)} />
                  <HudInput label="Exact reminder time" type="time" step={60} value={qExactReminder} onChange={(event) => setQExactReminder(event.target.value)} />
                  <HudInput label="Custom notification text" value={qMessage} onChange={(event) => setQMessage(event.target.value)} placeholder="Your title is used by default" />
                </div>
                <p>Times use {timeZone}. Leave start time blank for a flexible task. An exact reminder replaces the minutes-before alert; the start-time alert still applies.</p>
              </details>
            </form>
          </section>

          <div className="planner-view-switcher" role="group" aria-label="Planner view">{TABS.map((tab, index) => <button key={tab.id} aria-pressed={view === tab.id} onClick={() => setView(tab.id)} className={view === tab.id ? 'is-active' : ''}><tab.icon size={17} />{tab.label}<kbd>{index + 1}</kbd></button>)}</div>
          {(view === 'list' || view === 'timeline') && <>
            <div className="planner-agenda-heading"><div><h2>{view === 'list' ? 'Your tasks' : 'Your schedule'}</h2><p>{view === 'list' ? 'A clear list for the day ahead.' : 'Time set aside for what matters, down to the minute.'}</p></div><button className="planner-text-button" disabled={!dayReady || busy} onClick={() => { setSelecting(!selecting); setSelectedIds([]); }}>{selecting ? 'Cancel selection' : 'Select tasks'}</button></div>
            <div className="planner-filters">
              <label className="planner-filter-search"><Search size={16} aria-hidden="true" /><input ref={searchRef} aria-label="Search tasks by title or notes" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this day…" /><kbd>/</kbd></label>
              <select aria-label="Filter by task status" value={fStatus} onChange={(event) => setFStatus(event.target.value)}><option value="all">All tasks</option><option value="pending">To do</option><option value="scheduled">Scheduled</option><option value="flexible">Flexible</option><option value="completed">Completed</option></select>
              <select aria-label="Filter by category" value={fType} onChange={(event) => setFType(event.target.value)}><option value="all">All categories</option>{ITEM_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
              <select aria-label="Filter by priority" value={fPriority} onChange={(event) => setFPriority(event.target.value)}><option value="all">All priorities</option>{PRIORITIES.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}</select>
              {view === 'list' && <select aria-label="Sort tasks" value={sort} onChange={(event) => setSort(event.target.value)}><option value="manual">My order</option><option value="time">By start time</option><option value="priority">By priority</option></select>}
              {filtersActive && <button className="planner-text-button" onClick={clearFilters}>Clear filters</button>}
            </div>
            {selecting && <div className="planner-selection-bar"><label><input type="checkbox" disabled={busy || !selectableItems.length} checked={selectableItems.length > 0 && selectableItems.every((item) => selectedIds.includes(item.id))} onChange={(event) => setSelectedIds(event.target.checked ? selectableItems.map((item) => item.id) : [])} />Select visible · {selectedIds.length} selected</label><button disabled={busy || !selectedIds.length} onClick={() => void updateItems(selectedIds, { done: true })}><CheckCheck size={15} /> Complete</button><button disabled={busy || !selectedIds.length} onClick={() => void updateItems(selectedIds, { done: false })}>Reopen</button><select aria-label="Change selected task priority" value="" disabled={busy || !selectedIds.length} onChange={event => { if (['low','medium','high','critical'].includes(event.target.value)) void updateItems(selectedIds, { priority: event.target.value }); }}><option value="">Set priority…</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select><label className="planner-move-date">Move to<input type="date" aria-label="Move selected tasks to date" value={moveDate} onChange={(event) => setMoveDate(event.target.value)} /></label><button disabled={busy || !selectedIds.length || !moveDate || moveDate === dateStr} onClick={() => void updateItems(selectedIds, { date: moveDate })}>Move tasks</button></div>}
            {(!visibleItems.length || !dayReady) ? emptyState : <>
              {view === 'list' && pending.length > 0 && <section className="planner-task-section"><div className="planner-section-heading"><h3>To do <span>{pending.length}</span></h3><span>{canReorder ? 'Drag to reorder · actions for keyboard moves' : filtersActive ? 'Filtered tasks' : 'Your daily plan'}</span></div>{pending.map((item) => renderTask(item, true))}</section>}
              {view === 'timeline' && <div className="planner-schedule">
                {(scheduleReview.pairs.length > 0 || scheduleReview.unknown.length > 0 || scheduleReview.partial) && <section className="planner-schedule-review" aria-label="Schedule conflict review"><header><AlertTriangle size={18} /><div><h3>Review your time blocks</h3><p>Checks use unfinished scheduled tasks loaded for {dateStr}. Tasks on other dates are outside this review.</p></div></header>{scheduleReview.pairs.slice(0,10).map((pair,i) => <div key={i}><span><strong>{pair.first.title}</strong> overlaps <strong>{pair.second.title}</strong></span><button disabled={busy} onClick={() => setEditing(pair.second)}>Reschedule</button></div>)}{scheduleReview.pairs.length > 10 && <p>{scheduleReview.pairs.length - 10} additional overlapping pairs detected.</p>}{scheduleReview.unknown.length > 0 && <div><span>{scheduleReview.unknown.length} scheduled task(s) need a valid start time and duration before overlap can be checked.</span><button disabled={busy} onClick={() => setEditing(scheduleReview.unknown[0])}>Add time details</button></div>}{scheduleReview.partial && <p role="status">Review is bounded at 300 time blocks and 50 conflicting pairs. Additional conflicts may exist.</p>}</section>}
                {scheduled.length > 0 && <section><div className="planner-section-heading"><h3>Scheduled <span>{scheduled.length}</span></h3><span>{timeZone}</span></div>{scheduled.map((item) => {
                  const start = new Date(dateStr + 'T' + item.time);
                  const end = new Date(start.getTime() + (item.duration_min ?? 0) * 60_000);
                  const isCurrent = dateStr === today && start <= now && end > now;
                  return <div key={item.id} className={'planner-schedule-block ' + (isCurrent ? 'is-current' : '')}><div className="planner-schedule-time"><strong>{formatPlannerTime(item.time!, hour12)}</strong>{item.duration_min > 0 && <span>{formatPlannerTime(String(end.getHours()).padStart(2, '0') + ':' + String(end.getMinutes()).padStart(2, '0'), hour12)}{toDateString(end) !== dateStr ? ' +1 day' : ''}</span>}{isCurrent && <small>Now</small>}</div><div>{renderTask(item)}</div></div>;
                })}</section>}
                {flexible.length > 0 && <section className="planner-flexible-section"><div className="planner-section-heading"><h3>Flexible <span>{flexible.length}</span></h3><span>No time set</span></div>{flexible.map((item) => renderTask(item))}</section>}
              </div>}
              {completed.length > 0 && <section className="planner-completed-section"><button className="planner-completed-toggle" aria-expanded={showCompleted || fStatus === 'completed'} onClick={() => { if (fStatus === 'completed') setFStatus('all'); setShowCompleted(!showCompleted); }}><CheckCheck size={17} />Completed <span>{completed.length}</span><ChevronRight size={16} className={showCompleted || fStatus === 'completed' ? 'is-open' : ''} /></button>{(showCompleted || fStatus === 'completed') && completed.map((item) => renderTask(item))}</section>}
              {!pending.length && fStatus !== 'completed' && <div className="planner-all-done"><CheckCheck size={24} /><h3>{filtersActive ? 'These tasks are all checked off' : 'You’re all done for the day'}</h3><p>{filtersActive ? 'Clear your filters to see the rest of your plan.' : 'Your completed tasks are saved below. Take a moment to enjoy it.'}</p></div>}
            </>}
          </>}

          {view === 'week' && <section className="planner-week-view"><div className="planner-agenda-heading"><div><h2>Your week</h2><p>{weekDays[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {weekDays[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · choose a day to plan it</p></div></div>{weekLoading ? <p role="status" className="planner-muted">Loading your week…</p> : weekError ? <p role="status" className="planner-muted">Your week could not be loaded. Use Retry overview to try again.</p> : <div className="planner-week-grid">{weekDays.map((day) => {
            const date = toDateString(day);
            const dayItems = (date === dateStr ? items : weekItems.filter((item) => item.date === date)).slice().sort((a, b) => Number(a.done) - Number(b.done) || (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
            const completedCount = dayItems.filter((item) => item.done).length;
            return <button key={date} disabled={busy || notesSaving} onClick={() => { selectDay(day); setView('list'); }} className={date === dateStr ? 'is-selected' : ''} aria-label={'Plan ' + day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}><div className="planner-week-card-heading"><span>{day.toLocaleDateString(undefined, { weekday: 'long' })}{date === today && <small>Today</small>}</span><strong>{day.getDate()}</strong></div><p>{dayItems.length ? completedCount + '/' + dayItems.length + ' completed · ' + formatDuration(dayItems.reduce((total, item) => total + (item.duration_min ?? 0) * 60, 0)) : 'Room for something good'}</p><div className="planner-week-card-tasks">{dayItems.slice(0, 4).map((item) => <div key={item.id} className={item.done ? 'is-complete' : ''}><span className="planner-week-task-dot" style={{ background: TYPE_COLORS[item.type] }} /><span>{item.title}</span>{item.time && <small>{formatPlannerTime(item.time, hour12)}</small>}</div>)}{dayItems.length > 4 && <small>+{dayItems.length - 4} more tasks</small>}</div><span className="planner-week-card-footer">Open day <ChevronRight size={14} /></span></button>;
          })}</div>}</section>}

          {view === 'notes' && <section className="planner-notes"><div className="planner-agenda-heading"><div><h2>Notes & reflection</h2><p>A place for thoughts that don’t need a checkbox.</p></div><button className="planner-primary-button" disabled={!dayReady || notesSaving || !notesDirty} onClick={() => void saveNotes()}>{notesSaving ? 'Saving…' : 'Save notes'}</button></div>{dayReady ? <><div className="planner-note-card"><MarkdownEditor label="Daily notes · markdown supported" value={rawNotes} onChange={setRawNotes} onSave={() => {}} rows={12} /><p className="planner-note-hint">Use Save notes to keep your writing and reflection together.</p></div><div className="planner-note-card"><HudTextarea label="End-of-day reflection" rows={5} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What went well? What would make tomorrow a little better?" /></div><p role="status" className="planner-notes-status">{notesSaving ? 'Saving…' : notesDirty ? notesStatus.startsWith('Save failed') ? notesStatus : 'Unsaved changes' : notesStatus || 'All changes saved'}</p></> : emptyState}</section>}
        </section>

        <aside className="planner-sidebar" aria-label="Day tools and calendar">
          <section className="planner-next-card"><p className="planner-card-eyebrow"><span className="planner-focus-dot" aria-hidden="true" />{focusId && focusItem?.id === focusId ? 'Your focus' : 'Up next'}</p>{focusItem ? <><button className="planner-next-title" onClick={() => setEditing(focusItem)}>{focusItem.title}</button><p>{focusItem.time ? formatPlannerTime(focusItem.time, hour12) : 'Whenever you’re ready'}{focusItem.duration_min > 0 ? ' · ' + focusItem.duration_min + ' min' : ''}</p><div><button className="planner-text-button" disabled={busy} onClick={() => toggleDone(focusItem)}><Check size={15} />Mark complete</button><button className="planner-text-button" onClick={() => { setFocusId(focusItem.id); document.getElementById('planner-focus')?.scrollIntoView({ block: 'center', behavior: 'auto' }); }}>Focus here</button></div></> : <><h2>{loading ? 'Your plan is loading' : !dayReady ? 'Try loading your day again' : items.length ? 'All checked off' : 'Choose your first task'}</h2><p>{dayReady ? 'A little room to plan, focus, or rest.' : 'Your saved tasks will appear when this day is available.'}</p></>}</section>
          <div id="planner-focus" className="planner-focus-card"><label className="planner-focus-choice">Focus task<select value={focusItem?.id ?? ''} disabled={!pendingItems.length} onChange={(event) => setFocusId(event.target.value)}>{!pendingItems.length && <option value="">No pending tasks</option>}{pendingItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><FocusTimer /></div>
          <details className="planner-calendar" open><summary>Your calendar <CalendarHeart size={16} /></summary><div className="planner-calendar-body"><div className="planner-calendar-month"><button className="planner-icon-button" aria-label="Previous month" onClick={() => { const day = new Date(viewYear, viewMonth - 1, 1); setViewMonth(day.getMonth()); setViewYear(day.getFullYear()); }}><ChevronLeft size={16} /></button><span>{monthNames[viewMonth]} {viewYear}</span><button className="planner-icon-button" aria-label="Next month" onClick={() => { const day = new Date(viewYear, viewMonth + 1, 1); setViewMonth(day.getMonth()); setViewYear(day.getFullYear()); }}><ChevronRight size={16} /></button></div><div className="planner-calendar-grid">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <span key={day}>{day}</span>)}{calendarDays.map((day, index) => {
            if (!day) return <span key={'blank-' + index} />;
            const date = toDateString(day);
            const stats = date === dateStr ? { total: items.length, done: doneCount } : monthStats[date];
            return <button key={date} disabled={busy || notesSaving} aria-label={day.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) + (stats?.total ? ', ' + stats.total + ' tasks' : '')} aria-pressed={date === dateStr} aria-current={date === today ? 'date' : undefined} className={date === dateStr ? 'is-selected' : ''} onClick={() => selectDay(day)}>{day.getDate()}{!!stats?.total && <span className={'planner-calendar-dot ' + (stats.done === stats.total ? 'is-complete' : '')} />}</button>;
          })}</div></div></details>
          {missed.length > 0 && dayReady && <section className="planner-attention"><Clock3 size={16} /><div><strong>{missed.length} start time{missed.length === 1 ? '' : 's'} passed</strong><p>Plans change. Open task details to choose a new time or move to another day.</p><button className="planner-text-button" onClick={() => { setView('timeline'); setFStatus('scheduled'); setSearch(''); setFType('all'); setFPriority('all'); }}>Review schedule</button></div></section>}
          {overviewError && <div role="alert" className="planner-overview-error">{overviewError}<button className="planner-text-button" onClick={() => { setWeekError(null); setMonthError(null); refreshOverview(); }}>Retry overview</button></div>}
          <p className="planner-shortcuts"><kbd>N</kbd> New task <span>·</span> <kbd>/</kbd> Search<br /><kbd>1–4</kbd> Switch views</p>
        </aside>
      </div>

      <ConfirmDialog open={!!deleteId} onClose={() => { if (!busy) setDeleteId(null); }} onConfirm={deleteItem} title="Delete task" message={<>Delete <strong>{items.find((item) => item.id === deleteId)?.title ?? 'this task'}</strong>? This removes its schedule, notes, and reminders.</>} confirmLabel="Delete task" />
      <ItemEditModal item={editing} onClose={() => { if (!busy) setEditing(null); }} onSave={(values) => editing ? updateItems([editing.id], values) : Promise.resolve(false)} />
    </PageContainer>
  );
}
