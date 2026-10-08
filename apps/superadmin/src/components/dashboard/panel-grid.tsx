'use client';

// Grafana-style panel shell and drag-to-reorder grid.
//
// -----------------------------------------------------------------------------
// WHY THIS IS NOT A LIBRARY DEPENDENCY
// -----------------------------------------------------------------------------
//
// The obvious way to build drag-to-reorder is react-grid-layout, and Grafana itself
// is built on it. This is native HTML5 drag and drop instead, for two reasons.
//
//  1. ZERO THIRD-PARTY COST. The product has a hard requirement: no per-seat licence,
//     no vendor, nothing to pay for at scale. Adding a layout library is a permanent
//     dependency to keep patched for a feature that is one array and three event
//     handlers.
//
//  2. The requirement is narrower than the library. react-grid-layout gives
//     free-form positioning, resizing and breakpoints. What a dashboard needs here
//     is "let the operator put these panels in the order they want and remember it".
//     That is reorder plus persistence.
//
// A dependency that solves more than you need still costs more than you need, and
// the difference shows up on every version bump.
//
// -----------------------------------------------------------------------------
// WHY THE ORDER IS PERSISTED PER OPERATOR
// -----------------------------------------------------------------------------
//
// `localStorage`, one key, validated on read.
//
// The alternative was a server-side layout table, and that would be a schema
// migration, an endpoint, a settings screen and a permission question - to remember
// a list of strings for one person on one browser.
//
// Validation on read is not optional. A stored order is untrusted input: it was
// written by an older version of this code, or by hand, or the set of panels
// changed and an id no longer exists. An unvalidated read produces duplicate React
// keys, panels silently vanishing, and `NaN` grid offsets - all of which look like
// the dashboard is broken rather than like a cache that needs clearing.
//
// So: drop unknown ids, append any that are missing, and if the result is empty
// fall back to the default order. Every one of those has a visible failure mode
// that this prevents.

import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { DragEvent, ReactNode } from 'react';

// -----------------------------------------------------------------------------
// Panel
// -----------------------------------------------------------------------------

