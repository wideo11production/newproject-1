// ============================================================================
// WEB FRAME NODES — Borderless 3-frame layout editor nodes with red playhead
// ============================================================================
//
// Hinglish: Ye web app ke liye 3-frame layout editor nodes ka simplified version
// hai. Video editor ke FrameTemplateNodes.tsx ka web-adapted variant — timeline
// types ke bina kaam karta hai. Har node ek frame represent karta hai:
//   Frame-1 (previous) | Frame-0 (active/current) | Frame+1 (next)
//
// RED PLAYHEAD HOVER PREVIEW HANDLERS:
//   - Hover par node ka preview frame show hota hai
//   - Red playhead bar (bg-[#ff6500]) animation ke saath move karta hai
//   - 150ms state transitions with orange-red accent
//
// BORDERLESS MANDATE:
//   - No wireframe borders, gray lines, or cell dividers
//   - Flushed panels inside rounded-md contours
//   - Charcoal #161616 + Slate Gray #1e1e1e palette
//   - Orange-red #ff6500 accent
// ============================================================================

'use client';

import { useState, useCallback, type MouseEvent } from 'react';
import { Play, Pause, SkipForward, SkipBack } from 'lucide-react';
import { SuperadminPulseIndicator } from '@wideo11/ui/superadmin-pulse';
import { useSessionIdentity } from '@/lib/identity-context';

// Hinglish: Borderless palette — Port 3000 palette blocks
const PANEL_BG = '#161616';
const PANEL_HEADER_BG = '#1e1e1e';
const ACCENT = '#ff6500';
const RED_PLAYHEAD = '#ff0000';

export interface WebFrameNode {
  index: number;
  label: string;
  timecode: string;
  isCurrent: boolean;
  isKeyframe: boolean;
  hasEffect: boolean;
  thumbnailUrl?: string;
}

export interface WebFrameNodesProps {
  /** Media ID for the clip being edited. */
  mediaId: string;
  /** Total frames in the clip. */
  totalFrames: number;
  /** Current frame index. */
  currentFrame: number;
  /** Frames per second. */
  fps: number;
  /** Width of each frame node in pixels. */
  frameWidthPx: number;
  /** Callbacks for frame interaction. */
  onFrameSelect: (frameIndex: number) => void;
  onFrameHover: (frameIndex: number | null) => void;
  onSeekToFrame: (frameIndex: number) => void;
  /** Optional user context for superadmin gating. */
  userEmail?: string;
  userRole?: string;
}

