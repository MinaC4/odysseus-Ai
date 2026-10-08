import type { CSSProperties } from 'react';

interface RadioBarProps {
  segments?: number;
  /** progress 0..1 */
  value: number;
  color: string;
  height?: number;
  label?: string;
}

/** Thin radio-signal style progress bar (v5 skin). */
export function RadioBar({ segments = 10, value, color, height = 6, label }: RadioBarProps) {
  const on = Math.max(0, Math.min(segments, Math.round(value * segments)));
  return (
    <div className="flex w-full items-center gap-2">
      <div className="radio-bar" style={{ height, color }}>
        {Array.from({ length: segments }).map((_, i) => (
          <span key={i} className={`rb ${i < on ? 'on' : ''}`} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      {label && <span className="shrink-0 font-mono text-[10px] text-text-muted">{label}</span>}
    </div>
  );
}
