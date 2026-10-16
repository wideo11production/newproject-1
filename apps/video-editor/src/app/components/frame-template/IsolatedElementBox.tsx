// ============================================================================
// ISOLATED ELEMENT BOX - Click element → isolated full-screen editor overlay
// ============================================================================
//
// When user clicks an element on the canvas, this overlay opens showing
// only that element in a dedicated editor panel. The user can edit:
//   - Transform (position, scale, rotation)
//   - Opacity
//   - Content (text/image url)
//   - Mask assignment
//   - Visibility / lock
//
// Changes apply to the specific layer in the active frame.
// "Apply to all frames" checkbox propagates changes across every frame.
// ============================================================================

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Maximize, Minimize, RotateCcw, RotateCw, Copy, Check, ChevronLeft, Trash2 } from 'lucide-react';
import type { FrameLayer, FrameMask, FrameTemplate, Frame } from '../../lib/engine/types';

interface IsolatedElementBoxProps {
  isOpen: boolean;
  onClose: () => void;
  template: FrameTemplate | null;
  activeFrame: Frame | null;
  layerId: string | null;
  onUpdateLayer: (layerId: string, updates: Partial<import('../../lib/engine/types').FrameLayer>) => void;
  onApplyToAllFrames: (layerId: string, updates: Partial<import('../../lib/engine/types').FrameLayer>) => void;
  onRemoveLayer: (layerId: string) => void;
}

