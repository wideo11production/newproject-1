// ============================================================================
// FRAME STRIP - Horizontal per-frame thumbnails with all-side drag resize
// ============================================================================
//
// Shows all frames of the active template as a horizontal scrollable strip.
// Each frame thumbnail:
//   - Default size = 3x normal (premium look)
//   - Drag resize handles on ALL sides: top, bottom, left, right, corners
//   - Active frame highlighted with #ff6500 border
//   - Click to select frame (opens in FrameCanvas)
//   - Frame counter: "Frame N of M"
//
// Size sync: when sizeLocked is true, resizing one thumbnail resizes all.
// ============================================================================

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameTemplate, Frame } from '../../lib/engine/types';
import { DEFAULT_FRAME_SIZE, MIN_FRAME_WIDTH, MAX_FRAME_WIDTH } from '../../lib/engine/types';
import { createFrameTemplateStore } from '../../lib/engine/frame-template/store';

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const CURSORS: Record<ResizeDirection, string> = {
  n: 'cursor-n-resize',
  s: 'cursor-s-resize',
  e: 'cursor-e-resize',
  w: 'cursor-w-resize',
  ne: 'cursor-ne-resize',
  nw: 'cursor-nw-resize',
  se: 'cursor-se-resize',
  sw: 'cursor-sw-resize',
};

const HANDLE_CLASS = 'absolute w-3 h-3 bg-[#2a2a2a]/60 hover:bg-[#ff6500]/80';

interface FrameStripProps {
  template: FrameTemplate | null;
  onFrameSelect: (frameIndex: number) => void;
  onResize: (width: number, height: number) => void;
  onToggleSizeLock: () => void;
  store: ReturnType<typeof createFrameTemplateStore>;
}

