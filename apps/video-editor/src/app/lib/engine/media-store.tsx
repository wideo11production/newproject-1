'use client';

// ============================================================================
// Media store
// ============================================================================
//
// The media bin used to own its own `useState` list, which meant four things
// could not see it: the compositor (so it could not PLAY a clip, only draw a
// poster), the exporter, the save file, and the waveform extractor. Each of
// those re-derived "where is the file" from whatever it happened to be holding.
//
// This is the single owner. The bin is a view over it, the timeline resolves
// `mediaId` through it, the compositor takes its element sources from it, and
// the project writer takes the underlying `File` from it.
//
// ---- WHY THE File IS KEPT ALONGSIDE THE URL ----
//
// A `blob:` URL is only valid for the document that created it. It cannot be
// written into a saved project and it does not survive a reload, so a project
// that only stored URLs would reopen with every tile broken. Keeping the
// `File` lets the save writer put the real bytes in IndexedDB and the loader
// mint a fresh URL on open. That is the whole difference between "save" and
// "save the arrangement of files I no longer have".

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type MediaKind = 'video' | 'audio' | 'image' | 'text' | 'branding';

export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  /** Session blob: URL. Revoked when the item is removed. */
  url: string;
  duration?: number;
  sizeBytes: number;
  /** The bytes, so a project can be saved and reopened. */
  file?: Blob;
  /** Decoded poster frame (video) or the image itself. */
  poster?: string | null;
  /** 0..1 peak buckets for the waveform, filled in lazily. */
  peaks?: number[] | null;
  createdAt: number;
}

interface MediaStoreValue {
  items: MediaItem[];
  byId: Map<string, MediaItem>;
  addFiles: (files: FileList | File[]) => Promise<MediaItem[]>;
  /**
   * Register media this app just CAPTURED, with its duration already known.
   *
   * `addFiles` is the wrong tool for a recording, for two reasons that both
   * matter:
   *
   * 1. It reads the duration back from a media element, which cannot work for
   *    `MediaRecorder` output. A recorded WebM has no duration in its header, so
   *    `video.duration` is `Infinity`, `readDuration` rejects it as non-finite and
   *    returns `null` — and the clip lands with the 5-second fallback length
   *    instead of the length the user actually recorded. The recorder already
   *    knows the real length from the wall clock, so it is passed in rather than
   *    re-derived from a value that is not there.
   *
   * 2. Without this method there was NO way to get a recording into the store at
   *    all, and everything downstream resolves media through the store. A clip
   *    whose `mediaId` is not in here has no source, so the compositor draws a
   *    placeholder instead of the picture, the filmstrip extractor gets an empty
   *    list and the lane shows no frames, the waveform is never requested, and the
   *    bytes are never written to IndexedDB — so the clip is gone after a reload.
   */
  addRecorded: (input: { name: string; kind: MediaKind; blob: Blob; duration: number }) => MediaItem;
  remove: (id: string) => void;
  clear: () => void;
  setPoster: (id: string, poster: string | null) => void;
  setPeaks: (id: string, peaks: number[] | null) => void;
  /**
   * Re-add a blob read back from IndexedDB, WITHOUT reading its duration.
   * Used when a saved project is opened: the bytes are already on disk, and the
   * duration is in the saved clip data.
   */
  restore: (entries: Array<{ id: string; name: string; kind: MediaKind; blob: Blob }>) => void;
}

const MediaStoreContext = createContext<MediaStoreValue | null>(null);

function kindOf(file: File | Blob): MediaKind | null {
  const type = file.type || '';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('text/')) return 'text';
  // MediaRecorder output and some downloads arrive with an empty MIME type.
  // Falling back to the extension is better than dropping the user's file.
  const name = (file as File).name ?? '';
  if (/\.(mp4|webm|mov|mkv|m4v|avi)$/i.test(name)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return 'audio';
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(name)) return 'image';
  if (/\.(txt|md|srt|vtt)$/i.test(name)) return 'text';
  return null;
}

/** Duration from a media element, or null. Time-boxed. */
export function readDuration(url: string, kind: 'video' | 'audio'): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    const done = (v: number | null) => {
      el.removeAttribute('src');
      el.load();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 4000);
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(el.duration) ? el.duration : null);
    };
    el.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    el.src = url;
  });
}

