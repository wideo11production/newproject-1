import React, { useRef, useEffect, useState, CSSProperties } from "react";
import type { MouseEvent } from "react";

interface MediaPlayerCanvasOverlayProps {
  isActive: boolean;
  videoWidth: number;
  videoHeight: number;
  onSelectRegion: (x: number, y: number, width: number, height: number) => void;
  onCoordinatesChange: (x: number, y: number) => void;
  scale: number;
  offsetX: number;
  offsetY: number;
  children?: React.ReactNode;
}

interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const COLORS = {
  background: "#0d0d0d",
  overlay: "#00000080",
  selection: "#ff6500",
  border: "#ff6500",
  text: "#e8e8e8",
  accent: "#ff6500",
} as const;

const CONTAINER_STYLE: CSSProperties = {
  position: "relative",
  borderRadius: "0.375rem",
  overflow: "hidden",
  backgroundColor: COLORS.background,
} as const;

const CANVAS_STYLE: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  touchAction: "none",
  cursor: "crosshair",
} as const;

const COORDINATE_READOUT_STYLE: CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  backgroundColor: "rgba(13, 13, 13, 0.9)",
  color: COLORS.text,
  padding: "4px 8px",
  borderRadius: "4px",
  fontSize: "12px",
  fontFamily: "monospace",
  fontWeight: 500,
  pointerEvents: "none",
  zIndex: 10,
  border: `1px solid ${COLORS.border}`,
} as const;

const SELECTION_INFO_STYLE: CSSProperties = {
  position: "absolute",
  backgroundColor: "rgba(13, 13, 13, 0.9)",
  color: COLORS.text,
  padding: "4px 8px",
  borderRadius: "4px",
  fontSize: "12px",
  fontFamily: "monospace",
  fontWeight: 500,
  pointerEvents: "none",
  zIndex: 10,
  border: `1px solid ${COLORS.border}`,
} as const;

export const MediaPlayerCanvasOverlay: React.FC<MediaPlayerCanvasOverlayProps> = ({
  isActive,
  videoWidth,
  videoHeight,
  onSelectRegion,
  onCoordinatesChange,
  scale,
  offsetX,
  offsetY,
  children,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [currentSelection, setCurrentSelection] = useState<SelectionBox | null>(null);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };

    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const canvasX = (clientX - offsetX) / scale;
    const canvasY = (clientY - offsetY) / scale;

    return {
      x: Math.max(0, Math.min(canvasX, videoWidth)),
      y: Math.max(0, Math.min(canvasY, videoHeight)),
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isActive) return;

    const coords = getCanvasCoordinates(e);
    setMousePosition(coords);
    onCoordinatesChange(coords.x, coords.y);

    if (isSelecting && selectionStart) {
      const width = coords.x - selectionStart.x;
      const height = coords.y - selectionStart.y;

      setCurrentSelection({
        x: Math.min(selectionStart.x, coords.x),
        y: Math.min(selectionStart.y, coords.y),
        width: Math.abs(width),
        height: Math.abs(height),
      });
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isActive) return;

    const coords = getCanvasCoordinates(e);
    setSelectionStart(coords);
    setIsSelecting(true);
    setCurrentSelection({ x: coords.x, y: coords.y, width: 0, height: 0 });
  };

  const handleMouseUp = () => {
    if (isSelecting && selectionStart && currentSelection) {
      if (currentSelection.width > 5 && currentSelection.height > 5) {
        onSelectRegion(
          currentSelection.x,
          currentSelection.y,
          currentSelection.width,
          currentSelection.height
        );
      }
    }
    setIsSelecting(false);
    setSelectionStart(null);
    setCurrentSelection(null);
  };

  const handleMouseLeave = () => {
    if (isSelecting) {
      handleMouseUp();
    }
    setMousePosition(null);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      if (!isActive) return;

      const container = containerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const displayWidth = containerRect.width;
      const displayHeight = containerRect.height;

      canvas.width = displayWidth * window.devicePixelRatio;
      canvas.height = displayHeight * window.devicePixelRatio;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      ctx.clearRect(0, 0, displayWidth, displayHeight);

      ctx.fillStyle = COLORS.overlay;
      ctx.fillRect(0, 0, displayWidth, displayHeight);

      if (currentSelection && (currentSelection.width > 0 || currentSelection.height > 0)) {
        const selX = currentSelection.x * scale + offsetX;
        const selY = currentSelection.y * scale + offsetY;
        const selWidth = currentSelection.width * scale;
        const selHeight = currentSelection.height * scale;

        ctx.fillStyle = `${COLORS.selection}40`;
        ctx.fillRect(selX, selY, selWidth, selHeight);

        ctx.strokeStyle = COLORS.border;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(selX, selY, selWidth, selHeight);
        ctx.setLineDash([]);

        ctx.fillStyle = COLORS.accent;
        const handleSize = 8;
        [
          { x: selX, y: selY },
          { x: selX + selWidth, y: selY },
          { x: selX, y: selY + selHeight },
          { x: selX + selWidth, y: selY + selHeight },
        ].forEach((handle) => {
          ctx.fillRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
        });
      }
    };

    draw();
    const handleResize = () => draw();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isActive, currentSelection, scale, offsetX, offsetY, videoWidth, videoHeight]);

  if (!isActive) {
    return null;
  }

  return (
    <div ref={containerRef} style={CONTAINER_STYLE}>
      <canvas
        ref={canvasRef}
        style={CANVAS_STYLE}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          if (touch) {
            const mouseEvent = new MouseEvent("mousedown", {
              clientX: touch.clientX,
              clientY: touch.clientY,
            });
            canvasRef.current?.dispatchEvent(mouseEvent);
          }
        }}
        onTouchMove={(e) => {
          const touch = e.touches[0];
          if (touch) {
            const mouseEvent = new MouseEvent("mousemove", {
              clientX: touch.clientX,
              clientY: touch.clientY,
            });
            canvasRef.current?.dispatchEvent(mouseEvent);
          }
        }}
        onTouchEnd={handleMouseUp}
      />
      {mousePosition && (
        <div style={COORDINATE_READOUT_STYLE}>
          X: {Math.round(mousePosition.x)}  Y: {Math.round(mousePosition.y)}
        </div>
      )}
      {currentSelection && (currentSelection.width > 0 || currentSelection.height > 0) && (
        <div
          style={{
            ...SELECTION_INFO_STYLE,
            top: currentSelection.y * scale + offsetY + 8,
            left: currentSelection.x * scale + offsetX + 8,
          }}
        >
          {Math.round(currentSelection.width)} \u00d7 {Math.round(currentSelection.height)}
        </div>
      )}
      {children}
    </div>
  );
};

export default MediaPlayerCanvasOverlay;
