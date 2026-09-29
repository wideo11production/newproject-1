'use client';

/**
 * ============================================================================
 * SESSION IDENTITY PROVIDER  -  avatar/username available app-wide
 * ============================================================================
 *
 * REQUIREMENT: "session se har jagah uski profile image jaha bhi woh jayegi
 * uske sath honi chahiye".
 *
 * ---- WHY A CONTEXT INSTEAD OF REFETCHING PER COMPONENT ----
 * 1. Efficiency: `/api/auth/me` ek baar fetch hota hai, phir har component
 *    (header, sidebar, settings, dashboard) context se padhta hai. Har jagah
 *    alag fetch = N requests per page load.
 * 2. Consistency: ek hi source se aata hai, to kahin stale avatar aur kahin
 *    naya avatar dikhna impossible hai.
 * 3. Instant: avatar URL change hote hi `refresh()` se pure app me update ho
 *    jata hai - koi page reload nahi.
 *
 * ---- DATA FLOW ----
 *   /api/auth/me (httpOnly cookie se proxy)
 *        -> state here
 *        -> every consumer via useSessionIdentity()
 *        -> on avatar change: refresh() re-fetches, everyone updates
 *
 * ---- PUBLIC PAGES ----
 *  - Login/register par user authenticated nahi hota, `_isAuthenticated`
 *    false hota hai, aur consumers apna fallback dikhate hain. Koi crash nahi.
 *
 * Hinglish comments: har block ka arth
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type SessionIdentity = {
  id: string;
  email: string;
  username: string;
  full_name: string;
  avatar_url: string;
  role: string;
  is_verified: boolean;
  /** Logged in hai ya nahi (public pages ke liye false) */
  _isAuthenticated: boolean;
  /** Avatar ke do letters (fallback) */
  initials: string;
  /** Superadmin hai ya nahi - UI gating ke liye */
  isSuperadmin: boolean;
  /** Data reload karo (avatar change ke baad call karo) */
  refresh: () => Promise<void>;
};

const EMPTY: SessionIdentity = {
  id: '',
  email: '',
  username: '',
  full_name: '',
  avatar_url: '',
  role: 'user',
  is_verified: false,
  _isAuthenticated: false,
  initials: '',
  isSuperadmin: false,
  refresh: async () => {},
};

const IdentityContext = createContext<SessionIdentity>(EMPTY);

/**
 * IdentityProvider - root layout me wrap hota hai.
 */
export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Omit<SessionIdentity, 'initials' | 'refresh' | 'isSuperadmin'>>({
    id: '',
    email: '',
    username: '',
    full_name: '',
    avatar_url: '',
    role: 'user',
    is_verified: false,
    _isAuthenticated: false,
  });
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      // 401/403 = logged out (public page). Ye NORMAL hai, error nahi -
      // isliye silently empty identity rakhna sahi behaviour hai.
      if (!res.ok) {
        setIdentity({
          id: '',
          email: '',
          username: '',
          full_name: '',
          avatar_url: '',
          role: 'user',
          is_verified: false,
          _isAuthenticated: false,
        });
        return;
      }
      const data = await res.json();
      setIdentity({ ...data, _isAuthenticated: true });
    } catch {
      // Network fail - empty identity rakh do, crash nahi karna chahiye
    } finally {
      setLoaded(true);
    }
  }, []);

  // Initial load + browser back/forward par re-check.
  //
  // NOTE: `focus` listener isliye hai ki jab user login ke baad tab switch
  // kare (SPA me state reset ho sakta hai), to identity refresh ho jaaye.
  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const value = useMemo<SessionIdentity>(() => {
    // Initials: full_name > username > email se derive
    const src =
      identity.full_name?.trim() || identity.username || identity.email || '';
    return {
      ...identity,
      initials: src ? src.slice(0, 2).toUpperCase() : '',
      isSuperadmin: identity.role === 'superadmin',
      refresh: loaded ? refresh : async () => {},
    };
  }, [identity, loaded, refresh]);

  return (
    <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
  );
}

/**
 * useSessionIdentity - consumer hook.
 *
 * Usage:
 *   const { avatar_url, initials, username, _isAuthenticated } = useSessionIdentity();
 */
export function useSessionIdentity(): SessionIdentity {
  return useContext(IdentityContext);
}
