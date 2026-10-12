'use client';

/**
 * INLINE PLAYER CONTEXT - one player per media section, driven by any card.
 *
 * =============================================================================
 * WHY A CONTEXT AND NOT LOCAL STATE
 * =============================================================================
 *
 * The player is a single instance that swaps content. If each card owned its own
 * copy, clicking two cards would spawn two players, and closing one would leave
 * the other playing behind the grid. So "which asset is playing" lives above the
 * grid, and every card just says "play this".
 *
 * It also gives prev/next for free: the provider knows the ordered playlist the
 * page handed it, so the arrows walk it.
 *
 * =============================================================================
 * WHY THE PROVIDER DOES NOT RENDER THE PLAYER
 * =============================================================================
 *
 * It used to, as a fixed overlay. Now the player has to sit INSIDE the page's
 * layout - split 50/50 with the grid - so where it goes is a decision the page
 * owns. The provider holds the state; the page places `InlinePlayer` where the
 * split puts it.
 *
 * =============================================================================
 * WHY IT DOES NOT RESOLVE URLS ITSELF
 * =============================================================================
 *
 * It stores the asset it was handed. Resolving a playable URL is a per-surface
 * policy question - an owner's library and a public channel page hand over
 * different kinds of asset - and mixing the two would make the provider decide
 * who may watch what.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { InlinePlayer as InlinePlayerComponent, type InlinePlayerAsset } from './InlinePlayer';

export type { InlinePlayerAsset };
export { InlinePlayerComponent as InlinePlayer };

interface InlinePlayerContextValue {
  /** Open the player for one asset. Replaces whatever was playing. */
  play: (asset: InlinePlayerAsset) => void;
  /** Close it. */
  close: () => void;
  /** The asset currently playing, or null. */
  current: InlinePlayerAsset | null;
  isOpen: boolean;
  /** Walk the playlist. No-op when there is nothing to walk to. */
  navigate: (direction: 'prev' | 'next') => void;
  /** Where `current` sits in the playlist, or -1 when it is not in it. */
  index: number;
  /** Playlist length. */
  total: number;
}

const InlinePlayerContext = createContext<InlinePlayerContextValue | null>(null);

export function useInlinePlayer(): InlinePlayerContextValue {
  const ctx = useContext(InlinePlayerContext);
  if (!ctx) {
    throw new Error('useInlinePlayer must be used inside an InlinePlayerProvider');
  }
  return ctx;
}

interface ProviderProps {
  children: ReactNode;
  /** The ordered list the arrows walk. Optional. */
  playlist?: InlinePlayerAsset[];
}

export function InlinePlayerProvider({ children, playlist }: ProviderProps) {
  const [currentId, setCurrentId] = useState<string | null>(null);
  // The assets are held BY ID so a refetch or a tab switch does not restamp the
  // object the player is holding - which would restart playback mid-watch.
  const [assets, setAssets] = useState<Record<string, InlinePlayerAsset>>({});
  const listRef = useRef<InlinePlayerAsset[]>(playlist ?? []);

  useEffect(() => {
    listRef.current = playlist ?? [];
  }, [playlist]);

  const play = useCallback((asset: InlinePlayerAsset) => {
    setAssets((prev) => (prev[asset.id] ? prev : { ...prev, [asset.id]: asset }));
    setCurrentId(asset.id);
  }, []);

  const close = useCallback(() => setCurrentId(null), []);

  const navigate = useCallback((direction: 'prev' | 'next') => {
    setCurrentId((prevId) => {
      const list = listRef.current;
      if (!prevId || list.length === 0) return prevId;
      const idx = list.findIndex((a) => a.id === prevId);
      if (idx < 0) return prevId;
      const nextIdx = direction === 'next' ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= list.length) return prevId;
      const target = list[nextIdx];
      setAssets((prev) => (prev[target.id] ? prev : { ...prev, [target.id]: target }));
      return target.id;
    });
  }, []);

  const current = currentId ? assets[currentId] ?? null : null;

  const value = useMemo<InlinePlayerContextValue>(
    () => ({
      play,
      close,
      current,
      isOpen: Boolean(current),
      navigate,
      index: current ? listRef.current.findIndex((a) => a.id === current.id) : -1,
      total: listRef.current.length,
    }),
    [play, close, current, navigate]
  );

  return <InlinePlayerContext.Provider value={value}>{children}</InlinePlayerContext.Provider>;
}