export function WebFrameNodes({
  mediaId,
  totalFrames,
  currentFrame,
  fps,
  frameWidthPx,
  onFrameSelect,
  onFrameHover,
  onSeekToFrame,
  userEmail,
  userRole,
}: WebFrameNodesProps) {
  const { email, isSuperadmin } = useSessionIdentity();
  const [hoveredFrame, setHoveredFrame] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Hinglish: Admin Pass — continuously evaluate root status
  const isRootSuperadmin =
    (email ?? '').toLowerCase().trim() === 'advchashampalup@gmail.com' || isSuperadmin;

  // Hinglish: Generate the 3-frame buffer ring around the current frame.
  // Frame-1, Frame-0 (active), Frame+1 — exactly 3 discrete frames.
  // Playhead cannot leave this ring (hard-clamped for precision).
  const [frameNodes, setFrameNodes] = useState<WebFrameNode[]>([]);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);

  const generateFrameNodes = useCallback(() => {
    const nodes: WebFrameNode[] = [];
    const center = currentFrame;

    // Hinglish: 3-frame buffer ring — previous, current, next
    for (let i = -1; i <= 1; i++) {
      const frameIdx = Math.max(0, Math.min(totalFrames - 1, center + i));
      const timecode = formatTimecode(frameIdx, fps);
      nodes.push({
        index: frameIdx,
        label: i === 0 ? 'Frame-0 (Active)' : i === -1 ? 'Frame-1' : 'Frame+1',
        timecode,
        isCurrent: i === 0,
        isKeyframe: frameIdx % 15 === 0,
        hasEffect: isRootSuperadmin && frameIdx % 7 === 0,
      });
    }
    setFrameNodes(nodes);
  }, [currentFrame, totalFrames, fps, isRootSuperadmin]);

  // Regenerate nodes when current frame changes
  if (frameNodes.length === 0 || frameNodes[1]?.index !== currentFrame) {
    generateFrameNodes();
  }

  const handleMouseEnter = useCallback(
    (frameIndex: number) => {
      setHoveredFrame(frameIndex);
      onFrameHover(frameIndex);
    },
    [onFrameHover]
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredFrame(null);
    onFrameHover(null);
  }, [onFrameHover]);

  const handleFrameClick = useCallback(
    (frameIndex: number) => {
      setActiveFrameIndex(frameIndex);
      setFrameNodes((prev) => {
        const updated = [...prev];
        const idx = updated.findIndex((n) => n.index === frameIndex);
        if (idx >= 0) updated[idx] = { ...updated[idx], isCurrent: true };
        updated.forEach((n, i) => {
          if (i !== idx) n.isCurrent = false;
        });
        return updated;
      });
      onFrameSelect(frameIndex);
    },
    [onFrameSelect]
  );

  const handlePlayPause = useCallback(() => {
    setIsPlaying((p) => !p);
    if (!isPlaying && currentFrame < totalFrames - 1) {
      onSeekToFrame(currentFrame + 1);
    }
  }, [isPlaying, currentFrame, totalFrames, onSeekToFrame]);

  const handlePrev = useCallback(() => {
    onSeekToFrame(Math.max(0, currentFrame - 1));
  }, [currentFrame, onSeekToFrame]);

  const handleNext = useCallback(() => {
    onSeekToFrame(Math.min(totalFrames - 1, currentFrame + 1));
  }, [currentFrame, totalFrames, onSeekToFrame]);

  return (
    <div
      className="relative flex flex-col gap-2"
      style={{
        backgroundColor: PANEL_BG,
        borderRadius: '0.375rem',
        border: 'none',
      }}
    >
      {/* Header — borderless, green superadmin pulse dot */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{
          backgroundColor: PANEL_HEADER_BG,
          borderBottom: 'none',
          border: 'none',
        }}
      >
        <div className="flex items-center gap-2">
          <SuperadminPulseIndicator
            email={userEmail ?? email}
            role={userRole ?? (isRootSuperadmin ? 'superadmin' : 'user')}
            size="sm"
          />
          <span className="text-xs font-medium text-white">
            3-Frame Layout Editor
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handlePrev}
            className="p-1 rounded-md text-gray-400 transition-all duration-150 hover:text-[#ff6500] hover:bg-[#2a2a2a]"
            style={{ border: 'none', background: 'none' }}
            aria-label="Previous frame"
            title="Previous frame (Frame-1)"
          >
            <SkipBack className="h-3 w-3" />
          </button>
          <button
            onClick={handlePlayPause}
            className="p-1 rounded-md text-gray-400 transition-all duration-150 hover:text-[#ff6500] hover:bg-[#2a2a2a]"
            style={{ border: 'none', background: 'none' }}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
          </button>
          <button
            onClick={handleNext}
            className="p-1 rounded-md text-gray-400 transition-all duration-150 hover:text-[#ff6500] hover:bg-[#2a2a2a]"
            style={{ border: 'none', background: 'none' }}
            aria-label="Next frame"
            title="Next frame (Frame+1)"
          >
            <SkipForward className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Frame nodes row — 3-frame buffer ring with red playhead hover */}
      <div className="flex items-center gap-1 px-3 py-2">
        {frameNodes.map((node, idx) => {
          const isHovered = hoveredFrame === node.index;
          const isRedPlayhead = node.isCurrent || isHovered;

          return (
            <div
              key={`node-${node.index}-${node.label}`}
              className="relative flex flex-col items-center gap-1 transition-all duration-150"
              style={{
                width: frameWidthPx,
                backgroundColor: node.isCurrent
                  ? `${ACCENT}/10`
                  : isHovered
                    ? PANEL_HEADER_BG
                    : PANEL_BG,
                borderRadius: '0.375rem',
                border: 'none',
                transform: isHovered ? 'scale(1.05)' : 'none',
              }}
              onMouseEnter={() => handleMouseEnter(node.index)}
              onMouseLeave={handleMouseLeave}
              onClick={() => handleFrameClick(node.index)}
            >
              {/* Hinglish: Frame label + timecode */}
              <span className="text-[7px] font-mono text-gray-400">
                {node.label}
              </span>

              {/* Frame rectangle — shows thumbnail or placeholder */}
              <div
                className="relative flex items-center justify-center overflow-hidden"
                style={{
                  width: '100%',
                  height: 48,
                  backgroundColor: '#000000',
                  borderRadius: '0.375rem',
                  border: 'none',
                }}
              >
                {node.thumbnailUrl ? (
                  <img
                    src={node.thumbnailUrl}
                    alt={node.label}
                    className="h-full w-full object-cover"
                    style={{ borderRadius: '0.375rem' }}
                  />
                ) : (
                  <Play
                    className="h-4 w-4 text-gray-500"
                    style={{ color: isRedPlayhead ? RED_PLAYHEAD : '#6b7280' }}
                  />
                )}

                {/* Hinglish: Red playhead bar on hover — Movavi style animated bar */}
                {isRedPlayhead && (
                  <div
                    className="absolute inset-x-0 bottom-0 h-[2px] z-10"
                    style={{
                      backgroundColor: RED_PLAYHEAD,
                      animation: 'playhead 2s linear infinite',
                      border: 'none',
                    }}
                  />
                )}
              </div>

              {/* Timecode */}
              <span className="text-[6px] font-mono text-gray-500">
                {node.timecode}
              </span>

              {/* Keyframe / effect indicators — borderless dots */}
              {node.isKeyframe && (
                <span
                  className="absolute top-0.5 right-0.5"
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: '9999px',
                    backgroundColor: ACCENT,
                    border: 'none',
                    animation: 'pulse 2s ease-in-out infinite',
                  }}
                  aria-hidden="true"
                />
              )}
              {node.hasEffect && (
                <span
                  className="absolute bottom-0.5 right-0.5"
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: '9999px',
                    backgroundColor: '#a855f7',
                    border: 'none',
                  }}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Footer — borderless, frame count + status */}
      <div
        className="px-3 py-1 flex items-center justify-between text-[9px]"
        style={{
          backgroundColor: PANEL_BG,
          borderTop: 'none',
          border: 'none',
        }}
      >
        <span className="text-gray-400">
          Media: {mediaId} • Frame {currentFrame} / {totalFrames}
        </span>
        {isRootSuperadmin && (
          <span className="flex items-center gap-1 text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse"></span>
            Root mode
          </span>
        )}
      </div>
    </div>
  );
}

/** Format frame index as timecode HH:MM:SS.FF */
function formatTimecode(frame: number, fps: number): string {
  const totalSeconds = frame / fps;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const fr = Math.floor(frame % fps);
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${fr.toString().padStart(2, '0')}`;
}
