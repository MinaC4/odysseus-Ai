import { type ReactNode, useEffect, useState, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { activeElement } from '@/lib/dom';
import { GripVertical, X } from 'lucide-react';

interface HudModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function HudModal({ open, onClose, title, children, className = '' }: HudModalProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = activeElement() instanceof HTMLElement ? activeElement() as HTMLElement : null;
    const focusable = () => [...(panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
    ) ?? [])].filter((element) => element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => {
      if (!panelRef.current?.contains(activeElement())) (focusable()[0] ?? panelRef.current)?.focus();
    });
    const handler = (e: KeyboardEvent) => {
      const dialogs = (panelRef.current?.getRootNode() as ParentNode | undefined)?.querySelectorAll('[role="dialog"][aria-modal="true"]') ?? [];
      if (dialogs.length && dialogs[dialogs.length - 1] !== panelRef.current) return;
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key !== 'Tab') return;
      const targets = focusable();
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first) { e.preventDefault(); panelRef.current?.focus(); return; }
      if (!panelRef.current?.contains(activeElement())) {
        e.preventDefault(); (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && activeElement() === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && activeElement() === last) {
        e.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handler, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  // reset position when opened — centered
  useEffect(() => {
    if (open) setPos({ x: 0, y: 0 });
  }, [open]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const nx = dragRef.current.initX + dx;
      const ny = dragRef.current.initY + dy;
      // wide drag — allow anywhere on page, keep at least 40px handle visible
      const el = panelRef.current;
      const w = el?.offsetWidth ?? 480;
      const h = el?.offsetHeight ?? 360;
      const maxX = window.innerWidth / 2 + w / 2 - 40;
      const maxY = window.innerHeight / 2 + h / 2 - 40;
      setPos({
        x: Math.max(-maxX, Math.min(maxX, nx)),
        y: Math.max(-maxY, Math.min(maxY, ny)),
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging]);

  if (!open) return null;

  const modal = (
    <div
      className="modal-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Dialog'}
        tabIndex={-1}
        className={`hud-panel clip-corner-both corner-brackets scan-lines max-h-[90vh] overflow-y-auto w-full max-w-lg ${className} ${dragging ? 'select-none' : 'glitch-in'}`}
        style={{
          transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
          top: '50%',
          left: '50%',
          position: 'fixed',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div
            className={`flex items-center justify-between border-b border-border-line px-5 py-3 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            onPointerDown={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest('button')) return;
              dragRef.current.startX = e.clientX;
              dragRef.current.startY = e.clientY;
              dragRef.current.initX = pos.x;
              dragRef.current.initY = pos.y;
              setDragging(true);
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              e.preventDefault();
            }}
            style={{ touchAction: 'none' }}
            title="Drag to move"
          >
            <div className="flex items-center gap-2">
              <GripVertical size={14} className="text-text-muted opacity-60" />
              <h2 id={titleId} className="font-display text-lg font-semibold tracking-wide text-accent-cyan uppercase">
                {title}
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label={`Close ${title || 'dialog'}`}
              className="text-text-muted hover:text-alert-red transition-colors"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );

  // Portal to body ensures modal is always viewport-centered and in front,
  // regardless of parent scroll position (fixes “need to scroll to see modal”).
  if (typeof document !== 'undefined') {
    const target = document.querySelector('#personal-workspace-host')?.shadowRoot?.querySelector('#workspace-portals');
    return createPortal(modal, target ?? document.body);
  }
  return modal;
}
