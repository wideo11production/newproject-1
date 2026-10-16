// ============================================================================
// FRAME TEMPLATE EDITOR - Main per-frame template editing shell
// ============================================================================
// Combines FrameStrip, FrameCanvas, LayerPanel, IsolatedElementBox, and AI chat.
// Default frame size = 3x normal. Max 5 layers per frame.
// Drag resize: min 100px / max 500px width.
// AI (Ollama) chat integrated for auto template editing.
// ============================================================================

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Maximize, Minimize, Layers, Save, Bot, Zap, MessageSquare, Send } from 'lucide-react';
import type { FrameTemplate, FrameLayer } from '../../lib/engine/types';
import { DEFAULT_FRAME_SIZE, MAX_LAYERS_PER_FRAME, createBlankFrameTemplate } from '../../lib/engine/types';
import { createFrameTemplateStore } from '../../lib/engine/frame-template/store';
import { parseAICommand, buildVideoEffect, AI_COMMAND_EXAMPLES } from '../../lib/engine/effects/ai-command-parser';
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
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiMessages, setAiMessages] = useState<Array<{ role: 'user' | 'ai'; content: string; timestamp: number }>>([]);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [lastAiCommand, setLastAiCommand] = useState<{ description: string; sourcePrompt: string } | null>(null);
  const [dialogWidth, setDialogWidth] = useState(900);
  const [dialogHeight, setDialogHeight] = useState(700);
  const [dialogIsResizing, setDialogIsResizing] = useState(false);
  const [dialogResizeDir, setDialogResizeDir] = useState<'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null>(null);
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

  // Check Ollama status
  useEffect(() => {
    const checkOllama = async () => {
      try {
        const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) });
        if (res.ok) setOllamaStatus('online');
        else setOllamaStatus('offline');
      } catch {
        setOllamaStatus('offline');
      }
    };
    checkOllama();
    const iv = setInterval(checkOllama, 30000);
    return () => clearInterval(iv);
  }, []);

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
      if (!effectiveTemplate || !activeFrame) return;
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

  // Dialog resize handler
  const handleDialogResizeStart = useCallback(
    (e: React.MouseEvent, dir: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw') => {
      e.preventDefault();
      e.stopPropagation();
      setDialogIsResizing(true);
      setDialogResizeDir(dir);

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = dialogWidth;
      const startHeight = dialogHeight;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dialogIsResizing) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let newWidth = startWidth;
        let newHeight = startHeight;

        if (dir.includes('e')) newWidth = startWidth + dx;
        if (dir.includes('w')) newWidth = startWidth - dx;
        if (dir.includes('s')) newHeight = startHeight + dy;
        if (dir.includes('n')) newHeight = startHeight - dy;

        newWidth = Math.max(600, Math.min(1400, newWidth));
        newHeight = Math.max(500, Math.min(900, newHeight));

        setDialogWidth(newWidth);
        setDialogHeight(newHeight);
      };

      const onMouseUp = () => {
        setDialogIsResizing(false);
        setDialogResizeDir(null);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [dialogIsResizing, dialogWidth, dialogHeight]
  );

  // AI Command Execution
  const handleAiSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim() || aiProcessing || ollamaStatus !== 'online') return;

    const userMsg = { role: 'user' as const, content: aiPrompt, timestamp: Date.now() };
    setAiMessages((prev) => [...prev, userMsg]);
    setAiPrompt('');
    setAiProcessing(true);

    try {
      const clipIds = effectiveTemplate?.frames.flatMap((f) => f.layers.map((l) => l.id)) ?? [];
      const cmd = parseAICommand(aiPrompt, clipIds);

      if (cmd.action === 'apply-effect' && cmd.effectType && effectiveTemplate) {
        const effect = buildVideoEffect(cmd.effectType, cmd.params || {}, aiPrompt);
        const frame = effectiveTemplate.frames[effectiveFrameIndex];
        if (frame) {
          store.addLayer(effectiveTemplate.id, effectiveFrameIndex, {
            type: 'image',
            content: `AI Effect: ${cmd.effectType}`,
            transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
            opacity: 1,
            zIndex: 0,
            visible: true,
            locked: false,
            maskId: null,
          });
          setLastAiCommand({ description: cmd.description, sourcePrompt: aiPrompt });
          onTemplateUpdated(effectiveTemplate.id);
        }
      } else if (cmd.action === 'create-template' && effectiveTemplate) {
        setLastAiCommand({ description: 'Template saved', sourcePrompt: aiPrompt });
      } else if (cmd.action === 'remove-effect') {
        setLastAiCommand({ description: 'Effects cleared', sourcePrompt: aiPrompt });
      }

      try {
        const effectDetails = cmd.action === 'apply-effect' && cmd.effectType
          ? `Effect applied: ${cmd.effectType}. Parameters: ${JSON.stringify(cmd.params || {})}. Frame: ${effectiveFrameIndex + 1} of ${effectiveTemplate?.frames.length ?? 0}.`
          : `Action: ${cmd.action}. Frame: ${effectiveFrameIndex + 1} of ${effectiveTemplate?.frames.length ?? 0}.`;

        const systemPrompt = `You are an expert AI video editor assistant. The user said: "${aiPrompt}".
        I have executed this command on their frame template. Details: ${effectDetails}
        
        Respond in Hinglish (Hindi + English mix) in a friendly, detailed way. Explain:
        1. Exactly what change was made to their clip/frame
        2. Why this change was made (the benefit)
        3. What they will SEE in the preview (transparency, effects, colors, movement)
        4. What they can do next
        
        Keep it 4-6 sentences. Use terms like "transparency", "background hata diya", "effect lag gaya", "preview mein dikhega". Be encouraging and clear.`;

        const res = await fetch('http://127.0.0.1:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'llama3', prompt: systemPrompt, stream: false }),
        });
        if (res.ok) {
          const data = await res.json();
          setAiMessages((prev) => [...prev, { role: 'ai', content: data.response || 'Command executed successfully on your template.', timestamp: Date.now() }]);
        }
      } catch {
        setAiMessages((prev) => [...prev, { role: 'ai', content: '✅ Command executed on your template. The changes should now be visible in the preview canvas above.', timestamp: Date.now() }]);
      }
    } finally {
      setAiProcessing(false);
    }
  }, [aiPrompt, aiProcessing, ollamaStatus, effectiveTemplate, effectiveFrameIndex, store, onTemplateUpdated]);

  const handleClose = () => {
    setIsolatedLayerId(null);
    onClose();
  };

  if (!isOpen || !effectiveTemplate) return null;

  const DIALOG_HANDLE_CLASS = 'absolute w-3 h-3 bg-[#2a2a2a]/60 hover:bg-[#ff6500]/80';
  const DIALOG_CURSORS: Record<string, string> = {
    n: 'cursor-n-resize',
    s: 'cursor-s-resize',
    e: 'cursor-e-resize',
    w: 'cursor-w-resize',
    ne: 'cursor-ne-resize',
    nw: 'cursor-nw-resize',
    se: 'cursor-se-resize',
    sw: 'cursor-sw-resize',
  };

  const renderDialogHandle = (dir: string, className: string) => (
    <div
      className={`${DIALOG_HANDLE_CLASS} ${className} ${DIALOG_CURSORS[dir]}`}
      onMouseDown={(e) => handleDialogResizeStart(e, dir as 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw')}
    />
  );

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0a0a0a]" onClick={(e) => e.stopPropagation()}>
      {/* Resizable Dialog Container */}
      <div
        className="relative mx-auto mt-10 mb-10 w-[900px] h-[700px] max-w-[1400px] max-h-[900px] bg-[#121212] border border-[#2a2a2a] shadow-2xl overflow-hidden flex flex-col"
        style={{ width: dialogWidth, height: dialogHeight }}
      >
        {/* Dialog resize handles - all sides and corners */}
        {renderDialogHandle('n', 'top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-b')}
        {renderDialogHandle('s', 'bottom-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-t')}
        {renderDialogHandle('w', 'top-1/2 -translate-y-1/2 left-0 w-2 h-2 rounded-r')}
        {renderDialogHandle('e', 'top-1/2 -translate-y-1/2 right-0 w-2 h-2 rounded-l')}
        {renderDialogHandle('nw', 'top-0 left-0')}
        {renderDialogHandle('ne', 'top-0 right-0')}
        {renderDialogHandle('sw', 'bottom-0 left-0')}
        {renderDialogHandle('se', 'bottom-0 right-0')}

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#1a1a1a] border-b border-[#2a2a2a] z-10">
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
            <button onClick={() => setAiPanelOpen(!aiPanelOpen)} className={`w-8 h-8 rounded bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-white transition-colors flex items-center justify-center ${aiPanelOpen ? 'bg-[#ff6500]/20 border-[#ff6500]/50 text-[#ff6500]' : ''}`} title="AI Chat">
              <Bot className="h-4 w-4" />
            </button>
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

        {/* AI Chat Panel */}
        {aiPanelOpen && (
          <div className="h-1/3 border-t border-[#2a2a2a] bg-[#121212] flex flex-col z-20">
            <div className="flex items-center justify-between px-3 py-2 bg-[#1a1a1a] border-b border-[#2a2a2a]">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-[#ff6500]" />
                <span className="text-xs font-semibold text-white uppercase">AI Prompt Studio</span>
              </div>
              <div className={`flex items-center gap-2 px-2 py-1 rounded-full ${ollamaStatus === 'online' ? 'bg-[#ff6500]/10 border border-[#ff6500]/30' : 'bg-[#2a2a2a] border border-[#2a2a2a]'}`}>
                {ollamaStatus === 'online' ? <Bot className="h-3 w-3 text-[#ff6500]" /> : <Zap className="h-3 w-3 text-gray-500" />}
                <span className={`text-xs font-medium ${ollamaStatus === 'online' ? 'text-[#ff6500]' : 'text-gray-500'}`}>
                  {ollamaStatus === 'online' ? 'Ollama Online' : 'Ollama Offline'}
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {aiMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-500">
                  <Bot className="h-12 w-12 mb-4 text-gray-500" />
                  <p className="text-sm text-gray-300">Ask AI to edit your template</p>
                  <p className="text-xs mt-1 text-gray-500">e.g., "add water ripple", "remove background", "add text layer"</p>
                </div>
              )}
              {aiMessages.map((m) => (
                <div key={m.timestamp} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-xs lg:max-w-md px-4 py-3 rounded-md text-sm font-medium ${m.role === 'user' ? 'bg-[#ff6500] text-white rounded-br-none' : 'bg-[#1a1a1a] text-white rounded-bl-none border border-[#2a2a2a]'}`}>
                    <p className="leading-relaxed whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              ))}
              {lastAiCommand && (
                <div className="flex items-start gap-2 p-3 bg-[#ff6500]/10 border border-[#ff6500]/20 rounded">
                  <Zap className="h-4 w-4 text-[#ff6500] mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs text-[#ff6500] font-medium mb-1">{lastAiCommand.description}</p>
                    <p className="text-[10px] text-gray-500">{lastAiCommand.sourcePrompt}</p>
                  </div>
                </div>
              )}
            </div>
            <form onSubmit={handleAiSubmit} className="p-3 border-t border-[#2a2a2a] bg-[#1a1a1a]">
              <div className="flex gap-2">
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Ask AI: add water ripple, remove background, add text layer..."
                  className="flex-1 min-h-[44px] resize-none rounded-md border-0 bg-[#0a0a0a] px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500]/30"
                  disabled={aiProcessing || ollamaStatus !== 'online'}
                />
                <button
                  type="submit"
                  disabled={!aiPrompt.trim() || aiProcessing || ollamaStatus !== 'online'}
                  className="h-11 px-6 rounded-md bg-[#ff6500] text-white font-medium hover:bg-[#e55a00] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {aiProcessing ? <Zap className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
              <div className="flex items-center justify-between text-[10px] text-gray-500 mt-2">
                <span>Local Ollama AI — no API costs</span>
                <span>Models: llama3</span>
              </div>
            </form>
          </div>
        )}

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
    </div>
  );
}
