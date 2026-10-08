import { type ReactNode } from 'react';
import { HudPanel } from '@/components/HudPanel';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-5 sm:mb-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-5 border-b border-border-line pb-4">
      <div className="min-w-0">
        <h1 className="font-display text-xl sm:text-2xl font-semibold tracking-wide text-text-primary break-words">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 text-sm leading-relaxed text-text-muted break-words">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

interface PageContainerProps {
  children: ReactNode;
  className?: string;
}

export function PageContainer({ children, className = '' }: PageContainerProps) {
  return (
    <div className={`min-h-full p-3 sm:p-4 md:p-6 overflow-x-hidden ${className}`}>
      {children}
    </div>
  );
}

export function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <HudPanel className="flex flex-col items-center justify-center py-16" cornerBrackets>
      <Icon size={40} className="mb-3 text-text-muted opacity-50" />
      <p role="status" className="px-4 text-center text-sm leading-relaxed text-text-muted">{message}</p>
    </HudPanel>
  );
}

export function LoadingState({ message = 'LOADING…' }: { message?: string }) {
  return <HudPanel className="flex items-center justify-center gap-3 py-14" cornerBrackets><span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-cyan/30 border-t-accent-cyan" aria-hidden="true" /><span role="status" className="text-sm text-text-muted">{message}</span></HudPanel>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <HudPanel className="flex flex-wrap items-center gap-3 border-alert-red/50 px-5 py-8" cornerBrackets><span role="alert" className="text-sm leading-relaxed text-alert-red">{message}</span>{onRetry && <button type="button" onClick={onRetry} className="rounded border border-alert-red/50 px-4 py-2 text-sm text-alert-red hover:bg-alert-red/10">Retry</button>}</HudPanel>;
}

export function PermissionState({ message = 'YOU DO NOT HAVE permission TO VIEW THIS RESOURCE' }: { message?: string }) {
  return <HudPanel className="px-5 py-10 text-center" cornerBrackets><p className="font-display text-xs uppercase tracking-wider text-warn-amber">{message}</p></HudPanel>;
}

export function DisconnectedState({ message = 'PROVIDER DISCONNECTED — RETRY WHEN AVAILABLE' }: { message?: string }) {
  return <HudPanel className="px-5 py-8 text-center" cornerBrackets><p className="font-display text-xs uppercase tracking-wider text-text-muted">{message}</p></HudPanel>;
}
