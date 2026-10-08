import { type ReactNode } from 'react';

interface HudPanelProps {
  children: ReactNode;
  className?: string;
  cornerBrackets?: boolean;
  scanLines?: boolean;
  alt?: boolean;
  onClick?: () => void;
}

export function HudPanel({
  children,
  className = '',
  cornerBrackets = false,
  scanLines = false,
  alt = false,
  onClick,
}: HudPanelProps) {
  const classes = [
    alt ? 'hud-panel-alt' : 'hud-panel',
    'clip-corner-both',
    cornerBrackets ? 'corner-brackets' : '',
    scanLines ? 'scan-lines' : '',
    onClick ? 'cursor-pointer' : '',
    className,
  ].join(' ');

  return (
    <div className={classes} onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick();
        }
      } : undefined}>
      {children}
    </div>
  );
}