export function MediaStoreProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const urlsRef = useRef<string[]>([]);

  // Every blob: URL this store creates is revoked when the store unmounts.
  // Not doing this pins every imported byte for the life of the tab.
  useEffect(() => {
    const urls = urlsRef.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const added: MediaItem[] = [];
    for (const file of Array.from(files)) {
      const kind = kindOf(file);
      if (!kind) continue;
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);
      const item: MediaItem = {
        id: `m-${Date.now()}-${added.length}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name || `Imported ${added.length + 1}`,
        kind,
        url,
        sizeBytes: file.size,
        file,
        poster: null,
        peaks: null,
        createdAt: Date.now(),
      };
      added.push(item);
    }
    if (!added.length) return [];
    setItems((prev) => [...added, ...prev]);

    // Durations resolve after the tiles are already on screen. Awaiting them
    // first would make an import of a few large files look like it had failed.
    for (const item of added) {
      if (item.kind !== 'video' && item.kind !== 'audio') continue;
      const dur = await readDuration(item.url, item.kind);
      if (dur == null) continue;
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, duration: dur } : i)));
    }
    return added;
  }, []);

  const addRecorded = useCallback(
    (input: { name: string; kind: MediaKind; blob: Blob; duration: number }) => {
      // The store owns the URL, so it is registered for revocation like any other.
      // The recorder's own URL is NOT reused: handing ownership over cleanly is
      // what keeps the "who revokes this" question from having two answers.
      const url = URL.createObjectURL(input.blob);
      urlsRef.current.push(url);
      const item: MediaItem = {
        id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: input.name,
        kind: input.kind,
        url,
        // Guarded rather than passed through: a zero-length take would make
        // `lenFrames` 0 and produce a clip with no length at all.
        duration: Number.isFinite(input.duration) && input.duration > 0 ? input.duration : undefined,
        sizeBytes: input.blob.size,
        file: input.blob,
        poster: null,
        peaks: null,
        createdAt: Date.now(),
      };
      setItems((prev) => [item, ...prev]);
      return item;
    },
    []
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const hit = prev.find((i) => i.id === id);
      if (hit?.url) {
        URL.revokeObjectURL(hit.url);
        urlsRef.current = urlsRef.current.filter((u) => u !== hit.url);
      }
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => {
      prev.forEach((i) => {
        if (i.url) URL.revokeObjectURL(i.url);
      });
      urlsRef.current = [];
      return [];
    });
  }, []);

  const setPoster = useCallback((id: string, poster: string | null) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, poster } : i)));
  }, []);

  const setPeaks = useCallback((id: string, peaks: number[] | null) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, peaks } : i)));
  }, []);

  const restore = useCallback(
    (entries: Array<{ id: string; name: string; kind: MediaKind; blob: Blob }>) => {
      const restored: MediaItem[] = entries.map((e) => {
        const url = URL.createObjectURL(e.blob);
        urlsRef.current.push(url);
        return {
          id: e.id,
          name: e.name,
          kind: e.kind,
          url,
          sizeBytes: e.blob.size,
          file: e.blob,
          poster: null,
          peaks: null,
          createdAt: Date.now(),
        };
      });
      setItems((prev) => {
        // Anything still held is released: opening a project replaces the
        // working set, and keeping the old bytes would leak them.
        prev.forEach((i) => i.url && URL.revokeObjectURL(i.url));
        urlsRef.current = urlsRef.current.filter((u) => !prev.some((i) => i.url === u));
        return restored;
      });
    },
    []
  );

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const value = useMemo<MediaStoreValue>(
    () => ({ items, byId, addFiles, addRecorded, remove, clear, setPoster, setPeaks, restore }),
    [items, byId, addFiles, addRecorded, remove, clear, setPoster, setPeaks, restore]
  );

  return <MediaStoreContext.Provider value={value}>{children}</MediaStoreContext.Provider>;
}

export function useMediaStore(): MediaStoreValue {
  const ctx = useContext(MediaStoreContext);
  if (!ctx) throw new Error('useMediaStore must be used inside <MediaStoreProvider>');
  return ctx;
}
