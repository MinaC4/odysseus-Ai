import { useState } from 'react';
import { Eye, Edit3 } from 'lucide-react';
import { renderMarkdown } from '@/lib/markdown';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: (value: string) => void;
  label?: string;
  rows?: number;
  large?: boolean;
}

export function MarkdownEditor({ value, onChange, onSave, label, rows = 14, large = false }: MarkdownEditorProps) {
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('edit');

  return (
    <div>
      {label && (
        <div className="mb-2 flex items-center justify-between">
          <span className="font-display text-xs uppercase tracking-wider text-text-muted">
            {label}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setMode('edit')}
              className={`px-2 py-1 text-xs font-display uppercase tracking-wider transition-colors ${
                mode === 'edit' ? 'text-accent-cyan' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Edit3 size={12} className="inline mr-1" />Edit
            </button>
            <button
              onClick={() => setMode('split')}
              className={`px-2 py-1 text-xs font-display uppercase tracking-wider transition-colors ${
                mode === 'split' ? 'text-accent-cyan' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Split
            </button>
            <button
              onClick={() => setMode('preview')}
              className={`px-2 py-1 text-xs font-display uppercase tracking-wider transition-colors ${
                mode === 'preview' ? 'text-accent-cyan' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Eye size={12} className="inline mr-1" />Preview
            </button>
          </div>
        </div>
      )}
      <div className={`flex gap-3 ${mode === 'split' ? 'flex-row' : 'flex-col'}`}>
        {(mode === 'edit' || mode === 'split') && (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => onSave(value)}
            rows={rows}
            className={`hud-input clip-corner-small flex-1 resize-y font-mono ${
              large ? 'px-4 py-3 text-base leading-relaxed' : 'px-3 py-2 text-sm'
            }`}
            placeholder="Write markdown here..."
          />
        )}
        {(mode === 'preview' || mode === 'split') && (
          <div
            className={`markdown-body hud-panel-alt clip-corner-small flex-1 overflow-y-auto ${
              large ? 'px-4 py-3 text-base leading-relaxed' : 'px-3 py-2 text-sm'
            }`}
            style={{ minHeight: `${rows * 1.5}rem`, maxHeight: `${rows * 1.5}rem` }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
          />
        )}
      </div>
    </div>
  );
}
