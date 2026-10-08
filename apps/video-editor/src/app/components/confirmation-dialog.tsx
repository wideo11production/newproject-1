'use client';

import { X, AlertTriangle } from 'lucide-react';

export interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  if (!open) return null;

  const variantStyles = {
    danger: {
      icon: 'text-rose-400',
      confirm: 'text-rose-400 hover:text-rose-300',
      border: 'border-rose-500/30',
      bg: 'bg-rose-950/20',
    },
    warning: {
      icon: 'text-amber-400',
      confirm: 'text-amber-400 hover:text-amber-300',
      border: 'border-amber-500/30',
      bg: 'bg-amber-950/20',
    },
    info: {
      icon: 'text-sky-400',
      confirm: 'text-sky-400 hover:text-sky-300',
      border: 'border-sky-500/30',
      bg: 'bg-sky-950/20',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface/70 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="flex max-w-sm flex-col overflow-hidden rounded-md-edge-strong bg-surface-raised shadow-2xl">
        <header className="flex items-center justify-between-edge px-4 py-2.5">
          <h2 id="confirmation-dialog-title" className="text-[10px] font-medium text-fg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close dialog"
            className="rounded p-1 text-fg-muted hover:bg-surface-overlay hover:text-fg"
          >
            <X className="h-2 w-2" />
          </button>
        </header>

        <div className="space-y-3 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className={`mt-0.5 h-2.5 w-2.5 shrink-0 ${styles.icon}`}
              aria-hidden="true"
            />
            <p className="text-[8px] text-fg-secondary">{message}</p>
          </div>

          <div className={`rounded border ${styles.border} ${styles.bg} p-3`}></div>
        </div>

        <footer className="flex items-center justify-end gap-2 px-4 py-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[8px] text-fg-muted hover:text-fg transition-colors duration-150"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-[8px] font-medium transition-colors duration-150 ${styles.confirm}`}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}