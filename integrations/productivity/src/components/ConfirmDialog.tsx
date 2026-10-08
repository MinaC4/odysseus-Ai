import { type ReactNode, useEffect, useState } from 'react';
import { HudButton } from './HudButton';
import { HudModal } from './HudModal';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}: ConfirmDialogProps) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) setConfirming(false);
  }, [open]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <HudModal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="text-sm text-text-primary leading-relaxed">{message}</div>
        <div className="flex justify-end gap-3 pt-2">
          <HudButton variant="ghost" onClick={onClose} disabled={confirming}>
            {cancelLabel}
          </HudButton>
          <HudButton variant="danger" onClick={handleConfirm} disabled={confirming}>
            {confirmLabel}
          </HudButton>
        </div>
      </div>
    </HudModal>
  );
}
