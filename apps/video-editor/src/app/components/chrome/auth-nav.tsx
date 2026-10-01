'use client';

// ============================================================================
// Session-aware navbar block
// ============================================================================
//
// Unauthenticated  -> Login + Register icons, top-right.
// Authenticated    -> avatar with a pulsing green "online" dot, a logout
//                     button, and a link back to /dashboard.
//
// ============================================================================
// ARCHITECTURE: WHY THIS ASKS INSTEAD OF READING A TOKEN
// ============================================================================
//
// Session ek HTTP-ONLY cookie hai, naam `wideo11_session` (web app ka
// `app/api/auth/login/route.ts` ushe set karta hai). Do wajah hain ki isko
// editor ke client JS se PADHA nahi ja sakta:
//
//   1. `httpOnly` - browser hi document.cookie se chhupata hai. Ye XSS se
//      token chori rokne ke liye hai aur ye kaam karta hai.
//   2. Cross-origin - localhost:3002 aur localhost:3000 alag origin hain.
//      Cookie origin-scoped hota hai, port matter nahi karta, lekin phir bhi
//      doosre origin ka JS uska document.cookie nahi padh sakta.
//
// Iska matlab ye NAHI ki hum ek fake "logged in" dikha dein. Ek navbar jo
// bina token dekhe "avatar + green dot" dikhaye to wo jhooth bol raha hoga -
// aur jhooth bolta hua session indicator sabse buri cheez hoti hai, kyunki
// user usi par click karke apna data expose kar deta hai.
//
// Isliye: POOCHTE hain. `GET /api/v1/auth/profile` cookie ke saath jaata hai
// (same-site hai - dono localhost par hain - aur `credentials: 'include'`
// se bheja jaata hai).
//
//   200 -> authenticated, avatar + dot
//   401/403 -> logged out, Login + Register
//   network error -> logged out (SAFE DEFAULT: kabhi "logged in" mat batao
//                    jab confirm na ho)
//
// ----------------------------------------------------------------------------
// SECURITY NOTE - koi token DOM ya localStorage me nahi jaata
// ----------------------------------------------------------------------------
//
// Ye component token ko kabhi store nahi karta, sirf `user.email` rakhta hai
// taaki avatar ka initials dikha sake. Token cookie me hi rehta hai, jahan
// JS use chhu nahi sakta.
import { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut, LayoutDashboard, Loader2, UserPlus } from 'lucide-react';

/**
 * URLs env se, hardcode nahi.
 *
 * Ye app compose me chalti hai aur web app host pe `pnpm dev` se - yaani
 * deployment badalne par hardcoded port galat ho jaata. `process.env.*` Next
 * me BUILD TIME par inline hota hai, isliye inhe compose `environment:` se
 * dena padta hai, `.env.local` se nahi.
 */
const AUTH_API = process.env.NEXT_PUBLIC_AUTH_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '';
const LOGIN_URL = process.env.NEXT_PUBLIC_LOGIN_URL ?? 'http://localhost:3000/auth/login';
const REGISTER_URL = process.env.NEXT_PUBLIC_REGISTER_URL ?? 'http://localhost:3000/auth/register';
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3000/dashboard';

type Session =
  | { state: 'loading' }
  | { state: 'out' }
  | { state: 'in'; email: string; role: string };

/** `AB` from `a@b.com`, ya `?` jab pata na ho. */
function initials(email: string): string {
  const name = email.split('@')[0] ?? '';
  const parts = name.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.slice(0, 2) || '?').toUpperCase();
}

