'use client';

/**
 * MEDIA LIBRARY PANE - the left half of the split workspace.
 *
 * =============================================================================
 * WHAT LIVES HERE
 * =============================================================================
 *
 * The controls (view mode, size, sort, search) and the grid or list itself.
 *
 * Everything is separated by BACKGROUND CONTRAST rather than by borders, per the
 * studio spec: `#0d0f11` sits under `#16181d`, and the difference is the
 * separation. That is also why there is not a single `border-*` in this file's
 * layout - a border would draw exactly the line the design says not to draw.
 *
 * =============================================================================
 * THE ACTIVE GLOW
 * =============================================================================
 *
 * A card that is currently playing carries an orange-red ring, and it is the ONLY
 * thing on screen that does. The viewer asked for that clip, and losing track of
 * which one is playing in a 40-item grid is the failure this prevents.
 */

import { useMemo, useState, isValidElement, cloneElement, type ReactElement, type ReactNode } from 'react';
import {
  LayoutGrid,
  List as ListIcon,
  Search,
  SlidersHorizontal,
  Loader2,
  Film,
} from 'lucide-react';

import {
  productAccent,
  productAccentBg,
  productFocusRing,
  productIconMuted,
  productInfo,
  productPanel,
  productPlaceholder,
  productSunken,
  productTextGroupLabel,
  productTextMuted,
  productTextSubtle,
} from '@wideo11/ui/design-system';

export type LibrarySort = 'newest' | 'oldest' | 'name' | 'duration';

interface SortOption {
  value: LibrarySort;
  label: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name (A-Z)' },
  { value: 'duration', label: 'Longest first' },
];

interface MediaLibraryPaneProps {
  children: ReactNode;
  /** Total item count, for the count badge. */
  count: number;
  loading?: boolean;
  /** Applied to children so the parent can highlight the active card. */
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export function MediaLibraryPane({
  children,
  count,
  loading = false,
  searchPlaceholder = 'Search media',
  emptyMessage = 'Nothing here yet.',
}: MediaLibraryPaneProps) {
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [size, setSize] = useState<'small' | 'medium'>('medium');
  const [sort, setSort] = useState<LibrarySort>('newest');
  const [query, setQuery] = useState('');

  return (
    <section className={`flex h-full min-h-0 flex-col rounded-2xl ${productSunken}`} data-media-library="">
      {/* ---- library header ----
          One row of controls, and they wrap rather than overflow: a 320px
          viewport should not have to horizontally scroll the toolbar. */}
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <Film className={`h-4 w-4 ${productAccent}`} aria-hidden="true" />
          <h2 className="text-sm font-semibold text-white">Media Library</h2>
          <span className={`rounded-full ${productPanel} px-2 py-0.5 text-[10px] font-medium ${productTextMuted}`}>
            {count}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* view mode */}
          <div
            className={`flex items-center gap-0.5 rounded-lg ${productPanel} p-0.5`}
            role="radiogroup"
            aria-label="View mode"
          >
            <button
              role="radio"
              aria-checked={view === 'grid'}
              onClick={() => setView('grid')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                view === 'grid' ? `${productAccentBg} text-white` : `${productTextMuted} hover:text-white`
              }`}
              title="Grid view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Grid</span>
            </button>
            <button
              role="radio"
              aria-checked={view === 'list'}
              onClick={() => setView('list')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                view === 'list' ? `${productAccentBg} text-white` : `${productTextMuted} hover:text-white`
              }`}
              title="List view"
            >
              <ListIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">List</span>
            </button>
          </div>

