'use client';

// ============================================================================
// Media bin
// ============================================================================
//
// ---- WHAT WAS ACTUALLY WRONG HERE ----
//
// 1. BROKEN IMAGES EVERYWHERE. Every item pointed at `/placeholder-video-1.jpg`
//    and friends. Those files do not exist in the repo, so the browser showed a
//    broken-image icon plus the alt text on EVERY tile - which is why the
//    panel looked like spilled garbage rather than a media bin.
//
// 2. INVALID CSS HEIGHT. `h-[calc(100%-140px)]` is not valid CSS: `calc()`
//    needs spaces around the operators. The class was silently dropped, so the
//    grid laid out at its natural height and spilled horizontally out of the
//    panel.
//
// 3. MOCK DATA PRESENTED AS REAL. Hardcoded rows with invented durations
//    looked like the user's own library. They belong to nobody, and they are
//    gone.
//
// 4. NO WAY TO IMPORT ANYTHING, and no way to GET anything onto the timeline -
//    the onClick body was literally empty, and the timeline itself was a stub.
//
// ---- WHY OBJECT URLS AND NOT A SERVER UPLOAD ----
//
// The user picks a local file; the browser mints a `blob:` URL so it can be
// previewed and dropped on the timeline immediately. That is a real feature
// with no backend round trip. The bytes are also written to IndexedDB when a
// project is saved, so a saved project really does reopen with its media -
// see `lib/engine/project-store.ts`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Music, Image as ImageIcon, Type, Upload, X, Loader2, Layers, Search, Eye, EyeOff } from 'lucide-react';
import { extractThumbnail, hueFor } from '../../lib/media/thumbnail';
import { useMediaStore, type MediaItem, type MediaKind } from '../../lib/engine/media-store';

type FilterId = 'all' | MediaKind;

const FILTERS: Array<{ id: FilterId; label: string; Icon: typeof Film; hint: string }> = [
  { id: 'all', label: 'All media', Icon: Layers, hint: 'Show every imported file regardless of type' },
  { id: 'video', label: 'Video', Icon: Film, hint: 'Show only video files you can put on a video track' },
  { id: 'audio', label: 'Audio', Icon: Music, hint: 'Show only audio - music, voice or sound effects' },
  { id: 'image', label: 'Images', Icon: ImageIcon, hint: 'Show only still images, which can sit on any visual track' },
  { id: 'text', label: 'Text', Icon: Type, hint: 'Show only text files' },
];

const KIND_STYLE: Record<MediaKind, { ring: string; chip: string; label: string }> = {
  video: { ring: 'ring-[#ff6500]/30', chip: 'bg-[#ff6500]/15 text-[#ff6500]', label: 'Video' },
  audio: { ring: 'ring-violet-500/30', chip: 'bg-violet-500/15 text-violet-300', label: 'Audio' },
  image: { ring: 'ring-emerald-500/30', chip: 'bg-emerald-500/15 text-emerald-300', label: 'Image' },
  text: { ring: 'ring-amber-500/30', chip: 'bg-amber-500/15 text-amber-300', label: 'Text' },
  branding: { ring: 'ring-pink-500/30', chip: 'bg-pink-500/15 text-pink-300', label: 'Branding' },
};

function fmtDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function MediaBin({
  selectedId,
  onAdd,
  onDragStart,
}: {
  selectedId?: string | null;
  /** Click a tile to drop it on the timeline at the playhead. */
  onAdd: (item: MediaItem) => void;
  /** Drag a tile onto a lane - the HTML5 drag path, alongside the click one. */
  onDragStart?: (item: MediaItem) => void;
}) {
  const { items, addFiles, remove, setPoster } = useMediaStore();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');
  const [reading, setReading] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  // Which tile is being previewed right now. ONE id, not a Set: two tiles
  // playing audio-less video over each other is a mess, and a Set would make
  // that normal instead of impossible.
  const [hoveringId, setHoveringId] = useState<string | null>(null);
  const previewEls = useRef(new Map<string, HTMLVideoElement>());
  // Thumbnail tile size. Movavi's bin lets you drag a slider to make the
  // tiles bigger or smaller; here it is three stops (S/M/L) that change the
  // grid density, which is the same control with a discrete grip.
  const [thumbSize, setThumbSize] = useState<'sm' | 'md' | 'lg'>('md');
  // Hover-to-preview on/off. Some machines (and some large bins) are better
  // off without every tile decoding on pass-over, so the whole hover path is
  // one click away from off.
  const [previewEnabled, setPreviewEnabled] = useState(true);
  // ---- CLICK INTERCEPTOR FIX ----
  // Track drag state to prevent accidental clicks when resizing panes
  const dragStateRef = useRef({ isDragging: false, dragStartTime: 0 });
  const clickSuppressedRef = useRef(false);

  /**
   * Play or stop a tile's preview.
   *
   * `play()` returns a promise that REJECTS if the browser has not been given
   * permission yet, and an unhandled rejection here would surface as a console
   * error on a perfectly normal hover. Swallowed deliberately: failing to
   * preview is not an error, it is just no preview.
   */
  const setPreviewing = useCallback(async (id: string, on: boolean) => {
    setHoveringId(on ? id : null);
    const el = previewEls.current.get(id);
    if (!el) return;
    if (on) {
      try {
        el.currentTime = 0;
        await el.play();
      } catch {
        // Permission not granted yet, or the codec is unsupported. The poster
        // underneath is the fallback, so this is a quiet degradation.
      }
    } else {
      el.pause();
      el.currentTime = 0;
    }
  }, []);

  /**
   * Poster frames, extracted once per file.
   *
   * Not `<img src={objectUrl}>`: a browser cannot render a video as an image,
   * so every tile showed a broken-image glyph plus its alt text. The real fix
   * is seeking a hidden <video> and copying the frame out of a canvas, which
   * `lib/media/thumbnail.ts` does - time-boxed, because a file with no index
   * may never fire `seeked` and a thumbnail that never appears is worse than a
   * generic one.
   */
  useEffect(() => {
    let alive = true;
    for (const item of items) {
      if (item.kind !== 'video' || item.poster !== null) continue;
      void extractThumbnail(item.url, item.kind).then((dataUrl) => {
        if (alive) setPoster(item.id, dataUrl);
      });
    }
    return () => {
      alive = false;
    };
  }, [items, setPoster]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setReading(new Set(Array.from(files).map((f) => f.name)));
    const added = await addFiles(files);
    setReading(new Set());
    return added;
  };

  // Global mouseup handler to reset drag state when dragging ends anywhere
  useEffect(() => {
    const handleMouseUp = () => {
      dragStateRef.current.isDragging = false;
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (i) => (filter === 'all' || i.kind === filter) && (!q || i.name.toLowerCase().includes(q))
    );
  }, [items, search, filter]);

  return (
    <div className="flex min-h-0 flex-col gap-2.5">
      <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={[
              'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-[8px] font-medium text-fg transition-colors duration-150',
              reading.size > 0 ? 'border-solid border-[#ff6500] bg-[#ff6500]/10 text-[#ff6500]' : 'border-dashed border-[#9fa7b3]/25',
              'hover:border-[#ff6500]/40 hover:text-[#ff6500]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500]/40',
              'active:border-[#ff6500] active:text-[#ff6500]',
            ].join(' ')}
          >
          <Upload className="h-2.5 w-2.5" aria-hidden="true" />
          Import media
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,audio/*,image/*,text/*"
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = '';
          }}
          className="sr-only"
          aria-label="Import media files"
        />
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search media…"
          aria-label="Search media"
          className={[
            'w-full rounded-md border-dashed border-[#9fa7b3]/20 bg-surface py-1.5 pl-7 pr-2 text-[8px] text-fg placeholder:text-fg-muted',
            'transition-colors duration-150',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500]/40 focus:border-[#ff6500]/60',
          ].join(' ')}
          style={{ borderRadius: '6px' }}
        />
      </div>

      <div className="flex gap-1" role="group" aria-label="Filter media by type">
        {FILTERS.map(({ id, label, Icon, hint }) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            aria-pressed={filter === id}
            aria-label={label}
            title={`${label}\n${hint}`}
            className={[
              'flex h-6 w-6 items-center justify-center rounded transition-colors duration-150',
            filter === id ? 'bg-[#ff6500] text-white' : 'text-fg-secondary  hover:text-fg',
            ].join(' ')}
          >
            <Icon className="h-2.5 w-2.5" aria-hidden="true" />
          </button>
        ))}
        <span className="ml-auto self-center font-mono text-[8px] text-fg-muted">
          {visible.length}/{items.length}
        </span>
      </div>

      {/* Thumbnail size + hover-preview toggle. The size buttons change
          the grid density (S=4 cols, M=3, L=2), which is the same
          "make the tiles bigger" control Movavi exposes as a slider. */}
      <div className="flex items-center gap-1">
        <div className="flex gap-0.5" role="group" aria-label="Thumbnail size">
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => setThumbSize(size)}
              aria-pressed={thumbSize === size}
              aria-label={`Thumbnail size ${size}`}
              title={`Thumbnail size ${size.toUpperCase()}`}
              className={[
                'flex h-5 w-5 items-center justify-center rounded text-[7px] font-semibold uppercase transition-colors duration-150',
                thumbSize === size ? 'bg-[#ff6500] text-white' : 'text-fg-secondary hover:text-fg',
              ].join(' ')}
            >
              {size}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPreviewEnabled((v) => !v)}
          aria-pressed={previewEnabled}
          aria-label={previewEnabled ? 'Disable hover preview' : 'Enable hover preview'}
          title={previewEnabled ? 'Hover preview: on (click to disable)' : 'Hover preview: off (click to enable)'}
          className={[
            'ml-auto flex h-5 w-5 items-center justify-center rounded transition-colors duration-150',
            previewEnabled ? 'text-[#ff6500]' : 'text-fg-muted hover:text-fg',
          ].join(' ')}
        >
          {previewEnabled ? <Eye className="h-2.5 w-2.5" aria-hidden="true" /> : <EyeOff className="h-2.5 w-2.5" aria-hidden="true" />}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
        {visible.length === 0 ? (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 rounded-md border-dashed border-[#9fa7b3]/15 p-4 text-center">
            {items.length === 0 ? (
              <>
                <Film className="h-2.5 w-2.5 text-fg-muted" aria-hidden="true" />
                <p className="text-[8px] text-fg-muted">No media imported yet</p>
                <p className="max-w-[30ch] text-[8px] leading-snug text-fg-muted">
                  Import files, then click a tile to drop it on the timeline. Files stay in this browser
                  and are stored with the project when you save it.
                </p>
              </>
            ) : (
              <p className="text-[8px] text-fg-muted">Nothing matches “{search}”</p>
            )}
          </div>
        ) : (
          <ul className={`grid gap-1.5 ${thumbSize === 'sm' ? 'grid-cols-4' : thumbSize === 'lg' ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {visible.map((item) => {
              const style = KIND_STYLE[item.kind];
              const active = selectedId === item.id;
              return (
                <li key={item.id}>
                  <div
                    className={[
                      'group relative overflow-hidden rounded-sm transition-all duration-150',
                        active
                          ? 'border-[#ff6500]/60 ring-2 ring-[#ff6500]/40 bg-[#0d0d0d]'
                          : reading.has(item.name)
                          ? 'border-dashed border-[#ff6500]/40 bg-[#ff6500]/5'
                          : 'border-dashed border-[#9fa7b3]/20 bg-[#161616] hover:border-[#ff6500]/40 hover:bg-[#0d0d0d]',
                    ].join(' ')}
                  >
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-wideo11-media', item.id);
                        e.dataTransfer.effectAllowed = 'copy';
                        dragStateRef.current.isDragging = true;
                        dragStateRef.current.dragStartTime = Date.now();
                        onDragStart?.(item);
                      }}
                      onClick={(e) => {
                        // CLICK INTERCEPTOR: Suppress click if a drag operation just occurred
                        // This prevents accidental clicks when dragging pane splitters
                        const now = Date.now();
                        const dragDuration = now - dragStateRef.current.dragStartTime;
                        if (dragStateRef.current.isDragging && dragDuration < 500) {
                          clickSuppressedRef.current = true;
                          dragStateRef.current.isDragging = false;
                          return;
                        }
                        // Reset drag state after a short delay to allow normal clicks
                        if (dragStateRef.current.isDragging) {
                          dragStateRef.current.isDragging = false;
                          // Small delay to ensure drag-end events are processed
                          setTimeout(() => { clickSuppressedRef.current = false; }, 100);
                        }
                        onAdd(item);
                      }}
                      // ---- HOVER TO PLAY ----
                      //
                      // Previewing an asset BEFORE committing it to the timeline
                      // is the entire reason to hover a media bin. It has to be
                      // instant though: mounting a player on hover means the
                      // browser fetches and decodes before anything is visible,
                      // and that is a visible half-second delay on every pass.
                      //
                      // So the element is already mounted below (paused,
                      // `preload="none"`) and the ONLY work on enter is
                      // `play()`. On leave it is paused and rewound, so the next
                      // hover starts from the first frame rather than from
                      // wherever the cursor last left the tile.
                      onMouseEnter={() => {
                        if (previewEnabled) void setPreviewing(item.id, true);
                      }}
                      onMouseLeave={() => void setPreviewing(item.id, false)}
                      aria-pressed={active}
                      aria-label={`Add ${item.name} to the timeline`}
                      title={`${item.name}\nClick to add at the playhead · hover to preview`}
                       className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500]/40"
                    >
                      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-surface">
                        {item.poster ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.poster} alt="" className="h-full w-full object-cover" />
                        ) : item.kind === 'image' ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span
                            className="flex h-full w-full items-center justify-center"
                            style={
                              item.kind === 'audio'
                                ? // Audio has no poster to show, so it gets a
                                  // quiet, obviously-audio backdrop: a repeating
                                  // vertical bar pattern. A hue-derived gradient
                                  // reads as "a picture we could not load", which
                                  // is the opposite of the truth.
                                  {
                                    backgroundImage:
                                      'repeating-linear-gradient(90deg, rgba(167,139,250,0.22) 0 2px, transparent 2px 6px)',
                                    backgroundSize: '100% 60%',
                                    backgroundPosition: 'center',
                                    backgroundRepeat: 'no-repeat',
                                  }
                                : {
                                    background: `linear-gradient(135deg, hsl(${hueFor(item.name)} 32% 16%), hsl(${hueFor(item.name)} 28% 9%))`,
                                  }
                            }
                          >
                            {reading.has(item.name) ? (
                              <Loader2 className="h-2.5 w-2.5 animate-spin text-fg-muted" aria-hidden="true" />
                            ) : item.kind === 'audio' ? (
                              <Music className="h-2.5 w-2.5 text-fg-muted" aria-hidden="true" />
                            ) : item.kind === 'text' ? (
                              <Type className="h-2.5 w-2.5 text-fg-muted" aria-hidden="true" />
                            ) : (
                              <Film className="h-2.5 w-2.5 text-fg-muted" aria-hidden="true" />
                            )}
                          </span>
                        )}

                        {/*
                          The hovering preview element.

                          Always mounted, PAUSED, and `preload="none"`. `none`
                          matters: with `auto`, the browser downloads the whole
                          file for EVERY tile in the bin the moment the panel
                          opens, which on a folder of videos is the difference
                          between an instant panel and a frozen tab.
                        */}
                        {item.kind === 'video' && (
                          <video
                            ref={(el) => {
                              if (el) previewEls.current.set(item.id, el);
                              else previewEls.current.delete(item.id);
                            }}
                            src={item.url}
                            preload="none"
                            muted
                            playsInline
                            loop
                            className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-100 ${
                              hoveringId === item.id ? 'opacity-100' : 'opacity-0'
                            }`}
                            aria-hidden="true"
                          />
                        )}
                      </div>

                      <div className="space-y-0.5 p-1.5">
                        <p className="truncate text-[8px] font-medium text-fg">{item.name}</p>
                        <p className="flex items-center gap-1 text-[8px] text-fg-muted">
                          <span className={style.chip}>{style.label}</span>
                          <span>{fmtDuration(item.duration)}</span>
                          <span className="truncate">{fmtSize(item.sizeBytes)}</span>
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => remove(item.id)}
                      aria-label={`Remove ${item.name}`}
                      title={`Remove ${item.name} from the bin`}
                      className="absolute right-1 top-1 rounded bg-surface/80 p-0.5 text-fg-muted opacity-0 transition-opacity hover:text-red-400 focus:opacity-100 focus:outline-none focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <X className="h-2.5 w-2.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
