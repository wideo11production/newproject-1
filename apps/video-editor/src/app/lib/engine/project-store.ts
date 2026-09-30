// ============================================================================
// Project storage
// ============================================================================
//
// A saved project has two halves, and they have to live in different places:
//
//   * the ARRANGEMENT (tracks, clips, transitions, settings) - small JSON.
//     localStorage, one key per project, plus an index for the recent list.
//   * the MEDIA BYTES - the actual files. IndexedDB, because localStorage
//     caps out around 5MB and a single video blows through that; IndexedDB
//     takes blobs natively and stores them on disk rather than in memory.
//
// ---- WHY NOT ONE BLOB OF EVERYTHING ----
//
// Because the arrangement is what you want to read when the list of recent
// projects is drawn, and reading it should not mean deserialising every video
// the user ever imported. A JSON index is readable; a 400MB IndexedDB cursor
// is not.
//
// ---- WHAT IS NOT SAVED, AND WHY IT IS SAID OUT LOUD ----
//
// Nothing is dropped silently. A project that references media whose bytes
// could not be stored comes back with those clips flagged, not with black
// tiles that look like a rendering bug.

import type { MediaItem, MediaKind } from './media-store';
import { normaliseProject, type ProjectDoc, type ProjectSummary } from './types';

export type { ProjectSummary };

const INDEX_KEY = 'wideo11.editor.projects';
const DOC_KEY = (id: string) => `wideo11.editor.project.${id}`;
const DB_NAME = 'wideo11-editor';
const DB_STORE = 'media';
const DB_VERSION = 1;

export interface RestoredMedia {
  id: string;
  name: string;
  kind: MediaKind;
  blob: Blob;
}

