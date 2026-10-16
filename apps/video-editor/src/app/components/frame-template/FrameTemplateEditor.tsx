// ============================================================================
// FRAME TEMPLATE EDITOR - Main per-frame template editing shell
// ============================================================================
// Combines FrameStrip, FrameCanvas, LayerPanel, IsolatedElementBox.
// Default frame size = 3x normal. Max 5 layers per frame.
// Drag resize: min 100px / max 500px width.
// ============================================================================

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Maximize, Minimize, Layers, Save } from 'lucide-react';
import type { FrameTemplate, FrameLayer } from '../../lib/engine/types';
import { DEFAULT_FRAME_SIZE, MAX_LAYERS_PER_FRAME, createBlankFrameTemplate } from '../../lib/engine/types';
import { createFrameTemplateStore } from '../../lib/engine/frame-template/store';
import { FrameStrip } from './FrameStrip';
import { FrameCanvas } from './FrameCanvas';
import { LayerPanel } from './LayerPanel';
import { IsolatedElementBox } from './IsolatedElementBox';

interface FrameTemplateEditorProps {
  isOpen: boolean;
  onClose: () => void;
  clipId: string | null;
  clipName: string;
  clipDurationSeconds: number;
  fps: number;
  template?: FrameTemplate | null;
  activeFrameIndex?: number;
  onTemplateCreated: (templateId: string) => void;
  onTemplateUpdated: (templateId: string) => void;
  onTemplateChange?: (template: FrameTemplate | null, frameIndex: number) => void;
}

