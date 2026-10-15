'use client';

import { useMemo, type MouseEvent, type PointerEvent } from 'react';
import { cn } from '@wideo11/ui/lib/utils';
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

const COLORS: Record<string, string> = {
  background: '#0d0d0d',
  trackBackground: '#1a1a1a',
  nodeBackground: '#1e1e1e',
  nodeHover: '#2a2a2a',
  nodeSelected: '#ff6500',
  nodeKeyframe: '#ff6500',
  nodeEffect: '#a855f7',
  border: '#2a2a2a',
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
        borderRadius: '6px',
      }}
      aria-label={'Frame template nodes for clip ' + clipId}
      role='list'
    >
      {frameNodes.map((node) => {
        const isSelected = selectedFrameIndex === node.frameIndex;
        const isHovered = hoveredFrameIndex === node.frameIndex;

        const baseStyle = {
          position: 'absolute',
          left: node.left,
          top: nodeTop,
          width: nodeWidth,
          height: nodeHeight,
          borderRadius: '6px',
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
        } as React.CSSProperties;

        let backgroundColor = COLORS.nodeBackground;
        let boxShadow = 'none';
        let borderColor = 'transparent';

        if (isSelected) {
          backgroundColor = COLORS.nodeSelected;
          boxShadow = '0 0 8px ' + COLORS.keyframeGlow + ', 0 0 16px ' + COLORS.accentDim;
          borderColor = COLORS.accent;
        } else if (isHovered) {
          backgroundColor = COLORS.nodeHover;
          boxShadow = '0 0 4px ' + COLORS.accentDim;
          borderColor = COLORS.border;
        } else {
          backgroundColor = COLORS.nodeBackground;
          borderColor = 'transparent';
        }

        if (node.isKeyframe) {
          boxShadow = (boxShadow !== 'none' ? boxShadow + ', ' : '') + '0 0 6px ' + COLORS.keyframeGlow + ', 0 0 12px ' + COLORS.keyframeGlow;
          borderColor = COLORS.nodeKeyframe;
        }

        if (node.hasEffect) {
          boxShadow = (boxShadow !== 'none' ? boxShadow + ', ' : '') + '0 0 6px ' + COLORS.effectGlow + ', 0 0 12px ' + COLORS.effectGlow;
          borderColor = COLORS.nodeEffect;
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
              border: isSelected || isHovered || node.isKeyframe || node.hasEffect ? '1px solid ' + borderColor : 'none',
            }}
            onMouseEnter={(e) => handleMouseEnter(e, node.frameIndex)}
            onMouseLeave={handleMouseLeave}
            onClick={(e) => handleClick(e, node.frameIndex)}
            onDoubleClick={(e) => handleDoubleClick(e, node.frameIndex)}
            onPointerDown={(e) => handlePointerDown(e, node.frameIndex)}
            tabIndex={isAura || isSuperadmin ? 0 : -1}
            onKeyDown={(e) => {
              if ((isAura || isSuperadmin) && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                handleClick(e as unknown as MouseEvent<HTMLDivElement>, node.frameIndex);
              }
            }}
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
                isSelected ? 'text-white' : 'text-fg-muted'
              )}
              style={{
                color: isSelected ? '#ffffff' : COLORS.textMuted,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
                paddingLeft: 1, paddingRight: 1,
              }}
              aria-hidden='true'
            >
              {node.frameIndex}
            </span>
            <span
              className={cn(
                'text-[6px] leading-none font-mono tabular-nums mt-0.5',
                'transition-colors duration-150',
                isSelected ? 'text-white/80' : 'text-fg-muted/60'
              )}
              style={{
                color: isSelected ? 'rgba(255,255,255,0.8)' : 'rgba(159,167,179,0.6)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
                paddingLeft: 1, paddingRight: 1,
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
                  borderRadius: '50%',
                  backgroundColor: COLORS.nodeKeyframe,
                  boxShadow: '0 0 4px ' + COLORS.keyframeGlow + ', 0 0 8px ' + COLORS.keyframeGlow,
                  animation: 'pulse-keyframe 2s ease-in-out infinite',
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
                  borderRadius: '50%',
                  backgroundColor: COLORS.nodeEffect,
                  boxShadow: '0 0 4px ' + COLORS.effectGlow + ', 0 0 8px ' + COLORS.effectGlow,
                  animation: 'pulse-effect 2s ease-in-out infinite',
                }}
                aria-hidden='true'
              />
            )}
          </div>
        );
      })}</div>
  );
}