export interface PanelProps {
  id: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  /** Buttons rendered at the right of the panel header. */
  actions?: ReactNode;
  /** Extra classes on the panel body, for padding control. */
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * One panel: header with a drag handle, and a body.
 *
 * `id` is required and is what the persisted order stores. A panel without a stable
 * id cannot be reordered, so it would be a panel that silently refuses to move -
 * which reads as a bug in the drag rather than as a missing attribute.
 */
export function Panel({
  id,
  title,
  subtitle,
  icon,
  actions,
  bodyClassName = 'p-4',
  children,
}: PanelProps) {
  const drag = usePanelDrag(id);

  return (
    <section
      data-panel-id={id}
      draggable={drag.draggable}
      onDragStart={drag.onDragStart}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      onDragEnd={drag.onDragEnd}
      className={`flex flex-col overflow-hidden rounded-md border-800 bg-gray-900/40 ${drag.className}`}
    >
      {/*
        The HEADER is the drag surface, and the grip is only an affordance.

        Two reasons, both learned the hard way:

        1. Dragging by the six-dot grip is precise and fiddly. Dragging by the header
           is what every dashboard does and what the hand already expects.

        2. Making the WHOLE panel draggable means every click on a button, `<select>`
           or link inside it has to be suppressed, or a click on the filter dropdown
           starts a drag instead. `draggable` on the section is deliberate and the
           panel body is where the interaction lives.

        The grip is `pointer-events-none` for the same reason: it must not be a
        second, smaller drag target that behaves differently from the header around
        it.
      */}
      <div
        className={
          drag.draggable
            ? 'flex cursor-grab items-center gap-2-800 px-4 py-2.5 active:cursor-grabbing'
            : 'flex items-center gap-2-800 px-4 py-2.5'
        }
      >
        {drag.draggable ? (
          <DragGrip className="pointer-events-none shrink-0 text-gray-600" />
        ) : null}

        <span className="flex items-center gap-2 text-sm font-semibold text-gray-100">
          {icon}
          {title}
        </span>
        {subtitle ? (
          <span className="truncate text-xs text-gray-500">{subtitle}</span>
        ) : null}
        {actions ? <span className="ml-auto flex items-center gap-1.5">{actions}</span> : null}
      </div>

      <div className={`flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** The six-dot grip, shown while dragging. Kept separate so it inherits sizing. */
export function DragGrip({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`h-2.5 w-2.5 ${className}`}
      aria-hidden="true"
    >
      {/* 6 dots, 2 columns x 3 rows - the standard grip glyph. */}
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

// -----------------------------------------------------------------------------
// PanelGrid
// -----------------------------------------------------------------------------

interface PanelGridContextValue {
  onDragStart: (e: DragEvent, id: string) => void;
  onDragOver: (e: DragEvent, id: string) => void;
  onDrop: (e: DragEvent, id: string) => void;
  onDragEnd: () => void;
  draggingId: string | null;
  overId: string | null;
}

const PanelGridContext = createContext<PanelGridContextValue | null>(null);

export interface PanelGridProps {
  /** Stable ids in their intended order. The persisted order overrides this. */
  order: string[];
  storageKey?: string;
  children: ReactNode;
}

/**
 * The reorderable container.
 *
 * `order` is the DEFAULT order and is never mutated. What is persisted is an
 * override on top of it, which means adding a panel in a release shows up in the
 * right place for everyone instead of appearing at the bottom for people who have
 * a stored layout from before it existed.
 */
export function PanelGrid({ order, storageKey, children }: PanelGridProps) {
  const [customOrder, setCustomOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // ---- Read the stored order, validated ----
  //
  // Runs once on mount. The reconciliation is the point:
  //   - ids in storage that no longer exist are DROPPED
  //   - ids that exist but are missing from storage are APPENDED
  // so a panel added or removed between visits cannot leave a hole or a ghost.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;

      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      const known = new Set(order);
      const kept = parsed.filter((x): x is string => typeof x === 'string' && known.has(x));

      // Deduplicate. A duplicated id produces two React keys and a panel that
      // renders twice, which is a confusing way to discover a bad cache.
      const seen = new Set<string>();
      const deduped = kept.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));

      const missing = order.filter((id) => !seen.has(id));
      const reconciled = [...deduped, ...missing];

      if (reconciled.length > 0) setCustomOrder(reconciled);
    } catch {
      // Unparseable storage is not worth reporting. The default order is a working
      // dashboard; a toast about a corrupt cache would be noise.
    }
    // Intentionally mount-only: re-running on `order` change would fight the
    // operator's own arrangement every time a panel list identity changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // ---- Reconcile against the live `order`, every render ----
  const effectiveOrder = useMemo(() => {
    const base = customOrder ?? order;
    const known = new Set(order);

    const filtered = base.filter((id) => known.has(id));
    const missing = order.filter((id) => !filtered.includes(id));
    return [...filtered, ...missing];
  }, [customOrder, order]);

  /**
   * Reorder the CHILDREN by their declared id.
   *
   * This is the part that makes the feature real, and the first version of this
   * component did not do it: it rendered `{children}` unchanged, tracked a dragged
   * id, reordered an array, persisted it - and displayed the original order. Every
   * state update was correct and nothing visibly moved, which is the most expensive
   * kind of bug to find because the code looks like it works.
   *
   * `child.props.id` is readable because `Panel` takes `id` as a required prop and
   * puts it on the rendered `<section>`. React elements carry their props, so the
   * grid can key off them without cloning or a registration context.
   *
   * A child with no recognisable id is rendered last, untouched. That is the
   * fallback for anything that is not a `Panel` - and it degrades to "appears at the
   * end" rather than "disappears", which is the only acceptable failure mode for a
   * reorder function.
   */
  const orderedChildren = useMemo(() => {
    const byId = new Map<string, ReactNode>();
    const unkeyed: ReactNode[] = [];

    Children.forEach(children, (child) => {
      if (!isValidElement(child)) {
        unkeyed.push(child);
        return;
      }
      const id = (child.props as { id?: unknown }).id;
      if (typeof id === 'string' && byId.has(id)) {
        // Duplicate id: render it in the unkeyed tail rather than dropping it.
        // Two panels with the same id is a bug, but silently hiding one is worse.
        unkeyed.push(child);
        return;
      }
      if (typeof id === 'string') byId.set(id, child);
      else unkeyed.push(child);
    });

    const arranged = effectiveOrder
      .map((id) => byId.get(id))
      .filter((c): c is ReactNode => c !== undefined);

    // Anything `order` does not mention still renders.
    const arrangedSet = new Set(arranged);
    const remainder = Children.toArray(children).filter((c) => !arrangedSet.has(c));

    return [...arranged, ...remainder];
  }, [children, effectiveOrder]);

  const commit = useCallback(
    (next: string[]) => {
      setCustomOrder(next);
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Quota or private mode. The rearrangement still applies for this view.
      }
    },
    [storageKey]
  );

  const onDragStart = useCallback((e: DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';

    // Firefox refuses to start a drag unless `setData` is called with something.
    // The value is never read - the id travels in state - but the call is required,
    // and omitting it produces a drag that silently does nothing in one browser.
    e.dataTransfer.setData('text/plain', id);
  }, []);

  const onDragOver = useCallback((e: DragEvent, id: string) => {
    // Without `preventDefault` the browser treats the target as a non-droppable
    // area and shows the "no entry" cursor, so the drop never fires.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverId(id);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent, targetId: string) => {
      e.preventDefault();

      const sourceId = draggingId;
      setDraggingId(null);
      setOverId(null);

      if (!sourceId || sourceId === targetId) return;

      const next = [...effectiveOrder];
      const from = next.indexOf(sourceId);
      const to = next.indexOf(targetId);

      // `indexOf` returning -1 for either means the stored order and the live one
      // disagree. Splicing on -1 would silently DELETE an unrelated panel, which is
      // the worst available outcome: it disappears and stays disappeared.
      if (from < 0 || to < 0) {
        commit(effectiveOrder);
        return;
      }

      next.splice(from, 1);
      next.splice(to, 0, sourceId);
      commit(next);
    },
    [draggingId, effectiveOrder, commit]
  );

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
    setOverId(null);
  }, []);

  const ctx = useMemo(
    () => ({ onDragStart, onDragOver, onDrop, onDragEnd, draggingId, overId }),
    [onDragStart, onDragOver, onDrop, onDragEnd, draggingId, overId]
  );

  // Panels get their drag wiring from `usePanelDrag`, which reads this context. A
  // `Panel` rendered OUTSIDE a grid gets `null` and inert props, so the same
  // component works in a static layout without every call site wrapping it.
  return (
    <PanelGridContext.Provider value={ctx}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{orderedChildren}</div>
    </PanelGridContext.Provider>
  );
}

/** Drag wiring for one panel. Returns props to spread onto the panel's root. */
export function usePanelDrag(id: string) {
  const ctx = useContext(PanelGridContext);

  // Outside a grid: inert props. A panel that is not in a reorderable grid should
  // not be draggable, and pretending otherwise gives a cursor that promises a
  // feature that does nothing.
  if (!ctx) {
    return { draggable: false, className: '' };
  }

  const isDragging = ctx.draggingId === id;
  const isOver = ctx.overId === id && ctx.draggingId !== id;

  return {
    draggable: true,
    onDragStart: (e: DragEvent) => ctx.onDragStart(e, id),
    onDragOver: (e: DragEvent) => ctx.onDragOver(e, id),
    onDrop: (e: DragEvent) => ctx.onDrop(e, id),
    onDragEnd: ctx.onDragEnd,
    className: [
      'transition-opacity',
      isDragging ? 'opacity-40' : '',
      isOver ? 'ring-2 ring-blue-500' : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}