export function AuthNav() {
  const [session, setSession] = useState<Session>({ state: 'loading' });
  const [busy, setBusy] = useState(false);

  const probe = useCallback(async () => {
    // No token to read, so there is nothing to guard: an empty API base just
    // means "cannot verify", which is the same as logged out.
    if (!AUTH_API) {
      setSession({ state: 'out' });
      return;
    }
    try {
      const res = await fetch(`${AUTH_API}/api/v1/auth/profile`, {
        // The session cookie is the whole credential here. Without this the
        // browser silently omits it and every request looks logged out.
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setSession({ state: 'out' });
        return;
      }
      const body = (await res.json()) as { email?: string; role?: string };
      setSession({
        state: 'in',
        email: body.email ?? 'Signed in',
        role: body.role ?? 'user',
      });
    } catch {
      // Network failure, CORS block, auth-service down - sab ka matlab hai
      // "PATA NAHI", aur pata na ho to logged-out dikhana safe hai.
      setSession({ state: 'out' });
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      // Logout SERVER-SIDE hota hai: auth-service session row HARD-DELETE
      // karta hai. Editor httpOnly cookie khud nahi mita sakta (JS ko uski
      // access hi nahi), aur isse zaroorat bhi nahi - row delete hone par
      // cookie apne aap invalid ho jaata hai aur agla request 401 milta hai.
      if (AUTH_API) {
        await fetch(`${AUTH_API}/api/v1/auth/logout`, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
        }).catch(() => undefined);
      }
    } finally {
      setBusy(false);
      setSession({ state: 'out' });
      // Login page pe bhej do: wahan se user nayi session khol sakta hai.
      window.location.assign(LOGIN_URL);
    }
  }, []);

  const iconBtn =
    'flex h-8 w-8 items-center justify-center rounded-md border border-edge bg-surface-raised text-fg-muted transition-colors hover:bg-surface-overlay hover:text-fg';

  if (session.state === 'loading') {
    return (
      <div className="flex h-8 w-24 items-center justify-center" aria-label="Checking your session">
        <Loader2 className="h-2 w-2 animate-spin text-fg-muted" aria-hidden="true" />
      </div>
    );
  }

  // ---------------------------------------------------------------- logged out
  //
  // ICON-ONLY, and that is a deliberate trade rather than a preference.
  //
  // The editor's toolbar is a dense row of tools; two text buttons sitting at
  // the far end of it are the only words in the strip and they pull the eye off
  // the controls. Icons carry the same meaning at a third of the width, and the
  // `aria-label` carries it to anyone who cannot see the icon - so nothing is
  // lost but the visual noise.
  if (session.state === 'out') {
    return (
      <div className="ve-signin-glow flex shrink-0 items-center gap-1" data-session="out">
        <a
          href={LOGIN_URL}
          className={iconBtn}
          aria-label="Log in"
          title={`Log in - ${LOGIN_URL}`}
        >
          <LogIn className="h-2 w-2" aria-hidden="true" />
        </a>
        <a
          href={REGISTER_URL}
          className={`${iconBtn} border-sky-500/50 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25`}
          aria-label="Create an account"
          title={`Create an account - ${REGISTER_URL}`}
        >
          <UserPlus className="h-2 w-2" aria-hidden="true" />
        </a>
      </div>
    );
  }

  // -------------------------------------------------------------- logged in
  return (
    <div className="ve-signin-glow flex shrink-0 items-center gap-1" data-session="in">
      <a
        href={DASHBOARD_URL}
        className="flex h-8 items-center gap-1.5 rounded-md border border-edge bg-surface-raised px-2.5 text-[8px] font-medium text-fg transition-colors hover:bg-surface-overlay"
        aria-label="Back to dashboard"
        title={`Back to your dashboard - ${DASHBOARD_URL}`}
      >
        <LayoutDashboard className="h-2 w-2" aria-hidden="true" />
        Dashboard
      </a>

      <button
        type="button"
        onClick={() => void logout()}
        disabled={busy}
        className="flex h-8 items-center gap-1.5 rounded-md border border-edge bg-surface-raised px-2.5 text-[8px] font-medium text-fg transition-colors hover:bg-surface-overlay disabled:opacity-50"
        aria-label="Log out"
        title="Log out of this device only - your other devices stay signed in"
      >
        {busy ? (
          <Loader2 className="h-2 w-2 animate-spin" aria-hidden="true" />
        ) : (
          <LogOut className="h-2 w-2" aria-hidden="true" />
        )}
        Log out
      </button>

      {/*
        The avatar + online dot.

        The dot is a LIVE indicator, so it is animated - a static green circle
        claims "online" without any evidence. The pulse says "we checked, and
        you are here", which is the difference between an indicator and
        decoration.

        `prefers-reduced-motion` ko BHI respect kiya gaya hai: kuch log
        animation se physically uncomfortable hote hain, aur unke liye ek
        pulsing dot accessibility problem ban jata hai. Reduced motion me wo
        ek static dot ban jata hai - indicator wahi rehta hai, sirf hilna nahi.
      */}
      <span
        className="relative flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-[8px] font-semibold text-white"
        title={`${session.email} (${session.role})`}
        aria-label={`Signed in as ${session.email}`}
        role="img"
      >
        {initials(session.email)}
        <span
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-raised bg-green-500 motion-safe:animate-pulse"
          aria-hidden="true"
        />
      </span>
    </div>
  );
}
