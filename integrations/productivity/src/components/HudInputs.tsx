import { type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from 'react';

interface HudInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function HudInput({ label, className = '', ...props }: HudInputProps) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block font-display text-xs uppercase tracking-wider text-text-muted">
          {label}
        </span>
      )}
      <input className={`hud-input clip-corner-small w-full px-3 py-2 text-sm ${className}`} {...props} />
    </label>
  );
}

interface HudTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function HudTextarea({ label, className = '', ...props }: HudTextareaProps) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block font-display text-xs uppercase tracking-wider text-text-muted">
          {label}
        </span>
      )}
      <textarea className={`hud-input clip-corner-small w-full px-3 py-2 text-sm resize-y ${className}`} {...props} />
    </label>
  );
}

interface HudSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  children: ReactNode;
}

export function HudSelect({ label, className = '', children, ...props }: HudSelectProps) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block font-display text-xs uppercase tracking-wider text-text-muted">
          {label}
        </span>
      )}
      <select className={`hud-input clip-corner-small w-full px-3 py-2 text-sm cursor-pointer ${className}`} {...props}>
        {children}
      </select>
    </label>
  );
}
