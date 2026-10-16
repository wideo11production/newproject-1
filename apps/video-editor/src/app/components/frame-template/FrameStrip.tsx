// ============================================================================
// FRAME STRIP - Horizontal per-frame thumbnails with drag resize
// ============================================================================
//
// Shows all frames of the active template as a horizontal scrollable strip.
// Each frame thumbnail:
//   - Default size = 3x normal (premium look)
//   - Drag resize handle: min 100px, max 500px width
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
}: FrameStripProps) {
  const [thumbnailWidth, setThumbnailWidth] = useState<number>(template?.frameSize.width ?? DEFAULT_FRAME_SIZE.width);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);

  const frames = template?.frames ?? [];
  const activeIndex = template?.activeFrameIndex ?? 0;
  const sizeLocked = template?.sizeLocked ?? true;

  // Sync thumbnail width from template when it changes externally
  useEffect(() => {
    if (template) {
      setThumbnailWidth(template.frameSize.width);
    }
  }, [template]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = thumbnailWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing) return;
      const dx = ev.clientX - startX;
      let newWidth = startWidth + dx;
      newWidth = Math.max(MIN_FRAME_WIDTH, Math.min(MAX_FRAME_WIDTH, newWidth));

      // Maintain aspect ratio (16:9)
      const newHeight = Math.round((newWidth * 9) / 16);

      setThumbnailWidth(newWidth);
      onResize(newWidth, newHeight);

      // If size locked, update store which will update all frames
      if (sizeLocked) {
        store.resizeFrameSize(template?.id ?? '', { width: newWidth, height: newHeight });
      }
    };

    const onMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [isResizing, thumbnailWidth, onResize, sizeLocked, store, template?.id]);

  const handleSizeLockToggle = useCallback(() => {
    onToggleSizeLock();
  }, [onToggleSizeLock]);

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
        ref={containerRef}
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
                  height: Math.round((thumbnailWidth * 9) / 16),
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
              </div>

              {/* Frame label */}
              <div className="mt-1 text-[10px] text-gray-400 truncate w-full text-center">
                F{frame.index + 1}
              </div>

              {/* Drag resize handle (bottom-right corner of thumbnail) */}
              <div
                ref={resizeHandleRef}
                className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize bg-[#2a2a2a]/60 hover:bg-[#ff6500]/80 rounded-bl rounded-tr rounded-tl"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  handleMouseDown(e as unknown as React.MouseEvent);
                }}
              />
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