export function FrameStrip({
  template,
  onFrameSelect,
  onResize,
  onToggleSizeLock,
  store,
}: FrameStripProps) {  const [thumbnailWidth, setThumbnailWidth] = useState<number>(template?.frameSize.width ?? DEFAULT_FRAME_SIZE.width);
  const [thumbnailHeight, setThumbnailHeight] = useState<number>(template?.frameSize.height ?? DEFAULT_FRAME_SIZE.height);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDir, setResizeDir] = useState<ResizeDirection | null>(null);

  const frames = template?.frames ?? [];
  const activeIndex = template?.activeFrameIndex ?? 0;
  const sizeLocked = template?.sizeLocked ?? true;

  // Sync thumbnail size from template when it changes externally
  useEffect(() => {
    if (template) {
      setThumbnailWidth(template.frameSize.width);
      setThumbnailHeight(template.frameSize.height);
    }
  }, [template]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, dir: ResizeDirection) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      setResizeDir(dir);

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = thumbnailWidth;
      const startHeight = thumbnailHeight;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isResizing) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let newWidth = startWidth;
        let newHeight = startHeight;

        // Horizontal resize
        if (dir.includes('e')) newWidth = startWidth + dx;
        if (dir.includes('w')) newWidth = startWidth - dx;

        // Vertical resize
        if (dir.includes('s')) newHeight = startHeight + dy;
        if (dir.includes('n')) newHeight = startHeight - dy;

        // Clamp
        newWidth = Math.max(MIN_FRAME_WIDTH, Math.min(MAX_FRAME_WIDTH, newWidth));
        newHeight = Math.max(MIN_FRAME_WIDTH, Math.min(MAX_FRAME_WIDTH, newHeight));

        setThumbnailWidth(newWidth);
        setThumbnailHeight(newHeight);
        onResize(newWidth, newHeight);

        // If size locked, update store which will update all frames
        if (sizeLocked) {
          store.resizeFrameSize(template?.id ?? '', { width: newWidth, height: newHeight });
        }
      };

      const onMouseUp = () => {
        setIsResizing(false);
        setResizeDir(null);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [isResizing, thumbnailWidth, thumbnailHeight, onResize, sizeLocked, store, template?.id]
  );

  const handleSizeLockToggle = useCallback(() => {
    onToggleSizeLock();
  }, [onToggleSizeLock]);

  const renderResizeHandle = (dir: ResizeDirection, className: string) => (
    <div
      className={`${HANDLE_CLASS} ${className} ${CURSORS[dir]}`}
      onMouseDown={(e) => handleResizeStart(e, dir)}
    />
  );

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] border-r border-[#2a2a2a] overflow-hidden">
      {/* Header with frame counter and size lock toggle */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#1a1a1a] border-b border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#ff6500]">FRAMES</span>
          <span className="text-xs text-gray-500">
            {frames.length > 0 ? `Frame ${activeIndex + 1} of ${frames.length}` : 'No frames'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Lock Size:</span>
          <button
            onClick={handleSizeLockToggle}
            className={`px-2 py-1 rounded text-xs border ${sizeLocked
              ? 'bg-[#ff6500]/20 border-[#ff6500]/50 text-[#ff6500]'
              : 'bg-[#2a2a2a] border-[#2a2a2a] text-gray-400'
            }`}
          >
            {sizeLocked ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Scrollable frame thumbnails strip */}
      <div
        ref={null}
        className="flex-1 overflow-x-auto overflow-y-hidden px-2 py-2 bg-[#0a0a0a] scrollbar-hide"
        style={{ scrollBehavior: 'smooth' }}
      >
        <div className="flex gap-2 h-full items-end">
          {frames.map((frame, idx) => (
            <div
              key={frame.index}
              className="relative group cursor-pointer flex flex-col items-center"
              onClick={() => onFrameSelect(frame.index)}
            >
              {/* Frame thumbnail */}
              <div
                className={`relative rounded border overflow-hidden shadow-md transition-all duration-200 ${
                  idx === activeIndex
                    ? 'border-[#ff6500] ring-2 ring-[#ff6500]/50 shadow-[0_0_15px_rgba(255,101,0,0.4)]'
                    : 'border-[#2a2a2a] hover:border-gray-500'
                }`}
                style={{
                  width: thumbnailWidth,
                  height: thumbnailHeight,
                }}
              >
                {/* Frame content placeholder - shows layer count */}
                <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1a]/80">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] font-bold text-white">{frame.index + 1}</span>
                    {frame.layers.length > 0 && (
                      <span className="text-[9px] text-[#ff6500]">{frame.layers.length} layer{frame.layers.length > 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>

                {/* Active indicator */}
                {idx === activeIndex && (
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-[#ff6500] text-[10px] text-white font-bold shadow-lg">
                    ACTIVE
                  </div>
                )}

                {/* Resize handles - All sides and corners */}
                {/* Top edge */}
                {renderResizeHandle('n', 'top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-b')}
                {/* Bottom edge */}
                {renderResizeHandle('s', 'bottom-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-t')}
                {/* Left edge */}
                {renderResizeHandle('w', 'top-1/2 -translate-y-1/2 left-0 w-2 h-2 rounded-r')}
                {/* Right edge */}
                {renderResizeHandle('e', 'top-1/2 -translate-y-1/2 right-0 w-2 h-2 rounded-l')}
                {/* Top-left corner */}
                {renderResizeHandle('nw', 'top-0 left-0')}
                {/* Top-right corner */}
                {renderResizeHandle('ne', 'top-0 right-0')}
                {/* Bottom-left corner */}
                {renderResizeHandle('sw', 'bottom-0 left-0')}
                {/* Bottom-right corner */}
                {renderResizeHandle('se', 'bottom-0 right-0')}
              </div>

              {/* Frame label */}
              <div className="mt-1 text-[10px] text-gray-400 truncate w-full text-center">
                F{frame.index + 1}
              </div>
            </div>
          ))}
          {/* Add new frame button */}
          <div
            className="flex items-center justify-center w-24 h-24 rounded border border-dashed border-[#2a2a2a] bg-[#1a1a1a]/50 hover:border-gray-500 transition-colors cursor-pointer"
          >
            <span className="text-[10px] text-gray-500">+ Frame</span>
          </div>
        </div>
      </div>
    </div>
  );
}
