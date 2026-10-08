import { type ButtonHTMLAttributes, type ReactNode } from 'react';

interface HudButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export function HudButton({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: HudButtonProps) {
  const base = 'hud-btn clip-corner-small font-display font-medium uppercase tracking-wide transition-all';
  const sizes = {
    sm: 'text-xs px-3 py-1.5',
    md: 'text-sm px-4 py-2',
    lg: 'text-base px-6 py-3',
  };
  const variants = {
    primary: '',
    danger: 'hud-btn-danger',
    ghost: 'border-text-muted text-text-muted hover:border-accent-cyan hover:text-accent-cyan hover:bg-transparent',
  };

  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
