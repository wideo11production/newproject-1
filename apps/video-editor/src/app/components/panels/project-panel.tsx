'use client';

// ============================================================================
// Project panel
// ============================================================================
//
// New, open, save, autosave, recent projects, and the settings that change
// what the preview and the export actually produce.
//
// ---- WHERE A PROJECT LIVES ----
//
// The arrangement goes to localStorage, one key per project. The media BYTES
// go to IndexedDB, because a single video is far past what localStorage will
// take and keeping a 5MB string quota for a video editor guarantees a save
// failure at exactly the wrong moment. `lib/engine/project-store.ts` owns both
// halves and reports which of them failed rather than pretending the save
// worked.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FolderOpen,
  Save,
  FilePlus2,
  Download,
  Upload,
  Trash2,
  Clock,
  HardDrive,
  Settings2,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { PanelSection, Button, Field, Select, NumberInput, ColorInput, TextInput, EmptyState } from './panel-kit';
import {
  listProjects,
  loadProject,
  saveProject,
  deleteProject,
  parseProjectFile,
  serialiseProjectFile,
  type SaveResult,
} from '../../lib/engine/project-store';
import type { ProjectDoc, ProjectSettings, ProjectSummary, TimelineTrack } from '../../lib/engine/types';
import type { MediaItem } from '../../lib/engine/media-store';

export interface ProjectPanelProps {
  doc: ProjectDoc;
  media: MediaItem[];
  dirty: boolean;
  lastSavedAt: number | null;
  autosave: boolean;
  onSettings: (patch: Partial<ProjectSettings>) => void;
  onNew: () => void;
  onOpen: (id: string) => Promise<void>;
  onSave: () => Promise<SaveResult>;
  onImported: (file: File) => Promise<void>;
}

const RESOLUTIONS: Array<{ value: string; label: string }> = [
  { value: '1920x1080', label: 'Full HD 1920×1080' },
  { value: '1280x720', label: 'HD 1280×720' },
  { value: '1080x1920', label: 'Vertical 1080×1920' },
  { value: '1080x1080', label: 'Square 1080×1080' },
  { value: '720x1280', label: 'Vertical 720×1280' },
  { value: '854x480', label: 'FWVGA 854×480' },
  { value: '2560x1440', label: 'QHD 2560×1440' },
  { value: '3840x2160', label: 'UHD 3840×2160' },
];

