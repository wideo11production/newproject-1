// ============================================================================
// FRAME CANVAS - Active frame render with layers and mask editing
// ============================================================================
//
// Renders the active frame of a FrameTemplate on an HTML canvas.
// Each layer is drawn in zIndex order. Clicking a layer opens the
// IsolatedElementBox for that element. Masks are rendered as overlays.
//
// Canvas size matches the template frameSize (3x normal default).
// ============================================================================

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameTemplate, FrameLayer, FrameMask, Frame } from '../../lib/engine/types';

interface FrameCanvasProps {
  template: FrameTemplate | null;
  activeFrame: Frame | null;
  onLayerClick: (layerId: string) => void;
  onLayerDrag: (layerId: string, dx: number, dy: number) => void;
}

interface LayerHitResult {
  layerId: string;
  layer: FrameLayer;
  offsetX: number;
  offsetY: number;
}

export function FrameCanvas({
  template,
  activeFrame,
  onLayerClick,
  onLayerDrag,
}: FrameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({
    width: template?.frameSize.width ?? 5760,
    height: template?.frameSize.height ?? 3240,
  });
  const [scale, setScale] = useState(1); // CSS scale to fit in container
  const [isDragging, setIsDragging] = useState(false);
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; layerX: number; layerY: number }>({ x: 0, y: 0, layerX: 0, layerY: 0 });

  // Sync canvas size from template
  useEffect(() => {
    if (template) {
      setCanvasSize({ width: template.frameSize.width, height: template.frameSize.height });
    }
  }, [template]);

  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctxRef.current = ctx;
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    drawFrame();
  }, [activeFrame, canvasSize, template]);

  /** Draw the active frame with all layers on canvas. */
  function drawFrame() {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas || !activeFrame) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw center guides
    ctx.strokeStyle = 'rgba(255, 101, 0, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    // Sort layers by zIndex (low to high)
    const sortedLayers = [...activeFrame.layers].sort((a, b) => a.zIndex - b.zIndex);

    for (const layer of sortedLayers) {
      if (!layer.visible) continue;

      ctx.save();

      // Apply layer transform
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const lx = layer.transform.x * canvas.width;
      const ly = layer.transform.y * canvas.height;
      const lw = canvas.width * layer.transform.scale;
      const lh = canvas.height * layer.transform.scale;

      ctx.translate(lx, ly);
      ctx.rotate((layer.transform.rotation * Math.PI) / 180);
      ctx.scale(layer.transform.scale, layer.transform.scale);
      ctx.translate(-lx, -ly);
      ctx.globalAlpha = layer.opacity;

      // Draw layer content based on type
      if (layer.type === 'image' || layer.type === 'video') {
        // Draw a colored rectangle representing the media
        const hue = hashColor(layer.id);
        ctx.fillStyle = `hsl(${hue} 60% 40%)`;
        ctx.fillRect(lx - lw / 2, ly - lh / 2, lw, lh);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(lx - lw / 2, ly - lh / 2, lw, lh);

        // Label
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(layer.type.toUpperCase(), lx, ly);
      } else if (layer.type === 'text') {
        ctx.fillStyle = layer.content ? '#ffffff' : 'rgba(255,255,255,0.3)';
        ctx.font = 'bold 24px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(layer.content || 'TEXT', lx, ly);
      } else if (layer.type === 'shape') {
        const hue = hashColor(layer.id);
        ctx.fillStyle = `hsl(${hue} 70% 50%)`;
        ctx.beginPath();
        ctx.arc(lx, ly, Math.min(lw, lh) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Draw mask overlay if layer has mask
      if (layer.maskId) {
        const mask = activeFrame.masks.find((m) => m.id === layer.maskId);
        if (mask) {
          ctx.save();
          ctx.globalAlpha = mask.opacity * 0.5;
          ctx.fillStyle = mask.invert ? '#000000' : '#ffffff';
          ctx.beginPath();
          if (mask.points.length > 0) {
            ctx.moveTo(mask.points[0].x * canvas.width, mask.points[0].y * canvas.height);
            for (let i = 1; i < mask.points.length; i++) {
              ctx.lineTo(mask.points[i].x * canvas.width, mask.points[i].y * canvas.height);
            }
            ctx.closePath();
          }
          ctx.fill();
          ctx.restore();
        }
      }

      // Draw selection border if isolated
      if (layer.isolated) {
        ctx.strokeStyle = '#ff6500';
        ctx.lineWidth = 3;
        ctx.strokeRect(lx - lw / 2, ly - lh / 2, lw, lh);
      }

      ctx.restore();
    }

    // Draw layer handles / labels
    for (const layer of sortedLayers) {
      if (!layer.visible) continue;
      const lx = layer.transform.x * canvas.width;
      const ly = layer.transform.y * canvas.height;
      const lw = canvas.width * layer.transform.scale;
      const lh = canvas.height * layer.transform.scale;

      // Layer handle at top-left of element
      ctx.fillStyle = layer.locked ? '#666666' : '#ff6500';
      ctx.beginPath();
      ctx.arc(lx - lw / 2 + 8, ly - lh / 2 + 8, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Hash a string to a hue value for consistent colors. */
  function hashColor(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash % 360);
  }

  /** Get layer at canvas coordinates. */
  function getLayerAt(x: number, y: number): LayerHitResult | null {
    if (!activeFrame) return null;
    const sortedLayers = [...activeFrame.layers].sort((a, b) => b.zIndex - a.zIndex); // top-down for hit test

    for (const layer of sortedLayers) {
      if (!layer.visible) continue;
      const lx = layer.transform.x * canvasSize.width;
      const ly = layer.transform.y * canvasSize.height;
      const lw = canvasSize.width * layer.transform.scale;
      const lh = canvasSize.height * layer.transform.scale;

      // Simple rect hit test (ignore rotation for simplicity)
      if (
        x >= lx - lw / 2 &&
        x <= lx + lw / 2 &&
        y >= ly - lh / 2 &&
        y <= ly + lh / 2
      ) {
        return { layerId: layer.id, layer, offsetX: x - (lx - lw / 2), offsetY: y - (ly - lh / 2) };
      }
    }
    return null;
  }

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = canvasSize.width / rect.width;
      const scaleY = canvasSize.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const hit = getLayerAt(x, y);
      if (hit) {
        setIsDragging(true);
        setDragLayerId(hit.layerId);
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          layerX: hit.layer.transform.x * canvasSize.width,
          layerY: hit.layer.transform.y * canvasSize.height,
        };
        onLayerClick(hit.layerId);
      }
    },
    [canvasSize, onLayerClick]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDragging || !dragLayerId || !activeFrame) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;

      // Convert to canvas coords
      const canvasDX = (dx / canvasRef.current!.getBoundingClientRect().width) * canvasSize.width;
      const canvasDY = (dy / canvasRef.current!.getBoundingClientRect().height) * canvasSize.height;

      const newX = (dragStartRef.current.layerX + canvasDX) / canvasSize.width;
      const newY = (dragStartRef.current.layerY + canvasDY) / canvasSize.height;

      onLayerDrag(dragLayerId, newX - dragStartRef.current.layerX / canvasSize.width, newY - dragStartRef.current.layerY / canvasSize.height);
      dragStartRef.current = { x: e.clientX, y: e.clientY, layerX: newX, layerY: newY };
    },
    [isDragging, dragLayerId, activeFrame, canvasSize, onLayerDrag]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragLayerId(null);
  }, []);

  return (
    <div
      className="relative flex-1 bg-[#0a0a0a] overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ touchAction: 'none' }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: canvasSize.width,
          height: canvasSize.height,
        }}
      />
      {/* Overlay hint when no frame */}
      {!activeFrame && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
          <span className="text-sm">No frame selected</span>
          <span className="text-xs mt-1">Select a frame from the strip</span>
        </div>
      )}
    </div>
  );
}
