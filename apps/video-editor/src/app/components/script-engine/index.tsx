// Script Engine - interactive script toolkit for the video editor
//
// YE COMPONENT KYA HAI:
// Purane standalone `apps/editor` ka content yahan migrate hua hai, LEKIN ab
// wo SCRIPT ENGINE ke roop me kaam karta hai - video editor ki existing
// timeline/preview ke SAATH side-by-side.
//
// MIGRATION MAP (editor -> script-engine):
//   editor Header (Export/Settings)  -> [export] aur [settings] buttons (KAAM KARTE HAIN)
//   editor Tools (Cut/Split/Crop/Rotate) -> tool selector (state se bound)
//   editor Properties (Name/Duration/X/Y/Scale/Rotation) -> scenes + transform panels
//   editor Canvas placeholder -> script preview / document preview
//   editor Timeline placeholders -> SCRIPT SCENES list (real data)
//
// SAB CONTROLS LIVE HAIN - pehle koi bhi button/input dead tha.
// Naya functionality jo add hua: text layout, script compile/export, scene CRUD.
//
// Hinglish comments: har block ka arth
'use client';

import { useCallback, useMemo, useState } from 'react';
import { Button } from '@wideo11/ui/button';
import { Input } from '@wideo11/ui/input';
import { Badge } from '@wideo11/ui/badge';
import {
  Scissors,
  SplitSquareHorizontal,
  Crop,
  RotateCw,
  Plus,
  Trash2,
  FileText,
  Settings2,
  Download,
  Type as TypeIcon,
  Move,
  Layers,
  Film,
  Clock,
} from 'lucide-react';

import {
  createInitialState,
  compileScript,
  formatDuration,
  totalDuration,
  nextId,
  type ScriptState,
  type Scene,
  type EditorTool,
  type PanelTab,
  type CompiledScript,
} from './types';

/** Tools list - editor app se migrate hua */
const TOOLS: { id: EditorTool; label: string; icon: typeof Scissors }[] = [
  { id: 'cut', label: 'Cut', icon: Scissors },
  { id: 'split', label: 'Split', icon: SplitSquareHorizontal },
  { id: 'crop', label: 'Crop', icon: Crop },
  { id: 'rotate', label: 'Rotate', icon: RotateCw },
];

const TABS: { id: PanelTab; label: string; icon: typeof Layers }[] = [
  { id: 'scenes', label: 'Scenes', icon: Film },
  { id: 'text', label: 'Text', icon: TypeIcon },
  { id: 'transform', label: 'Transform', icon: Move },
  { id: 'documents', label: 'Documents', icon: FileText },
];