export function ProjectPanel({
  doc,
  media,
  dirty,
  lastSavedAt,
  autosave,
  onSettings,
  onNew,
  onOpen,
  onSave,
  onImported,
}: ProjectPanelProps) {
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const [status, setStatus] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => setRecent(listProjects()), []);

  useEffect(() => {
    refresh();
  }, [refresh, lastSavedAt]);

  const resolution = `${doc.settings.width}x${doc.settings.height}`;

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await onSave();
      if (!res.saved) setStatus({ kind: 'err', text: res.error ?? 'Could not save' });
      else if (res.mediaFailed > 0)
        setStatus({
          kind: 'warn',
          text: `Arrangement saved. ${res.mediaFailed} file(s) could not be stored — those clips will reopen without their media.`,
        });
      else setStatus({ kind: 'ok', text: `Saved "${doc.settings.name}" with ${res.mediaSaved} media file(s).` });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const download = async () => {
    setBusy(true);
    try {
      const { json, embedded, omitted } = await serialiseProjectFile(doc, media, true);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.settings.name.replace(/[^\w-]+/g, '_') || 'project'}.wideo11.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setStatus({
        kind: omitted ? 'warn' : 'ok',
        text: omitted
          ? `Downloaded the arrangement. ${omitted} media file(s) were too large to embed — re-import them after opening.`
          : `Downloaded with ${embedded} media file(s) embedded.`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <PanelSection
        title="Project"
        action={
          <span className={`text-[10px] ${dirty ? 'text-amber-400' : 'text-fg-muted'}`}>
            {dirty ? 'unsaved' : lastSavedAt ? `saved ${new Date(lastSavedAt).toLocaleTimeString()}` : 'never saved'}
          </span>
        }
      >
        <div className="space-y-2">
          <Field label="Name">
            <TextInput value={doc.settings.name} ariaLabel="Project name" onChange={(v) => onSettings({ name: v })} />
          </Field>
          <div className="grid grid-cols-2 gap-1.5">
            <Button onClick={() => void save()} disabled={busy}>
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              Save
            </Button>
            <Button variant="outline" onClick={onNew}>
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
              New
            </Button>
            <Button variant="outline" onClick={() => void download()} disabled={busy}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Download
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              Open file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              aria-label="Open a project file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                void f
                  .text()
                  .then(parseProjectFile)
                  .then((parsed) => {
                    if (!parsed) {
                      setStatus({ kind: 'err', text: 'That file is not a Wideo11 project.' });
                      return;
                    }
                    if (parsed.media.length === 0)
                      setStatus({
                        kind: 'warn',
                        text: `Opened the arrangement. It carries no embedded media — re-import the files it references.`,
                      });
                    return onImported(f);
                  })
                  .catch((e) => setStatus({ kind: 'err', text: `Could not read the file: ${String(e)}` }));
              }}
            />
          </div>
          {autosave && (
            <p className="flex items-start gap-1.5 text-[10px] leading-snug text-fg-muted">
              <Clock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              Autosave runs every 30 seconds and on any change to the track list.
            </p>
          )}
          {status && (
            <p
              className={[
                'flex items-start gap-1.5 rounded border p-2 text-[10px] leading-snug',
                status.kind === 'ok'
                  ? 'border-emerald-900 text-emerald-300'
                  : status.kind === 'warn'
                    ? 'border-amber-900 text-amber-300'
                    : 'border-rose-900 text-rose-300',
              ].join(' ')}
            >
              {status.kind === 'ok' ? (
                <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              )}
              {status.text}
            </p>
          )}
        </div>
      </PanelSection>

      <PanelSection title="Recent" hint="Stored in this browser. Opening one restores its media from IndexedDB.">
        {recent.length === 0 ? (
          <EmptyState title="No saved projects yet" body="Save once and it will be listed here with its date and length." />
        ) : (
          <ul className="space-y-1">
            {recent.map((p) => (
              <li key={p.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void onOpen(p.id)}
                  className="min-w-0 flex-1 rounded border border-edge px-2 py-1 text-left hover:border-edge-strong hover:bg-surface-overlay/40"
                >
                  <span className="block truncate text-[11px] text-fg">{p.name}</span>
                  <span className="block font-mono text-[9px] text-fg-muted">
                    {new Date(p.updatedAt).toLocaleString()} · {p.clipCount} clips
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void deleteProject(p.id).then(refresh);
                  }}
                  aria-label={`Delete ${p.name}`}
                  title={`Delete ${p.name} and its stored media`}
                  className="shrink-0 rounded p-1 text-fg-muted hover:text-rose-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      <PanelSection title="Settings" hint="These change the preview, the timecode and the export together — they are not cosmetic.">
        <div className="space-y-2">
          <Field label="Resolution">
            <Select
              value={resolution}
              ariaLabel="Project resolution"
              options={RESOLUTIONS}
              onChange={(v) => {
                const [w, h] = v.split('x').map(Number);
                if (w && h) onSettings({ width: w, height: h });
              }}
            />
          </Field>
          <Field label="Frame rate" hint={`${doc.settings.fps} fps`}>
            <Select
              value={String(doc.settings.fps)}
              ariaLabel="Project frame rate"
              options={[
                { value: '24', label: '24 fps — film' },
                { value: '25', label: '25 fps — PAL' },
                { value: '30', label: '30 fps — NTSC' },
                { value: '50', label: '50 fps' },
                { value: '60', label: '60 fps' },
              ]}
              onChange={(v) => onSettings({ fps: Number(v) })}
            />
          </Field>
          <Field label="Background">
            <ColorInput value={doc.settings.background} ariaLabel="Project background colour" onChange={(v) => onSettings({ background: v })} />
          </Field>
          <p className="flex items-start gap-1.5 text-[10px] leading-snug text-fg-muted">
            <HardDrive className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            {media.length} media file{media.length === 1 ? '' : 's'} in this project
            {media.length > 0 && ` · ${(media.reduce((n, m) => n + m.sizeBytes, 0) / 1024 ** 2).toFixed(1)} MB`}
          </p>
        </div>
      </PanelSection>
    </div>
  );
}

/** Re-exported so the shell can build a doc from live state. */
export function makeDoc(
  id: string,
  settings: ProjectSettings,
  tracks: TimelineTrack[],
  transitions: ProjectDoc['transitions'],
  history: TimelineTrack[][],
  future: TimelineTrack[][],
  duration: number
): ProjectDoc {
  return {
    version: 2,
    id,
    settings,
    tracks,
    transitions,
    history,
    future,
    savedAt: Date.now(),
    duration,
  };
}

export { FolderOpen, Settings2 };