export function FrameTemplateEditor({
  isOpen,
  onClose,
  clipId,
  clipName,
  clipDurationSeconds,
  fps,
  template: parentTemplate,
  activeFrameIndex: parentActiveFrameIndex,
  onTemplateCreated,
  onTemplateUpdated,
  onTemplateChange,
}: FrameTemplateEditorProps) {
  const [template, setTemplate] = useState<FrameTemplate | null>(null);
  const [activeFrameIndex, setActiveFrameIndexState] = useState(0);
  const [isolatedLayerId, setIsolatedLayerId] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const storeRef = useRef<ReturnType<typeof createFrameTemplateStore> | null>(null);

  if (!storeRef.current) storeRef.current = createFrameTemplateStore();
  const store = storeRef.current;

  // Initialize template when clip changes
  useEffect(() => {
    if (!clipId) {
      setTemplate(null);
      setIsolatedLayerId(null);
      return;
    }

    const existing = store.getAllTemplates().find((t) => t.sourceClipId === clipId);
    if (existing) {
      setTemplate(existing);
      store.setActiveTemplate(existing.id);
      setActiveFrameIndexState(0);
      setIsolatedLayerId(null);
    } else {
      const blank = createBlankFrameTemplate(`Template: ${clipName}`, clipDurationSeconds, fps, clipId);
      const id = store.addTemplate(blank);
      const newTemplate = store.getTemplate(id);
      setTemplate(newTemplate ?? null);
      store.setActiveTemplate(id);
      setActiveFrameIndexState(0);
      setIsolatedLayerId(null);
      onTemplateCreated(id);
    }
  }, [clipId, clipName, clipDurationSeconds, fps, store, onTemplateCreated]);

  // Use parent-controlled template if provided, otherwise internal state
  const effectiveTemplate = parentTemplate ?? template;
  const effectiveFrameIndex = parentActiveFrameIndex !== undefined ? parentActiveFrameIndex : activeFrameIndex;

  // Sync template changes back to parent for compositor
  useEffect(() => {
    if (onTemplateChange) {
      onTemplateChange(effectiveTemplate, effectiveFrameIndex);
    }
  }, [effectiveTemplate, effectiveFrameIndex, onTemplateChange]);

  const activeFrame = effectiveTemplate?.frames[effectiveFrameIndex] ?? null;

  const handleFrameSelect = useCallback((frameIndex: number) => {
    setActiveFrameIndexState(frameIndex);
    setIsolatedLayerId(null);
  }, []);

  const handleLayerClick = useCallback((layerId: string) => {
    setIsolatedLayerId(layerId);
  }, []);

  const handleLayerDrag = useCallback(
    (layerId: string, dx: number, dy: number) => {
      if (!effectiveTemplate || !activeFrame) return;
      const layer = activeFrame.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const newX = Math.max(0, Math.min(1, layer.transform.x + dx));
      const newY = Math.max(0, Math.min(1, layer.transform.y + dy));
      store.updateLayer(effectiveTemplate.id, effectiveFrameIndex, layerId, {
        transform: { ...layer.transform, x: newX, y: newY },
      });
      onTemplateUpdated(effectiveTemplate.id);
    },
    [effectiveTemplate, effectiveFrameIndex, store, onTemplateUpdated]
  );

  const handleAddLayer = useCallback(
    (type: string) => {
      if (!effectiveTemplate) return;
      store.addLayer(effectiveTemplate.id, effectiveFrameIndex, {
        type: type as any,
        content: '',
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
        opacity: 1,
        zIndex: 0,
        visible: true,
        locked: false,
        maskId: null,
      });
      onTemplateUpdated(effectiveTemplate.id);
    },
    [effectiveTemplate, effectiveFrameIndex, store, onTemplateUpdated]
  );

  const handleRemoveLayer = useCallback((layerId: string) => {
    if (!effectiveTemplate || !activeFrame) return;
    store.removeLayer(effectiveTemplate.id, effectiveFrameIndex, layerId);
    setIsolatedLayerId(null);
    onTemplateUpdated(effectiveTemplate.id);
  }, [effectiveTemplate, effectiveFrameIndex, store, onTemplateUpdated]);

  const handleUpdateLayer = useCallback(
    (layerId: string, updates: Partial<FrameLayer>) => {
      if (!effectiveTemplate || !activeFrame) return;
      store.updateLayer(effectiveTemplate.id, effectiveFrameIndex, layerId, updates);
      onTemplateUpdated(effectiveTemplate.id);
    },
    [effectiveTemplate, effectiveFrameIndex, store, onTemplateUpdated]
  );

  const handleApplyToAllFrames = useCallback(
    (layerId: string, updates: Partial<FrameLayer>) => {
      if (!effectiveTemplate) return;
      for (const frame of effectiveTemplate.frames) {
        const targetLayer = frame.layers.find((l) => l.id === layerId);
        if (targetLayer) {
          store.updateLayer(effectiveTemplate.id, frame.index, layerId, updates);
        }
      }
      onTemplateUpdated(effectiveTemplate.id);
    },
    [effectiveTemplate, store, onTemplateUpdated]
  );

  const handleRemoveLayerGlobal = useCallback((layerId: string) => {
    if (!effectiveTemplate) return;
    for (const frame of effectiveTemplate.frames) {
      store.removeLayer(effectiveTemplate.id, frame.index, layerId);
    }
    setIsolatedLayerId(null);
    onTemplateUpdated(effectiveTemplate.id);
  }, [effectiveTemplate, store, onTemplateUpdated]);

  const handleToggleSizeLock = useCallback(() => {
    if (!effectiveTemplate) return;
    store.toggleSizeLock(effectiveTemplate.id);
    onTemplateUpdated(effectiveTemplate.id);
  }, [effectiveTemplate, store, onTemplateUpdated]);

  const handleResize = useCallback((width: number, height: number) => {
    if (!effectiveTemplate) return;
    store.resizeFrameSize(effectiveTemplate.id, { width, height });
    onTemplateUpdated(effectiveTemplate.id);
  }, [effectiveTemplate, store, onTemplateUpdated]);

  const handleClose = () => {
    setIsolatedLayerId(null);
    onClose();
  };

  if (!isOpen || !effectiveTemplate) return null;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0a0a0a]" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-4 py-3 bg-[#121212] border-b border-[#2a2a2a] z-10">
        <div className="flex items-center gap-3">
          <button onClick={handleClose} className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-white transition-colors">
            <ChevronLeft className="h-4 w-4" />
            <span className="text-xs font-medium">Back to Editor</span>
          </button>
          <div className="h-6 w-px bg-[#2a2a2a]" />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-[#ff6500]/20 flex items-center justify-center">
              <Layers className="h-4 w-4 text-[#ff6500]" />
            </div>
            <div>
              <span className="text-xs font-semibold text-white">{effectiveTemplate.name}</span>
              <span className="text-[10px] text-gray-500">Per-Frame Template</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsMaximized(!isMaximized)} className="w-8 h-8 rounded bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-white transition-colors flex items-center justify-center" title={isMaximized ? 'Restore' : 'Maximize'}>
            {isMaximized ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
          <button onClick={() => {
            const json = store.exportTemplate(effectiveTemplate.id);
            if (json) {
              const blob = new Blob([json], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${effectiveTemplate.name.replace(/\s+/g, '_')}.wido-template`;
              a.click();
              URL.revokeObjectURL(url);
            }
          }} className="w-8 h-8 rounded bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-white transition-colors flex items-center justify-center" title="Export Template">
            <Save className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isolatedLayerId && (
        <IsolatedElementBox
          isOpen={true}
          onClose={() => setIsolatedLayerId(null)}
          template={effectiveTemplate}
          activeFrame={activeFrame}
          layerId={isolatedLayerId}
          onUpdateLayer={handleUpdateLayer}
          onApplyToAllFrames={handleApplyToAllFrames}
          onRemoveLayer={handleRemoveLayerGlobal}
        />
      )}

      <div className={`flex-1 flex ${isMaximized ? 'h-full' : 'h-[75vh]'}`}>
        <FrameStrip
          template={effectiveTemplate}
          onFrameSelect={handleFrameSelect}
          onResize={handleResize}
          onToggleSizeLock={handleToggleSizeLock}
          store={store}
        />

        <div className="flex-1 flex flex-col bg-[#0a0a0a]">
          <div className={`flex-1 relative bg-[#0a0a0a] ${isMaximized ? 'h-full' : 'h-2/3'}`}>
            <FrameCanvas
              template={effectiveTemplate}
              activeFrame={activeFrame}
              onLayerClick={handleLayerClick}
              onLayerDrag={handleLayerDrag}
            />
          </div>

          <LayerPanel
            activeFrame={activeFrame}
            onAddLayer={handleAddLayer}
            onRemoveLayer={handleRemoveLayer}
            onUpdateLayer={handleUpdateLayer}
          />
        </div>
      </div>

      <div className="px-4 py-2 bg-[#121212] border-t border-[#2a2a2a]">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <span>Frame Size: {effectiveTemplate.frameSize.width}×{effectiveTemplate.frameSize.height}</span>
            <span className="w-px h-3 bg-[#2a2a2a]" />
            <span>Layers: {activeFrame?.layers.length ?? 0}/{MAX_LAYERS_PER_FRAME}</span>
            <span className="w-px h-3 bg-[#2a2a2a]" />
            <span>Size Lock: {effectiveTemplate.sizeLocked ? 'ON' : 'OFF'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#ff6500] font-mono">3× Default Size</span>
            <span className="w-px h-3 bg-[#2a2a2a]" />
            <span>FPS: {fps}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