export default function ScriptEngine() {
  // Poora state ek jagah - UNIFIED (ye requirement tha)
  const [state, setState] = useState<ScriptState>(() => createInitialState());
  // Compiled output (export ke baad dikhta hai)
  const [compiled, setCompiled] = useState<CompiledScript | null>(null);

  // ---- State update helper (immutably merge karta hai) ----
  const patch = useCallback((partial: Partial<ScriptState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  // ---- Scene operations (PURANE editor me ye functionality NAHI thi) ----

  const addScene = useCallback(() => {
    setState((prev) => {
      const number = prev.scenes.length + 1;
      const scene: Scene = {
        id: nextId('scene'),
        number,
        heading: `INT. LOCATION ${number} - DAY`,
        location: 'INT',
        dialogue: '',
        shot: '',
        duration: 5,
      };
      return { ...prev, scenes: [...prev.scenes, scene] };
    });
  }, []);

  const updateScene = useCallback((id: string, partial: Partial<Scene>) => {
    setState((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) => (s.id === id ? { ...s, ...partial } : s)),
    }));
  }, []);

  const removeScene = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      scenes: prev.scenes
        .filter((s) => s.id !== id)
        // Numbers dobara renumber karo taaki gap na rahe
        .map((s, i) => ({ ...s, number: i + 1 })),
      // Is scene ki dialogue bhi delete (orphaned na rahe)
      dialogue: prev.dialogue.filter((d) => d.sceneId !== id),
    }));
  }, []);

  // ---- Text layout operations ----

  const addTextOverlay = useCallback(() => {
    setState((prev) => ({
      ...prev,
      textLayouts: [
        ...prev.textLayouts,
        {
          id: nextId('text'),
          content: 'New text',
          positionY: 80,
          fontSize: 32,
          fontWeight: 600,
          color: '#ffffff',
          background: 'transparent',
          align: 'center',
          startTime: 0,
          endTime: 3,
        },
      ],
    }));
  }, []);

  const updateTextOverlay = useCallback(
    (id: string, partial: Partial<ScriptState['textLayouts'][number]>) => {
      setState((prev) => ({
        ...prev,
        textLayouts: prev.textLayouts.map((t) => (t.id === id ? { ...t, ...partial } : t)),
      }));
    },
    []
  );

  const removeTextOverlay = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      textLayouts: prev.textLayouts.filter((t) => t.id !== id),
    }));
  }, []);

  // ---- Compile / export (PURANE editor ke dead "Export" button ka replacement) ----

  const handleExport = useCallback(() => {
    const result = compileScript(state);
    setCompiled(result);
    patch({ documentsOpen: true, tab: 'documents' });
  }, [state, patch]);

  /** Compiled script ko file download karo */
  const downloadScript = useCallback(() => {
    if (!compiled) return;
    // Blob se plain-text file generate karo
    const blob = new Blob([compiled.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'script'}.txt`;
    a.click();
    // Cleanup - memory leak na ho
    URL.revokeObjectURL(url);
  }, [compiled, state.title]);

  const duration = useMemo(() => totalDuration(state.scenes), [state.scenes]);

  return (
    <div className="flex h-full flex-col bg-grafana-bg text-grafana-text">
      {/* ===== Header (editor app se migrated) ===== */}
      <header className="flex items-center justify-between border-b border-grafana-border bg-grafana-panel px-4 py-2.5">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-grafana-primary" />
          <div>
            <h2 className="text-base font-semibold tracking-tight">Script Engine</h2>
            <p className="text-[11px] text-grafana-textMuted">
              {state.scenes.length} scene{state.scenes.length === 1 ? '' : 's'} •{' '}
              {formatDuration(duration)} total
            </p>
          </div>
        </div>

        {/* Export + Settings buttons - pehle DEAD the, ab KAAM KARTE HAIN */}
        <div className="flex items-center gap-2">
          <Button
            onClick={handleExport}
            className="h-8 rounded-md bg-grafana-primary px-3 text-xs font-medium text-white transition-colors hover:bg-grafana-primary/85"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export
          </Button>
          <Button
            onClick={() => patch({ settingsOpen: !state.settingsOpen })}
            className="h-8 rounded-md border border-grafana-border bg-grafana-panel px-3 text-xs font-medium text-grafana-textMuted transition-colors hover:bg-grafana-panelHover"
            aria-expanded={state.settingsOpen}
          >
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            Settings
          </Button>
        </div>
      </header>

      {/* ===== Settings drawer (button se toggle hota hai) ===== */}
      {state.settingsOpen && (
        <div className="border-b border-grafana-border bg-grafana-panel/50 px-4 py-3">
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-grafana-textMuted">
                Project title
              </label>
              <Input
                value={state.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="Untitled Project"
                className="h-9 border-grafana-border bg-grafana-bg text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-grafana-textMuted">
                  Default scene duration (s)
                </label>
                <Input
                  type="number"
                  min={0}
                  defaultValue={5}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    // Saari existing scenes ka duration update karo (unified state)
                    if (!Number.isNaN(v)) {
                      setState((prev) => ({
                        ...prev,
                        scenes: prev.scenes.map((s) => ({ ...s, duration: v })),
                      }));
                    }
                  }}
                  className="h-9 border-grafana-border bg-grafana-bg text-sm"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-grafana-textMuted">
                  Total scenes
                </label>
                <div className="flex h-9 items-center rounded-md border border-grafana-border bg-grafana-bg px-3 text-sm text-grafana-textMuted">
                  {state.scenes.length}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Tools (editor app se migrated, ab state-bound) ===== */}
      <div className="flex items-center gap-1 border-b border-grafana-border px-4 py-2">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const active = state.tool === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => patch({ tool: tool.id })}
              aria-pressed={active}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-grafana-primary text-white'
                  : 'text-grafana-textMuted hover:bg-grafana-panelHover hover:text-grafana-text'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tool.label}
            </button>
          );
        })}
        <Badge className="ml-auto border-grafana-border bg-grafana-panel text-[10px] text-grafana-textMuted">
          {state.tool} selected
        </Badge>
      </div>

      {/* ===== Panel tabs ===== */}
      <div className="flex items-center gap-1 border-b border-grafana-border px-4">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = state.tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => patch({ tab: t.id })}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                active
                  ? 'border-grafana-primary text-grafana-primary'
                  : 'border-transparent text-grafana-textMuted hover:text-grafana-text'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ===== Panel content ===== */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* ---------- SCENES ---------- */}
        {state.tab === 'scenes' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-grafana-textMuted">
                Scene list
              </h3>
              <Button
                onClick={addScene}
                className="h-7 rounded-md bg-grafana-primary px-2.5 text-xs text-white hover:bg-grafana-primary/85"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add scene
              </Button>
            </div>

            {state.scenes.length === 0 ? (
              <p className="rounded-md border border-grafana-border bg-grafana-panel/40 p-4 text-center text-xs text-grafana-textMuted">
                No scenes yet. Click “Add scene” to start scripting.
              </p>
            ) : (
              state.scenes.map((scene) => (
                <div
                  key={scene.id}
                  className="space-y-2 rounded-lg border border-grafana-border bg-grafana-panel/60 p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-grafana-primary/20 text-xs font-bold text-grafana-primary">
                      {scene.number}
                    </span>
                    <Input
                      value={scene.heading}
                      onChange={(e) => updateScene(scene.id, { heading: e.target.value })}
                      placeholder="Scene heading"
                      className="h-8 flex-1 border-grafana-border bg-grafana-bg text-xs font-medium"
                    />
                    <button
                      onClick={() => removeScene(scene.id)}
                      aria-label={`Delete scene ${scene.number}`}
                      className="rounded p-1.5 text-grafana-textMuted transition-colors hover:bg-grafana-danger/20 hover:text-grafana-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      value={scene.location}
                      onChange={(e) => updateScene(scene.id, { location: e.target.value })}
                      placeholder="INT/EXT"
                      className="h-8 border-grafana-border bg-grafana-bg text-xs"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={scene.duration}
                      onChange={(e) =>
                        updateScene(scene.id, { duration: Number(e.target.value) || 0 })
                      }
                      placeholder="Duration"
                      className="h-8 border-grafana-border bg-grafana-bg text-xs"
                    />
                    <div className="flex items-center gap-1 rounded-md border border-grafana-border bg-grafana-bg px-2 text-[11px] text-grafana-textMuted">
                      <Clock className="h-3 w-3" />
                      {formatDuration(scene.duration)}
                    </div>
                  </div>

                  <Input
                    value={scene.shot}
                    onChange={(e) => updateScene(scene.id, { shot: e.target.value })}
                    placeholder="Shot description (what the camera sees)"
                    className="h-8 border-grafana-border bg-grafana-bg text-xs"
                  />

                  <textarea
                    value={scene.dialogue}
                    onChange={(e) => updateScene(scene.id, { dialogue: e.target.value })}
                    placeholder="Dialogue / narration"
                    rows={2}
                    className="w-full rounded-md border border-grafana-border bg-grafana-bg p-2 text-xs text-grafana-text placeholder:text-grafana-textMuted focus:border-grafana-primary focus:outline-none"
                  />
                </div>
              ))
            )}
          </div>
        )}

        {/* ---------- TEXT LAYOUT ---------- */}
        {state.tab === 'text' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-grafana-textMuted">
                Text overlays
              </h3>
              <Button
                onClick={addTextOverlay}
                className="h-7 rounded-md bg-grafana-primary px-2.5 text-xs text-white hover:bg-grafana-primary/85"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add text
              </Button>
            </div>

            {state.textLayouts.length === 0 ? (
              <p className="rounded-md border border-grafana-border bg-grafana-panel/40 p-4 text-center text-xs text-grafana-textMuted">
                No text overlays. Add one to place titles or subtitles on the video.
              </p>
            ) : (
              state.textLayouts.map((t) => (
                <div
                  key={t.id}
                  className="space-y-2 rounded-lg border border-grafana-border bg-grafana-panel/60 p-3"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={t.content}
                      onChange={(e) => updateTextOverlay(t.id, { content: e.target.value })}
                      placeholder="Overlay text"
                      className="h-8 flex-1 border-grafana-border bg-grafana-bg text-xs"
                    />
                    <button
                      onClick={() => removeTextOverlay(t.id)}
                      aria-label="Delete text overlay"
                      className="rounded p-1.5 text-grafana-textMuted transition-colors hover:bg-grafana-danger/20 hover:text-grafana-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={t.positionY}
                      onChange={(e) =>
                        updateTextOverlay(t.id, { positionY: Number(e.target.value) || 0 })
                      }
                      title="Vertical position %"
                      placeholder="Y %"
                      className="h-8 border-grafana-border bg-grafana-bg text-xs"
                    />
                    <Input
                      type="number"
                      min={8}
                      max={200}
                      value={t.fontSize}
                      onChange={(e) =>
                        updateTextOverlay(t.id, { fontSize: Number(e.target.value) || 16 })
                      }
                      title="Font size px"
                      placeholder="Size"
                      className="h-8 border-grafana-border bg-grafana-bg text-xs"
                    />
                    <input
                      type="color"
                      value={t.color}
                      onChange={(e) => updateTextOverlay(t.id, { color: e.target.value })}
                      title="Text colour"
                      className="h-8 w-10 cursor-pointer rounded border border-grafana-border bg-grafana-bg"
                    />
                    <select
                      value={t.align}
                      onChange={(e) =>
                        updateTextOverlay(t.id, { align: e.target.value as 'left' | 'center' | 'right' })
                      }
                      className="h-8 rounded-md border border-grafana-border bg-grafana-bg px-2 text-xs text-grafana-text"
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      min={0}
                      value={t.startTime}
                      onChange={(e) =>
                        updateTextOverlay(t.id, { startTime: Number(e.target.value) || 0 })
                      }
                      placeholder="Start (s)"
                      className="h-8 border-grafana-border bg-grafana-bg text-xs"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={t.endTime}
                      onChange={(e) =>
                        updateTextOverlay(t.id, { endTime: Number(e.target.value) || 0 })
                      }
                      placeholder="End (s)"
                      className="h-8 border-grafana-border bg-grafana-bg text-xs"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ---------- TRANSFORM (editor ke Properties panel se migrated) ---------- */}
        {state.tab === 'transform' && (
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-grafana-textMuted">
              Clip transform
            </h3>

            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { key: 'positionX', label: 'Position X' },
                  { key: 'positionY', label: 'Position Y' },
                  { key: 'scale', label: 'Scale (%)' },
                  { key: 'rotation', label: 'Rotation (deg)' },
                ] as const
              ).map((field) => (
                <div key={field.key}>
                  <label className="mb-1.5 block text-xs font-medium text-grafana-textMuted">
                    {field.label}
                  </label>
                  <Input
                    type="number"
                    value={state.transform[field.key]}
                    onChange={(e) =>
                      setState((prev) => ({
                        ...prev,
                        transform: {
                          ...prev.transform,
                          [field.key]: Number(e.target.value) || 0,
                        },
                      }))
                    }
                    className="h-9 border-grafana-border bg-grafana-bg text-sm"
                  />
                </div>
              ))}
            </div>

            {/* Live preview - transform state ka visual feedback */}
            <div className="flex h-32 items-center justify-center rounded-lg border border-grafana-border bg-grafana-bg">
              <div
                className="h-14 w-24 rounded bg-grafana-primary/30 ring-1 ring-grafana-primary/50"
                style={{
                  transform: `translate(${state.transform.positionX}px, ${state.transform.positionY}px) scale(${state.transform.scale / 100}) rotate(${state.transform.rotation}deg)`,
                  transition: 'transform 150ms ease-out',
                }}
              />
            </div>

            <Button
              onClick={() =>
                setState((prev) => ({
                  ...prev,
                  transform: { positionX: 0, positionY: 0, scale: 100, rotation: 0 },
                }))
              }
              className="h-8 w-full rounded-md border border-grafana-border bg-grafana-panel text-xs text-grafana-textMuted hover:bg-grafana-panelHover"
            >
              Reset transform
            </Button>
          </div>
        )}

        {/* ---------- DOCUMENTS (compiled output) ---------- */}
        {state.tab === 'documents' && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-grafana-textMuted">
              Compiled script
            </h3>

            {!compiled ? (
              <p className="rounded-md border border-grafana-border bg-grafana-panel/40 p-4 text-center text-xs text-grafana-textMuted">
                Nothing compiled yet. Click “Export” in the header to build the
                script document.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Scenes', value: compiled.totalScenes },
                    { label: 'Duration', value: formatDuration(compiled.totalDuration) },
                    { label: 'Lines', value: compiled.totalLines },
                    { label: 'Words', value: compiled.wordCount },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-md border border-grafana-border bg-grafana-panel/60 p-2 text-center"
                    >
                      <p className="font-mono text-sm font-bold text-grafana-text">{s.value}</p>
                      <p className="text-[10px] text-grafana-textMuted">{s.label}</p>
                    </div>
                  ))}
                </div>

                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-grafana-border bg-grafana-bg p-3 font-mono text-[11px] leading-relaxed text-grafana-text">
                  {compiled.text}
                </pre>

                <Button
                  onClick={downloadScript}
                  className="h-8 w-full rounded-md bg-grafana-primary text-xs text-white hover:bg-grafana-primary/85"
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download .txt
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
