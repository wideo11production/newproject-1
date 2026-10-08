'use client';

// ============================================================================
// Recover Dialog Component
// ============================================================================
//
// Hinglish: agar user ne koi clip delete kiya ho, toh uske recover karne ka
// ek dialog open hota hai jo delete ho chuke clips ko dikhata hai aur
// user ko unse restore karne ka option deta hai. Dialog borderless hai,
// rounded-md, bg-[#1a1a1a] Rich Charcoal, with orange-red (#ff6500) accent
// for action buttons.

import { RotateCcw, Trash2, X } from 'lucide-react';

export interface DeletedClip {
  id: string;
  mediaId: string;
  mediaName: string;
  trackName: string;
  startTime: number;
  duration: number;
  deletedAt: number;
}

export interface RecoverDialogProps {
  open: boolean;
  deletedClips: DeletedClip[];
  onRecover: (clipId: string) => void;
  onRecoverAll: () => void;
  onClose: () => void;
}

export function RecoverDialog({
  open,
  deletedClips,
  onRecover,
  onRecoverAll,
  onClose,
}: RecoverDialogProps) {
  if (!open) return null;

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recover-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface/70 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-md-edge-strong bg-surface-raised shadow-2xl">
        <header className="flex items-center justify-between-edge px-4 py-2.5">
          <h2 id="recover-dialog-title" className="text-[10px] font-medium text-fg">
            <div className="flex items-center gap-2">
              <RotateCcw className="h-2.5 w-2.5 text-[#ff6500]" />
              Clips Removed
            </div>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close recovery dialog"
            className="rounded p-1 text-fg-muted hover:bg-surface-overlay hover:text-fg"
          >
            <X className="h-2 w-2" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {deletedClips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <RotateCcw className="mb-3 h-12 w-12 text-fg-muted/30" />
              <p className="text-[10px] text-fg-muted">No clips in the recovery bin</p>
              <p className="mt-1 text-[8px] text-fg-muted/60">Deleted clips are automatically cleaned up after 24 hours</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[8px] text-fg-muted">
                  {deletedClips.length} clip{deletedClips.length === 1 ? '' : 's'} removed
                </p>
                <button
                  type="button"
                  onClick={onRecoverAll}
                  className="text-[8px] text-[#ff6500] hover:text-[#e55800]"
                >
                  Recover all
                </button>
              </div>

              <div className="space-y-2">
                {deletedClips.map((clip) => (
                  <div
                    key={clip.id}
                    className="flex items-center justify-between rounded-md border border-[#2a2a2a] bg-surface p-3 transition-colors hover:bg-[#2a2a2a]/30"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        <Trash2 className="h-2.5 w-2.5 text-rose-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[8px] font-medium text-fg">{clip.mediaName}</p>
                        <p className="truncate text-[8px] text-fg-muted">{clip.trackName}</p>
                        <p className="mt-1 text-[7px] text-fg-muted/60">
                          {formatTime(clip.startTime)} · {formatTime(clip.duration)} · {formatDate(clip.deletedAt)}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onRecover(clip.id)}
                      className="ml-3 rounded-md px-2.5 py-1.5 text-[8px] font-medium text-[#ff6500] transition-colors hover:bg-[#ff6500]/10 hover:text-[#e55800]"
                    >
                      Recover
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-[#2a2a2a]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[8px] text-fg-muted hover:text-fg transition-colors duration-150"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
