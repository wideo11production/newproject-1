'use client';

/**
 * CONFIRMATION DIALOG - Accessible, borderless confirmation modal.
 *
 * Replaces browser alert() with a proper dialog that matches the design system.
 * - Borderless: background color separation only
 * - 10px/12px icon sizing
 * - Orange-red accent for destructive actions
 * - Focus trap and keyboard navigation
 * - Portal rendering to avoid z-index issues
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, X, Check, Trash2 } from 'lucide-react';

import {
  productAccent,
  productAccentBg,
  productAccentHoverBg,
  productPanel,
  productSeparation,
  productSeparationStrong,
  productSunken,
  productTextBody,
  productTextMuted,
} from '@wideo11/ui/design-system';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'destructive' | 'primary';
  icon?: React.ReactNode;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'destructive',
  icon,
}: ConfirmDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      // Trap focus
      const handleTab = (e: KeyboardEvent) => {
        if (e.key === 'Tab') {
          const focusableElements = dialogRef.current?.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (!focusableElements || focusableElements.length === 0) return;

          const firstElement = focusableElements[0] as HTMLElement;
          const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

          if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          } else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
        if (e.key === 'Escape') {
          onClose();
        }
      };

      document.addEventListener('keydown', handleTab);
      dialogRef.current?.focus();

      return () => {
        document.removeEventListener('keydown', handleTab);
        previousActiveElement.current?.focus();
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const dialogContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
    >
      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`relative w-full max-w-md ${productPanel} rounded-lg shadow-2xl border ${productSeparation} overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200`}
      >
        {/* Header */}
        <div className={`flex items-start gap-3 p-5 border-b ${productSeparation}`}>
          <div className={`flex-shrink-0 p-2 rounded-lg ${variant === 'destructive' ? 'bg-red-500/10' : `${productAccentBg}/10`}`}>
            {icon || (
              variant === 'destructive' ? (
                <AlertCircle className="h-5 w-5 text-red-500" />
              ) : (
                <Check className={`h-5 w-5 ${productAccent}`} />
              )
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="confirm-title" className={`text-lg font-semibold ${productTextBody}`}>
              {title}
            </h2>
            <p id="confirm-message" className={`mt-1 text-sm ${productTextMuted}`}>
              {message}
            </p>
          </div>
          <button
            onClick={onClose}
            className={`flex-shrink-0 p-1 rounded hover:${productSeparation} transition-colors ${productTextMuted} hover:${productTextBody}`}
            aria-label="Close"
          >
            <X className="h-[10px] w-[10px]" />
          </button>
        </div>

        {/* Actions */}
        <div className={`flex items-center justify-end gap-2 p-4 ${productSunken}/50`}>
          <button
            onClick={onClose}
            type="button"
            className={`px-4 py-2 rounded-md text-sm font-medium ${productTextMuted} ${productSeparation} hover:${productSeparationStrong} transition-colors`}
          >
            {cancelText}
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            type="button"
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              variant === 'destructive'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : `${productAccentBg} text-white ${productAccentHoverBg}`
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );

  // Render to body portal
  if (typeof document !== 'undefined') {
    return createPortal(dialogContent, document.body);
  }
  return null;
}

/**
 * DELETE CONFIRMATION DIALOG - Specialized for delete actions.
 */
interface DeleteConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  itemName?: string;
  itemType?: 'video' | 'reel' | 'audio' | 'upload' | 'channel';
}

export function DeleteConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  itemName,
  itemType = 'upload',
}: DeleteConfirmDialogProps) {
  const typeLabels: Record<string, string> = {
    video: 'video',
    reel: 'Reel',
    audio: 'audio clip',
    upload: 'upload',
    channel: 'channel',
  };

  const typeIcon: Record<string, React.ReactNode> = {
    video: <Trash2 className="h-5 w-5 text-red-500" />,
    reel: <Trash2 className="h-5 w-5 text-red-500" />,
    audio: <Trash2 className="h-5 w-5 text-red-500" />,
    upload: <Trash2 className="h-5 w-5 text-red-500" />,
    channel: <Trash2 className="h-5 w-5 text-red-500" />,
  };

  const label = typeLabels[itemType] || 'item';
  const name = itemName ? ` "${itemName}"` : '';

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title={`Delete ${label}${name}?`}
      message={`This will permanently delete the ${label}${name}. This action cannot be undone.`}
      confirmText="Delete"
      cancelText="Cancel"
      variant="destructive"
      icon={typeIcon[itemType]}
    />
  );
}