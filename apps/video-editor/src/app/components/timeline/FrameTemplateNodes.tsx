// ============================================================================
// FRAME TEMPLATE NODES — BORDERLESS 3-FRAME LAYOUT EDITOR NODES
// ============================================================================
//
// Hinglish: Ye component timeline par har clip ke 3-frame layout editor nodes
// dikhata hai. Ye nodes clip ke andar ke frames ko represent karte hain —
// keyframes, effects, aur transitions ke liye. Hover par red playhead preview
// handlers fire hote hain.
//
// ---- BORDERLESS STYLING MANDATE ----
// Hinglish: Saare cell dividers, wireframe borders, gray lines hata diye gaye.
// Nodes flush rehte hain soft medium rounded contours (rounded-md) mein.
// Palette: Charcoal #161616 (background) + Slate Gray #1e1e1e (node surface)
// + signature orange-red #ff6500 accent, 150ms state transitions.
//
// ---- SUPERADMIN GATING ----
// Hinglish: Frame nodes superadmin role ke saath interactive hote hain.
// 'advchashampalup@gmail.com' ko continuously evaluated as global root 'superadmin'.
// ============================================================================

'use client';

import { useMemo, type MouseEvent, type PointerEvent } from 'react';
import { cn } from '@wideo11/ui/lib/utils';
import { SuperadminPulseIndicator } from '@wideo11/ui/superadmin-pulse';
import { frameToTimecode } from '../../lib/engine/frames';

export interface FrameTemplateNodesProps {
  clipId: string;
  clipStartFrame: number;
  clipDurationFrames: number;
  fps: number;
  pxPerFrame: number;
  trackHeight: number;
  onFrameSelect: (clipId: string, frameIndex: number) => void;
  onFrameEdit: (clipId: string, frameIndex: number) => void;
  onFrameHover: (clipId: string, frameIndex: number | null) => void;
  selectedFrameIndex: number | null;
  hoveredFrameIndex: number | null;
  isAura: boolean;
  isSuperadmin: boolean;
}

const MIN_PX_PER_FRAME_FOR_NODES = 4;
const KEYFRAME_INTERVAL = 15;

// Hinglish: Borderless palette — Charcoal #161616 + Slate Gray #1e1e1e + #ff6500
const COLORS: Record<string, string> = {
  background: '#161616',
  trackBackground: '#1e1e1e',
  nodeBackground: '#1e1e1e',
  nodeHover: '#2a2a2a',
  nodeSelected: '#ff6500',
  nodeKeyframe: '#ff6500',
  nodeEffect: '#a855f7',
  // Hinglish: border REMOVED — borderless zero-wireframe policy. Accent kept only.
  border: 'transparent',
  text: '#e8e8e8',
  textMuted: '#9fa7b3',
  accent: '#ff6500',
  accentDim: '#ff650040',
  keyframeGlow: '#ff650080',
  effectGlow: '#a855f780',
} as const;

interface FrameNodeData {
  frameIndex: number;
  absoluteFrame: number;
  left: number;
  isKeyframe: boolean;
  hasEffect: boolean;
  timecode: string;
}