export function IsolatedElementBox({
  isOpen,
  onClose,
  template,
  activeFrame,
  layerId,
  onUpdateLayer,
  onApplyToAllFrames,
  onRemoveLayer,
}: IsolatedElementBoxProps) {
  if (!isOpen) return null;

  const layer = activeFrame?.layers.find((l) => l.id === layerId) ?? null;
  const masks = activeFrame?.masks ?? [];
  const [isMaximized, setIsMaximized] = useState(false);
  const [applyToAll, setApplyToAll] = useState(false);

  if (!layer || !template || !activeFrame) return null;

  const handleUpdate = useCallback(
    (updates: Partial<import('../../lib/engine/types').FrameLayer>) => {
      if (!layerId) return;
      onUpdateLayer(layerId, updates);
      if (applyToAll) {
        // Apply same updates to all frames' layers with matching id (or same zIndex position)
        for (const frame of template.frames) {
          const targetLayer = frame.layers.find((l) => l.id === layerId);
          if (targetLayer) {
            onApplyToAllFrames(layerId, updates);
          }
        }
      }
    },
    [layerId, onUpdateLayer, onApplyToAllFrames, template, applyToAll]
  );

  const handleTransformChange = useCallback(
    (field: keyof import('../../lib/engine/types').FrameTransform, value: number) => {
      handleUpdate({ transform: { ...layer.transform, [field]: value } });
    },
    [handleUpdate, layer.transform]
  );

  const handleOpacityChange = useCallback((value: number) => {
    handleUpdate({ opacity: value / 100 });
  }, [handleUpdate]);

  const handleContentChange = useCallback((value: string) => {
    handleUpdate({ content: value });
  }, [handleUpdate]);

  const handleMaskChange = useCallback((maskId: string | null) => {
    handleUpdate({ maskId });
  }, [handleUpdate]);

  const handleVisibilityToggle = useCallback(() => {
    handleUpdate({ visible: !layer.visible });
  }, [handleUpdate, layer.visible]);

  const handleLockToggle = useCallback(() => {
    handleUpdate({ locked: !layer.locked });
  }, [handleUpdate, layer.locked]);

  const handleDelete = useCallback(() => {
    if (!layerId) return;
    onRemoveLayer(layerId);
    onClose();
  }, [layerId, onRemoveLayer, onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-[#0a0a0a] backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#121212] border-b border-[#2a2a2a] z-10">
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#ff6500]/10 border border-[#ff6500]/30 text-[#ff6500] text-xs font-medium hover:bg-[#ff6500]/20 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Frame
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">ISOLATED ELEMENT</span>
          <span className="w-px h-4 bg-[#2a2a2a]"></span>
          <span className="text-xs font-mono text-gray-400">{layer.type.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="w-8 h-8 rounded bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-white transition-colors flex items-center justify-center"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-white transition-colors flex items-center justify-center"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className={`flex-1 overflow-hidden relative ${isMaximized ? 'h-full' : 'h-[60vh]'}`}>
        {/* Left: Element preview */}
        <div className={`absolute inset-0 flex items-center justify-center bg-[#0a0a0a] ${isMaximized ? 'inset-0' : 'right-0 w-2/3 border-l border-[#2a2a2a]'}`}>
          <div className="relative max-w-full max-h-full bg-[#1a1a1a]/50 border border-[#2a2a2a]/50 rounded-lg shadow-2xl">
            {/* Element preview representation */}
            <div
              className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 ${getLayerPreviewClass(layer)}`}
              style={{
                width: `${layer.transform.scale * 200}px`,
                height: `${layer.transform.scale * 200}px`,
                transform: `translate(-50%, -50%) rotate(${layer.transform.rotation}deg)`,
                opacity: layer.opacity,
              }}
            >
              {layer.content && (
                <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-[#ff6500] opacity-80">
                  {layer.content.length > 12 ? layer.content.slice(0, 12) + '…' : layer.content}
                </div>
              )}
            </div>

            {/* Transform overlay handles */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="flex flex-col items-center gap-1">
                <RotateCcw className="h-5 w-5 text-[#ff6500]/60" />
                <span className="text-[10px] text-gray-500">Rotate</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Controls panel */}
        <div className={`relative z-10 w-80 bg-[#1a1a1a] border-l border-[#2a2a2a] overflow-y-auto ${isMaximized ? 'inset-0 h-full w-full' : ''}`}>
          {/* Transform controls */}
          <div className="p-4 border-b border-[#2a2a2a]">
            <h3 className="text-xs font-semibold text-[#ff6500] uppercase tracking-wider mb-3">Transform</h3>
            <div className="space-y-3">
              <div>
                <label className="flex justify-between text-[10px] text-gray-500 mb-1">
                  <span>Position X</span>
                  <span className="text-gray-300">{Math.round(layer.transform.x * 100)}%</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={layer.transform.x * 100}
                  onChange={(e) => handleTransformChange('x', parseFloat(e.target.value) / 100)}
                  className="w-full accent-[#ff6500] h-1.5 bg-[#2a2a2a] rounded-lg appearance-none cursor-pointer"
                />
              </div>
              <div>
                <label className="flex justify-between text-[10px] text-gray-500 mb-1">
                  <span>Position Y</span>
                  <span className="text-gray-300">{Math.round(layer.transform.y * 100)}%</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={layer.transform.y * 100}
                  onChange={(e) => handleTransformChange('y', parseFloat(e.target.value) / 100)}
                  className="w-full accent-[#ff6500] h-1.5 bg-[#2a2a2a] rounded-lg appearance-none cursor-pointer"
                />
              </div>
              <div>
                <label className="flex justify-between text-[10px] text-gray-500 mb-1">
                  <span>Scale</span>
                  <span className="text-gray-300">{Math.round(layer.transform.scale * 100)}%</span>
                </label>
                <input
                  type="range"
                  min="10"
                  max="300"
                  value={layer.transform.scale * 100}
                  step="10"
                  onChange={(e) => handleTransformChange('scale', parseFloat(e.target.value) / 100)}
                  className="w-full accent-[#ff6500] h-1.5 bg-[#2a2a2a] rounded-lg appearance-none cursor-pointer"
                />
              </div>
              <div>
                <label className="flex justify-between text-[10px] text-gray-500 mb-1">
                  <span>Rotation</span>
                  <span className="text-gray-300">{layer.transform.rotation}°</span>
                </label>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  value={layer.transform.rotation}
                  onChange={(e) => handleTransformChange('rotation', parseFloat(e.target.value))}
                  className="w-full accent-[#ff6500] h-1.5 bg-[#2a2a2a] rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Opacity */}
          <div className="p-4 border-b border-[#2a2a2a]">
            <h3 className="text-xs font-semibold text-[#ff6500] uppercase tracking-wider mb-3">Opacity</h3>
            <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
              <span>Opacity</span>
              <span className="text-gray-300">{Math.round(layer.opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={layer.opacity * 100}
              onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
              className="w-full accent-[#ff6500] h-1.5 bg-[#2a2a2a] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Content */}
          <div className="p-4 border-b border-[#2a2a2a]">
            <h3 className="text-xs font-semibold text-[#ff6500] uppercase tracking-wider mb-3">Content</h3>
            <input
              type="text"
              value={layer.content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="Enter content..."
              className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded px-3 py-2 text-xs text-white focus:ring-2 focus:ring-[#ff6500]/50 outline-none"
            />
          </div>

          {/* Mask */}
          <div className="p-4 border-b border-[#2a2a2a]">
            <h3 className="text-xs font-semibold text-[#ff6500] uppercase tracking-wider mb-3">Mask</h3>
            <div className="flex items-center gap-2">
              <select
                value={layer.maskId ?? 'none'}
                onChange={(e) => handleMaskChange(e.target.value === 'none' ? null : e.target.value)}
                className="flex-1 bg-[#0a0a0a] border border-[#2a2a2a] rounded px-3 py-2 text-xs text-white focus:ring-2 focus:ring-[#ff6500]/50 outline-none"
              >
                <option value="none">No Mask</option>
                {masks.map((mask) => (
                  <option key={mask.id} value={mask.id}>
                    Mask {mask.points.length}pt
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Toggle switches */}
          <div className="p-4 border-b border-[#2a2a2a]">
            <h3 className="text-xs font-semibold text-[#ff6500] uppercase tracking-wider mb-3">State</h3>
            <div className="space-y-2">
              <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer select-none group">
                <span>{layer.visible ? '👁️ Visible' : '🙈 Hidden'}</span>
                <button
                  onClick={handleVisibilityToggle}
                  className="w-6 h-3 rounded-full px-1 transition-colors relative"
                  style={{ backgroundColor: layer.visible ? '#ff6500' : '#444444' }}
                >
                  <span
                    className="block w-2 h-2 rounded-full bg-white absolute"
                    style={{ left: layer.visible ? '4px' : '0px', transition: 'left 0.2s' }}
                  />
                </button>
              </label>
              <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer select-none group">
                <span>{layer.locked ? '🔒 Locked' : '🔓 Unlocked'}</span>
                <button
                  onClick={handleLockToggle}
                  className="w-6 h-3 rounded-full px-1 transition-colors relative"
                  style={{ backgroundColor: layer.locked ? '#ff6500' : '#444444' }}
                >
                  <span
                    className="block w-2 h-2 rounded-full bg-white absolute"
                    style={{ left: layer.locked ? '4px' : '0px', transition: 'left 0.2s' }}
                  />
                </button>
              </label>
            </div>
          </div>

          {/* Apply to all frames */}
          <div className="p-4 border-b border-[#2a2a2a]">
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={() => setApplyToAll(!applyToAll)}
                className="w-4 h-4 rounded bg-[#0a0a0a] border border-[#2a2a2a] text-[#ff6500] focus:ring-[#ff6500] accent-[#ff6500]"
              />
              Apply changes to all frames
            </label>
          </div>

          {/* Delete */}
          <div className="p-4">
            <button
              onClick={handleDelete}
              className="w-full py-2 rounded bg-[#ff6500]/10 border border-[#ff6500]/30 text-[#ff6500] text-xs font-medium hover:bg-[#ff6500]/20 transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Element
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getLayerPreviewClass(layer: import('../../lib/engine/types').FrameLayer): string {
  const base = 'relative rounded-lg border-2 border-white/20';
  if (layer.type === 'image') return `${base} bg-amber-500/20`;
  if (layer.type === 'text') return `${base} bg-sky-500/20`;
  if (layer.type === 'shape') return `${base} bg-emerald-500/20`;
  if (layer.type === 'video') return `${base} bg-rose-500/20`;
  if (layer.type === 'mask') return `${base} bg-violet-500/20`;
  return base;
}