export interface LoadedProject {
  doc: ProjectDoc;
  media: RestoredMedia[];
  /** mediaIds referenced by a clip but with no bytes available. */
  missing: string[];
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    // Private-browsing modes and quota-blocked origins both land here. A
    // missing store degrades the project to "arrangement only", which is
    // still worth saving, so it is not an error.
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(DB_STORE, mode);
      const req = run(t.objectStore(DB_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

export function listProjects(): ProjectSummary[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectSummary[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: ProjectSummary[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    /* private mode: the arrangement is still in its own key */
  }
}

function upsertIndex(summary: ProjectSummary) {
  const rest = listProjects().filter((p) => p.id !== summary.id);
  writeIndex([summary, ...rest].slice(0, 30));
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export interface SaveResult {
  saved: boolean;
  mediaSaved: number;
  mediaFailed: number;
  /** Set when the whole save could not happen (no storage at all). */
  error?: string;
}

export async function saveProject(doc: ProjectDoc, media: MediaItem[]): Promise<SaveResult> {
  if (typeof localStorage === 'undefined') {
    return { saved: false, mediaSaved: 0, mediaFailed: 0, error: 'This browser has no local storage' };
  }
  const withTime: ProjectDoc = { ...doc, savedAt: Date.now() };

  try {
    localStorage.setItem(DOC_KEY(doc.id), JSON.stringify(withTime));
  } catch (e) {
    return {
      saved: false,
      mediaSaved: 0,
      mediaFailed: 0,
      error: e instanceof Error ? e.message : 'Could not write the project',
    };
  }

  let mediaSaved = 0;
  let mediaFailed = 0;
  const db = await openDb();
  if (db) {
    for (const item of media) {
      if (!item.file) {
        mediaFailed++;
        continue;
      }
      const ok = await tx(db, 'readwrite', (s) => s.put(item.file, `${doc.id}:${item.id}`));
      if (ok === null) mediaFailed++;
      else mediaSaved++;
    }
    // Drop media for this project that is no longer referenced, so reopening
    // and deleting a file does not leave its bytes on disk forever.
    const referenced = new Set(media.map((m) => `${doc.id}:${m.id}`));
    const keys = (await tx<IDBValidKey[]>(db, 'readonly', (s) => s.getAllKeys())) ?? [];
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith(`${doc.id}:`)) continue;
      if (referenced.has(key)) continue;
      await tx(db, 'readwrite', (s) => s.delete(key));
    }
  } else {
    mediaFailed = media.length;
  }

  upsertIndex({
    id: doc.id,
    name: doc.settings.name,
    updatedAt: withTime.savedAt,
    duration: doc.duration,
    clipCount: doc.tracks.reduce((n, t) => n + t.clips.length, 0),
  });

  return { saved: true, mediaSaved, mediaFailed };
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export async function loadProject(id: string): Promise<LoadedProject | null> {
  if (typeof localStorage === 'undefined') return null;
  let doc: ProjectDoc | null = null;
  try {
    const raw = localStorage.getItem(DOC_KEY(id));
    if (!raw) return null;
    doc = normaliseProject(JSON.parse(raw) as Partial<ProjectDoc>);
  } catch {
    return null;
  }

  const media: RestoredMedia[] = [];
  const db = await openDb();
  if (db) {
    const kinds = new Map<string, MediaKind>();
    const names = new Map<string, string>();
    for (const track of doc.tracks) {
      for (const clip of track.clips) {
        if (!kinds.has(clip.mediaId)) {
          kinds.set(clip.mediaId, clip.type === 'text' ? 'text' : clip.type);
          names.set(clip.mediaId, clip.mediaName);
        }
      }
    }
    for (const [mediaId, kind] of kinds) {
      const blob = await tx<Blob>(db, 'readonly', (s) => s.get(`${id}:${mediaId}`));
      if (blob) media.push({ id: mediaId, name: names.get(mediaId) ?? 'Media', kind, blob });
    }
  }

  const have = new Set(media.map((m) => m.id));
  const missing = new Set<string>();
  for (const track of doc.tracks) for (const clip of track.clips) if (!have.has(clip.mediaId)) missing.add(clip.mediaId);

  return { doc, media, missing: [...missing] };
}

export async function deleteProject(id: string): Promise<void> {
  try {
    localStorage.removeItem(DOC_KEY(id));
  } catch {
    /* nothing else to do */
  }
  writeIndex(listProjects().filter((p) => p.id !== id));
  const db = await openDb();
  if (!db) return;
  const keys = (await tx<IDBValidKey[]>(db, 'readonly', (s) => s.getAllKeys())) ?? [];
  for (const key of keys) {
    if (typeof key === 'string' && key.startsWith(`${id}:`)) {
      await tx(db, 'readwrite', (s) => s.delete(key));
    }
  }
}

/** Which project autosave should be writing to, if any. */
export function lastOpenedId(): string | null {
  try {
    return localStorage.getItem('wideo11.editor.lastProject');
  } catch {
    return null;
  }
}

export function setLastOpenedId(id: string) {
  try {
    localStorage.setItem('wideo11.editor.lastProject', id);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Download / upload a project file
// ---------------------------------------------------------------------------

// Files above this total are not embedded, whatever the checkbox says.
const MAX_EMBED_BYTES = 24 * 1024 * 1024;

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Chunked: `String.fromCharCode(...bytes)` on a multi-megabyte array blows
  // the argument limit and throws, which is a crash on a save the user asked
  // for.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Serialise a project for download.
 *
 * Media is embedded as base64 only when the caller asks AND the total is
 * small enough to be worth it. A 200MB download that the browser then cannot
 * write is worse than a project file that opens and asks for its media, so
 * the threshold is real and the omission is reported rather than hidden.
 */
export async function serialiseProjectFile(
  doc: ProjectDoc,
  media: MediaItem[],
  includeMedia: boolean
): Promise<{ json: string; embedded: number; omitted: number; bytes: number }> {
  const payload: {
    format: string;
    version: number;
    doc: ProjectDoc;
    media: Array<{ id: string; name: string; kind: string; type: string; size: number; data: string }>;
  } = {
    format: 'wideo11-project',
    version: doc.version,
    doc: { ...doc, history: [], future: [] },
    media: [],
  };
  let embedded = 0;
  let omitted = 0;
  let bytes = 0;

  if (includeMedia) {
    const total = media.reduce((n, m) => n + (m.file?.size ?? 0), 0);
    if (total > MAX_EMBED_BYTES) {
      omitted = media.length;
    } else {
      for (const item of media) {
        if (!item.file) {
          omitted++;
          continue;
        }
        payload.media.push({
          id: item.id,
          name: item.name,
          kind: item.kind,
          type: item.file.type,
          size: item.file.size,
          data: await toBase64(item.file),
        });
        embedded++;
        bytes += item.file.size;
      }
    }
  } else {
    omitted = media.length;
  }
  return { json: JSON.stringify(payload), embedded, omitted, bytes };
}

export interface ParsedProjectFile {
  doc: ProjectDoc;
  media: RestoredMedia[];
}

/** Read a downloaded project file back. Returns null when it is not one. */
export async function parseProjectFile(text: string): Promise<ParsedProjectFile | null> {
  let raw: { format?: string; doc?: Partial<ProjectDoc>; media?: unknown };
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw?.format !== 'wideo11-project' || !raw.doc) return null;
  const doc = normaliseProject(raw.doc);
  const media: RestoredMedia[] = [];
  const list = Array.isArray(raw.media) ? (raw.media as Array<Record<string, unknown>>) : [];
  for (const entry of list) {
    const data = entry.data;
    if (!data || typeof data !== 'object') continue;
    // A Blob serialises through structured clone as {} in plain JSON, so a
    // base64 payload is the only portable form. Anything else is skipped
    // rather than turned into a zero-byte file that pretends to be media.
    const base64 = typeof entry.data === 'string' ? entry.data : null;
    if (!base64) continue;
    try {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      media.push({
        id: String(entry.id),
        name: String(entry.name ?? 'Media'),
        kind: (entry.kind as MediaKind) ?? 'video',
        blob: new Blob([bytes], { type: String(entry.type ?? '') }),
      });
    } catch {
      /* skip this one entry, keep the rest */
    }
  }
  return { doc, media };
}