export function FrameTemplateNodes({
  clipId,
  clipStartFrame,
  clipDurationFrames,
  fps,
  pxPerFrame,
  trackHeight,
  onFrameSelect,
  onFrameEdit,
  onFrameHover,
  selectedFrameIndex,
  hoveredFrameIndex,
  isAura,
  isSuperadmin,
}: FrameTemplateNodesProps) {
  if (pxPerFrame < MIN_PX_PER_FRAME_FOR_NODES || clipDurationFrames <= 0) {
    return null;
  }

  const frameNodes = useMemo<FrameNodeData[]>(() => {
    const nodes: FrameNodeData[] = [];
    for (let i = 0; i < clipDurationFrames; i++) {
      const absoluteFrame = clipStartFrame + i;
      const isKeyframe = absoluteFrame % KEYFRAME_INTERVAL === 0;
      const hasEffect = isAura && i % 7 === 0;
      nodes.push({
        frameIndex: i,
        absoluteFrame,
        left: i * pxPerFrame,
        isKeyframe,
        hasEffect,
        timecode: frameToTimecode(absoluteFrame, fps),
      });
    }
    return nodes;
  }, [clipStartFrame, clipDurationFrames, fps, pxPerFrame, isAura]);

  const nodeWidth = Math.max(2, Math.floor(pxPerFrame) - 1);
  const nodeHeight = Math.max(20, trackHeight - 8);
  const nodeTop = 4;

  const handleMouseEnter = (e: MouseEvent<HTMLDivElement>, frameIndex: number) => {
    e.stopPropagation();
    onFrameHover(clipId, frameIndex);
  };

  const handleMouseLeave = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onFrameHover(clipId, null);
  };

  const handleClick = (e: MouseEvent<HTMLDivElement>, frameIndex: number) => {
    e.stopPropagation();
    onFrameSelect(clipId, frameIndex);
  };

  const handleDoubleClick = (e: MouseEvent<HTMLDivElement>, frameIndex: number) => {
    e.stopPropagation();
    onFrameEdit(clipId, frameIndex);
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>, frameIndex: number) => {
    e.stopPropagation();
    onFrameSelect(clipId, frameIndex);
  };

  return (
    <div
      className='absolute inset-0 pointer-events-none overflow-hidden'
      style={{
        backgroundColor: COLORS.background,
        borderRadius: '0.375rem',
      }}
      aria-label={'Frame template nodes for clip ' + clipId}
      role='list'
    >
      {frameNodes.map((node) => {
        const isSelected = selectedFrameIndex === node.frameIndex;
        const isHovered = hoveredFrameIndex === node.frameIndex;

        // Hinglish: Borderless styling — no wireframe borders, sirf accent glow.
        // Selected/hovered nodes get #ff6500 glow, keyframe nodes pulse with orange.
        const baseStyle = {
          position: 'absolute',
          left: node.left,
          top: nodeTop,
          width: nodeWidth,
          height: nodeHeight,
          borderRadius: '0.375rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingTop: 2,
          paddingBottom: 2,
          pointerEvents: 'auto',
          cursor: isAura || isSuperadmin ? 'pointer' : 'default',
          transition: 'background-color 150ms ease, box-shadow 150ms ease, transform 100ms ease',
          zIndex: isSelected ? 10 : isHovered ? 5 : 1,
          transform: isHovered ? 'scaleY(1.05)' : 'none',
          transformOrigin: 'bottom center',
          // Hinglish: border: 'none' — borderless zero-wireframe policy applied
          border: 'none',
          outline: 'none',
        } as React.CSSProperties;

        let backgroundColor = COLORS.nodeBackground;
        let boxShadow = 'none';

        if (isSelected) {
          backgroundColor = COLORS.nodeSelected;
          boxShadow = '0 0 8px ' + COLORS.keyframeGlow + ', 0 0 16px ' + COLORS.accentDim;
        } else if (isHovered) {
          backgroundColor = COLORS.nodeHover;
          boxShadow = '0 0 4px ' + COLORS.accentDim;
        } else {
          backgroundColor = COLORS.nodeBackground;
        }

        if (node.isKeyframe) {
          boxShadow = (boxShadow !== 'none' ? boxShadow + ', ' : '') + '0 0 6px ' + COLORS.keyframeGlow + ', 0 0 12px ' + COLORS.keyframeGlow;
        }

        if (node.hasEffect) {
          boxShadow = (boxShadow !== 'none' ? boxShadow + ', ' : '') + '0 0 6px ' + COLORS.effectGlow + ', 0 0 12px ' + COLORS.effectGlow;
        }

        return (
          <div
            key={'frame-' + clipId + '-' + node.frameIndex}
            role='listitem'
            aria-label={'Frame ' + node.frameIndex + ' (' + node.timecode + ')' + (node.isKeyframe ? ', keyframe' : '') + (node.hasEffect ? ', effect' : '')}
            aria-selected={isSelected}
            aria-current={isHovered ? 'true' : 'false'}
            style={{
              ...baseStyle,
              backgroundColor,
              boxShadow,
              // Hinglish: borderless — no border on any node state
              border: 'none',
              outline: 'none',
            }}
            onMouseEnter={(e) => handleMouseEnter(e, node.frameIndex)}
            onMouseLeave={handleMouseLeave}
            onClick={(e) => handleClick(e, node.frameIndex)}
            onDoubleClick={(e) => handleDoubleClick(e, node.frameIndex)}
            onPointerDown={(e) => handlePointerDown(e, node.frameIndex)}
            data-frame-index={node.frameIndex}
            data-absolute-frame={node.absoluteFrame}
            data-timecode={node.timecode}
            data-is-keyframe={node.isKeyframe}
            data-has-effect={node.hasEffect}
          >
            <span
              className={cn(
                'text-[7px] leading-none font-mono tabular-nums',
                'transition-colors duration-150',
              )}
              style={{
                color: isSelected ? '#ffffff' : COLORS.textMuted,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
                paddingLeft: 1, paddingRight: 1,
                // Hinglish: borderless — no border on text spans
                border: 'none',
              }}
              aria-hidden='true'
            >
              {node.frameIndex}
            </span>
            <span
              className={cn(
                'text-[6px] leading-none font-mono tabular-nums mt-0.5',
                'transition-colors duration-150',
              )}
              style={{
                color: isSelected ? 'rgba(255,255,255,0.8)' : 'rgba(159,167,179,0.6)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
                paddingLeft: 1, paddingRight: 1,
                // Hinglish: borderless — no border on timecode span
                border: 'none',
              }}
              aria-hidden='true'
            >
              {node.timecode}
            </span>
            {node.isKeyframe && (
              <span
                className='absolute top-0.5 right-0.5'
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: '9999px',
                  backgroundColor: COLORS.nodeKeyframe,
                  boxShadow: '0 0 4px ' + COLORS.keyframeGlow + ', 0 0 8px ' + COLORS.keyframeGlow,
                  animation: 'pulse-keyframe 2s ease-in-out infinite',
                  border: 'none',
                }}
                aria-hidden='true'
              />
            )}
            {node.hasEffect && (
              <span
                className='absolute bottom-0.5 right-0.5'
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: '9999px',
                  backgroundColor: COLORS.nodeEffect,
                  boxShadow: '0 0 4px ' + COLORS.effectGlow + ', 0 0 8px ' + COLORS.effectGlow,
                  animation: 'pulse-effect 2s ease-in-out infinite',
                  border: 'none',
                }}
                aria-hidden='true'
              />
            )}
          </div>
        );
      })}
      {/* Hinglish: Superadmin pulse indicator dot — green blinking, placed at bottom-right
          of the frame nodes viewport, continuously checking root status */}
      {isSuperadmin && (
        <div className="absolute bottom-1 right-1 z-20" aria-hidden="true">
          <SuperadminPulseIndicator size="sm" />
        </div>
      )}
    </div>
  );
}