          {/* size - VISIBLE IN BOTH VIEWS. It used to be gated on grid only, which
              made it a dead control in list view. */}
          <div
            className={`flex items-center gap-0.5 rounded-lg ${productPanel} p-0.5`}
            role="radiogroup"
            aria-label="Thumbnail size"
          >
            <button
              role="radio"
              aria-checked={size === 'small'}
              onClick={() => setSize('small')}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                size === 'small' ? `${productAccentBg} text-white` : `${productTextMuted} hover:text-white`
              }`}
            >
              Small
            </button>
            <button
              role="radio"
              aria-checked={size === 'medium'}
              onClick={() => setSize('medium')}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                size === 'medium' ? `${productAccentBg} text-white` : `${productTextMuted} hover:text-white`
              }`}
            >
              Medium
            </button>
          </div>

          {/* sort */}
          <div className="relative">
            <SlidersHorizontal
              className={`pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${productTextMuted}`}
              aria-hidden="true"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as LibrarySort)}
              aria-label="Sort by"
              className={`appearance-none rounded-lg ${productPanel} py-1.5 pl-7 pr-7 text-[11px] font-medium ${productTextMuted} transition-colors hover:text-white ${productFocusRing}`}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <svg
              viewBox="0 0 24 24"
              className={`pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 ${productTextMuted}`}
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M7 10l5 5 5-5z" />
            </svg>
          </div>

          {/* search */}
          <div className="relative">
            <Search
              className={`pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${productTextMuted}`}
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className={`w-40 rounded-lg ${productPanel} py-1.5 pl-7 pr-2.5 text-[11px] text-white ${productPlaceholder} transition-colors focus:w-56 ${productFocusRing}`}
            />
          </div>
        </div>
      </div>

      {/* ---- the collection ----
          The only scrolling container, so the header stays put while the list
          moves. Without that, a 40-item grid scrolls the toolbar away and the
          viewer has to scroll back up to change the sort. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" style={{ scrollbarWidth: 'thin' }}>
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className={`h-6 w-6 animate-spin ${productInfo}`} />
          </div>
        ) : count === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-center">
            <Film className={`mb-2 h-7 w-7 ${productIconMuted}`} aria-hidden="true" />
            <p className={`text-xs ${productTextMuted}`}>{emptyMessage}</p>
          </div>
        ) : (
          <LibrarySurface view={view} size={size} sort={sort} query={query}>
            {children}
          </LibrarySurface>
        )}
      </div>
    </section>
  );
}

/**
 * The surface the cards sit on.
 *
 * Rendered as its own component so the sort/filter of the CARDS is exactly where
 * the controls are - a control that changes a value the cards never read is a
 * control that lies.
 */
/** A clip's display shape, derived from what the card itself would render. */
type CardShape = 'landscape' | 'letterbox' | 'portrait' | 'square';

const SHAPE_LABELS: Record<CardShape, string> = {
  landscape: 'Landscape',
  letterbox: 'Long reels',
  portrait: 'Vertical',
  square: 'Audio',
};

/**
 * The minimum column width for a shape.
 *
 * Portrait gets a NARROWER minimum because a portrait card's height comes from
 * its width - 168px wide would be 300px tall, a tower. Letterbox (4:1) gets a
 * WIDER minimum because squeezed into a narrow column it becomes a sliver.
 */
function columnMin(shape: CardShape, size: 'small' | 'medium'): number {
  const scale = size === 'small' ? 0.78 : 1;
  switch (shape) {
    case 'portrait':
      return Math.round(116 * scale);
    case 'letterbox':
      return Math.round(260 * scale);
    case 'square':
      return Math.round(132 * scale);
    case 'landscape':
    default:
      return Math.round(168 * scale);
  }
}

/** Read a card's shape off the element's props. */
function shapeOf(node: ReactNode): CardShape {
  const props = (node as unknown as { props?: Record<string, unknown> })?.props ?? {};
  const kind = String(props.kind ?? '');
  const duration = Number(props.durationSeconds ?? 0);
  const w = Number(props.width ?? 0);
  const h = Number(props.height ?? 0);

  if (kind === 'audio') return 'square';
  // Orientation is a fact about the file, so it beats any inference from kind -
  // the same rule `cardAspect()` uses.
  if (w > 0 && h > 0 && h > w) return 'portrait';
  if (kind === 'reel' && duration >= 60) return 'letterbox';
  return 'landscape';
}

/** Group cards by shape, preserving the sort order INSIDE each group. */
function groupByShape(items: ReactNode[]): Array<{ shape: CardShape; label: string; items: ReactNode[] }> {
  const order: CardShape[] = ['landscape', 'letterbox', 'portrait', 'square'];
  const buckets = new Map<CardShape, ReactNode[]>();
  for (const node of items) {
    const shape = shapeOf(node);
    const bucket = buckets.get(shape);
    if (bucket) bucket.push(node);
    else buckets.set(shape, [node]);
  }
  return order
    .filter((shape) => buckets.has(shape))
    .map((shape) => ({ shape, label: SHAPE_LABELS[shape], items: buckets.get(shape) ?? [] }));
}

function LibrarySurface({
  children,
  view,
  size,
  sort,
  query,
}: {
  children: ReactNode;
  view: 'grid' | 'list';
  size: 'small' | 'medium';
  sort: LibrarySort;
  query: string;
}) {
  // Sorting and filtering live in data, not here, so this function is the point
  // where the pane applies them - and the caller does not have to.
  const items = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return sortNodes(children, sort).filter((node) =>
      lowered ? String(matchKeyOf(node)).toLowerCase().includes(lowered) : true
    );
  }, [children, sort, query]);

  // ---- the size, handed to the rows ----
  //
  // In GRID view the size never reaches a child, because it is a property of the
  // container: `gridTemplateColumns` is built from it here and every card simply
  // fills whatever column it lands in. That is why Small/Medium works on the grid.
  //
  // In LIST view there is no such container, so the size has to reach the row
  // itself - and it was not, which is exactly why Small/Medium appeared to do
  // nothing in list view while working perfectly in grid. The buttons were live and
  // the state changed; nothing downstream read it.
  //
  // Injection via cloneElement rather than a new prop on every call site, because
  // the children are opaque nodes the caller handed over. `sortNodes` already reads
  // `props.sortKey` off these same nodes, so this is the one place that knows their
  // shape.
  const rows = useMemo(() => {
    if (view !== 'list') return items;
    return items.map((node) =>
      isValidElement(node)
        ? cloneElement(node as ReactElement<{ size?: 'small' | 'medium' }>, { size })
        : node
    );
  }, [items, size, view]);

  // ---------------------------------------------------------------------------
  // THE RULES OF HOOKS - all hooks BEFORE any early return
  // ---------------------------------------------------------------------------
  // `groups` used to be computed AFTER the `view === 'list'` early return below,
  // which is a Rules of Hooks violation: the hook does not run at all in list
  // view, then suddenly exists when the view flips back to grid. React reports
  // the resulting mismatch as error #300 and tears down the whole tree - which
  // is exactly the "list view crashes, grid works" report.
  //
  // So both `rows` and `groups` are computed unconditionally here, and the early
  // return only picks which one to render.
  const groups = useMemo(() => groupByShape(items), [items]);
  const multiGroup = groups.length > 1;

  if (view === 'list') {
    return (
      <div className="space-y-1.5" role="list" aria-label="Media list">
        {rows}
      </div>
    );
  }

  // ---- ORIENTATION-AWARE GRIDS ----
  // Cards are grouped by display shape so a portrait reel does not force a whole
  // row to 300px tall, which used to leave a 200px void under every landscape
  // card. Each group gets its own column width, and a lone group shows no label.
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.shape} aria-label={group.label}>
          {multiGroup ? (
            <h3 className={`mb-2 ${productTextGroupLabel}`}>
              {group.label}
              <span className={`ml-1.5 font-normal normal-case tracking-normal ${productTextSubtle}`}>
                {group.items.length}
              </span>
            </h3>
          ) : null}
          <div
            className="grid gap-2.5"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${columnMin(group.shape, size)}px, 1fr))` }}
            role="list"
          >
            {group.items}
          </div>
        </section>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Sorting helpers
   ------------------------------------------------------------------------- */

/**
 * Reorder children according to the chosen sort.
 *
 * React children are opaque, so ordering them means reading a `sortKey` prop off
 * each element. Cards that do not carry one stay in their original order rather
 * than being dropped - a library whose layout vanishes because a new card
 * omitted a prop is worse than one that sorts imperfectly.
 */
function sortNodes(children: ReactNode, sort: LibrarySort): ReactNode[] {
  const nodes = (Array.isArray(children) ? children.flat() : [children]) as ReactNode[];
  if (sort === 'newest' || nodes.length < 2) return nodes;

  // React children are opaque, so the sort value is read off `props.sortKey` of
  // each element. Reading it requires treating a child as an element first, hence
  // the `unknown` bridge - a direct cast to a typed shape would be the one that
  // TypeScript refuses, and it refuses it for the right reason: a child can be a
  // string, null or a number, and none of those have props.
  const entryOf = (node: ReactNode, i: number) => {
    const el = node as unknown as { props?: { sortKey?: string | number } } | null;
    return { node, i, key: el?.props?.sortKey };
  };

  const withKey = nodes.map(entryOf);

  // A stable sort: equal keys keep their incoming order, so "Oldest first" on
  // items with identical timestamps does not shuffle them on every render.
  const sorted = [...withKey].sort((a, b) => {
    switch (sort) {
      case 'name':
        return String(a.key ?? '').localeCompare(String(b.key ?? ''));
      case 'duration':
        return numeric(b.key) - numeric(a.key);
      case 'oldest':
        return numeric(a.key) - numeric(a.key) === 0 ? 0 : numeric(a.key) - numeric(b.key);
      default:
        return a.i - b.i;
    }
  });

  return sorted.map((entry) => entry.node);
}

function numeric(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function matchKeyOf(node: ReactNode): string {
  const el = node as unknown as { props?: { matchKey?: unknown; sortKey?: unknown } } | null;
  return String(el?.props?.matchKey ?? el?.props?.sortKey ?? '');
}
