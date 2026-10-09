'use client';

// ============================================================================
// Confirmation Dialog Component
// ============================================================================
//
// Hinglish: Borderless destructive action alert. Zero wireframe lines,
// rounded-md geometry, bg-[#1a1a1a] Rich Charcoal backdrop with
// orange-red (#ff6500) accent buttons on hover/active states.
// 150ms CSS transitions for snappy interaction feedback.

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

  // Borderless color palette — no wireframe borders anywhere.
  // Accent color is always #ff6500 (orange-red) for action buttons.
  const variantStyles = {
    danger: {
      icon: 'text-[#ff6500]',
      confirm: 'bg-[#ff6500] text-white hover:bg-[#e55800] active:bg-[#cc4700]',
      border: 'bg-[#ff6500]/10',
      bg: 'bg-[#ff6500]/5',
    },
    warning: {
      icon: 'text-[#ff6500]',
      confirm: 'bg-[#ff6500] text-white hover:bg-[#e55800] active:bg-[#cc4700]',
      border: 'bg-[#ff6500]/10',
      bg: 'bg-[#ff6500]/5',
    },
    info: {
      icon: 'text-[#ff6500]',
      confirm: 'bg-[#ff6500] text-white hover:bg-[#e55800] active:bg-[#cc4700]',
      border: 'bg-[#ff6500]/10',
      bg: 'bg-[#ff6500]/5',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="flex max-w-sm flex-col overflow-hidden rounded-md bg-[#1a1a1a] shadow-2xl">
        <header className="flex items-center justify-between px-4 py-2.5">
          <h2 id="confirmation-dialog-title" className="text-[10px] font-medium text-[#d8d9da]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close dialog"
            className="rounded p-1 text-[#9fa7b3] hover:bg-[#2a2a2a] hover:text-[#d8d9da] transition-colors duration-150"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </header>

        <div className="space-y-3 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className={`mt-0.5 h-2.5 w-2.5 shrink-0 ${styles.icon}`}
              aria-hidden="true"
            />
            <p className="text-[8px] text-[#9fa7b3]">{message}</p>
          </div>

          <div className={`rounded ${styles.border} ${styles.bg} p-3`}></div>
        </div>

        <footer className="flex items-center justify-end gap-2 px-4 py-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[8px] text-[#9fa7b3] hover:text-[#d8d9da] transition-colors duration-150"
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