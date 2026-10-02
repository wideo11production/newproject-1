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
// Isliye: POOCHTE hAIN. Lekin sawal ZAROORI SE POOCH RAHE HAIN.
//
// ---- YAH SECTION GALAT THA, AUR AB THEEK HAI ----
//
// Yahan likha tha ki `GET /api/v1/auth/profile` ko cookie ke saath bhejne
// par 200 aayega. Wo GALAT tha, aur verify kiya gaya:
//
//   curl -b 'wideo11_session=<valid>' /api/v1/auth/profile
//   -> 401 {"error":"missing authorization header"}
//
// auth-service sirf `Authorization: Bearer` maangta hai. Cookie se kaam nahi
// chalega - aur cookie httpOnly hai, yaani JS use padh hi nahi sakta, to
// browser se wo header banane ka koi tareeka hi nahi hai. Isliye ye probe
// HAMESHA fail hota tha, yaani signed-in user ko ye "Log in / Create an
// account" dikhata tha aur dashboard link kabhi aata hi nahi tha.
//
// Sahi jawaab ke liye server route chahiye: `GET /api/session` (is file ke
// bagal me). Wo server par cookie padhta hai, bearer header khud lagata hai,
// aur auth-service se puchta hai. Details `lib/session.ts` me hain.
//
//   ready               -> avatar + dot + dashboard + logout
//   needs_verification  -> signed in, but email link not opened yet
//   needs_setup         -> verified, mandatory setup still due
//   out / error         -> Log in + Register
//
// SECURITY NOTE - koi token DOM ya localStorage me nahi jaata
// ----------------------------------------------------------------------------
//
// Ye component token ko kabhi store nahi karta, sirf `user.email` rakhta hai
// taaki avatar ka initials dikha sake. Token cookie me hi rehta hai, jahan
// JS use chhu nahi sakta.
import { useCallback, useEffect, useRef, useState } from 'react';
import { LogIn, LogOut, LayoutDashboard, Loader2, UserPlus } from 'lucide-react';
import { useSession, type SessionState } from '../../lib/session';

/**
 * URLs env se, hardcode nahi.
 *
 * Ye app compose me chalti hai aur web app host pe `pnpm dev` se - yaani
 * deployment badalne par hardcoded port galat ho jaata. `process.env.*` Next
 * me BUILD TIME par inline hota hai, isliye inhe compose `environment:` se
 * dena padta hai, `.env.local` se nahi.
 */
// NOTE: `AUTH_API` yahan se hata diya gaya. Ye auth-service ka base URL tha,
// aur is file me do jagah use hota tha - session probe aur logout - dono browser
// se seedhe auth-service ko call karte the. Dono me wahi galti thi: auth-service
// sirf `Authorization: Bearer` maangta hai, jo httpOnly cookie se banana
// impossible hai, isliye dono hamesha fail hote the. Ab dono kaam `lib/session.ts`
// ke `useSession()` aur `DELETE /api/session` server route karte hain.
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
  const { session, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // ---- Dismiss the menu the ways a keyboard and a mouse both expect ----
  //
  // Escape because it is the only way out for a keyboard user. Outside-click
  // because a menu that stays open after you click elsewhere reads as broken.
  //
  // Both are on `document`, and both are torn down in the cleanup - a listener
  // left attached across re-renders is how you end up with a handler that fires
  // on a component that is no longer mounted.
  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      // Logout SERVER-SIDE hota hai, aur is baar isi app ke route se.
      //
      // Pehle ye auth-service ko DIRECTLY browser se POST karta tha
      // (`credentials: 'include'` ke saath) - jo wahi galti thi jo GET par thi:
      // auth-service ko `Authorization: Bearer` chahiye, cookie se 401 aata hai.
      // Yaani logout button dabane se kuch nahi hota tha.
      //
      // Ab `DELETE /api/session` server par cookie padhta hai, bearer header
      // lagata hai, aur auth-service ka logout call karta hai - jisse session
      // row HARD-DELETE ho jaati hai. Row gayab hone par cookie apne aap
      // bekaar ho jaati hai (har request par 401), isliye JS ko cookie mitaane
      // ki zaroorat nahi.
      await fetch('/api/session', { method: 'DELETE', cache: 'no-store' }).catch(
        () => undefined
      );
    } finally {
      setBusy(false);
      await refresh();
      // Login page pe bhej do: wahan se user nayi session khol sakta hai.
      window.location.assign(LOGIN_URL);
    }
  }, [refresh]);

  const iconBtn =
    'flex h-8 w-8 items-center justify-center rounded-md border border-edge bg-surface-raised text-fg-muted transition-colors hover:bg-surface-overlay hover:text-fg';

  if (session.state === 'loading') {
    return (
      <div className="flex h-8 w-24 items-center justify-center" aria-label="Checking your session">
        <Loader2 className="h-2 w-2 animate-spin text-fg-muted" aria-hidden="true" />
      </div>
    );
  }

  // ---- Signed in? ----
  //
  // `ready`, `needs_verification` and `needs_setup` all mean there IS a valid
  // session, so all three show the signed-in cluster. The gate in front of this
  // component is what stops an unverified user reaching the toolbar at all, so
  // this branch is not a second security decision - it is "which affordances do
  // this session have".
  const signedIn = session.state !== 'out';

  // ---------------------------------------------------------------- logged out
  //
  // ICON-ONLY, and that is a deliberate trade rather than a preference.
  //
  // The editor's toolbar is a dense row of tools; two text buttons sitting at
  // the far end of it are the only words in the strip and they pull the eye off
  // the controls. Icons carry the same meaning at a third of the width, and the
  // `aria-label` carries it to anyone who cannot see the icon - so nothing is
  // lost but the visual noise.
  if (!signedIn) {
    return (
      // `ve-signin-glow` YAHAN SE HATA DI GAYA.
      //
      // Wo class ek rotating green conic-gradient hai. Ye dono clusters par lag
      // rahi thi - yaani "Log in" aur "Create an account" bhi green chamak
      // rahe the. Ye galat signal hai: green is app me "signed in" ka color
      // hai (avatar ka ring + dot), to ek aise control par jahan user signed
      // in NAHI hai, uska chamakna ye kah raha tha ki wo hai.
      <div className="flex shrink-0 items-center gap-1" data-session="out">
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

  // -------------------------------------------------------------- signed in
  //
  // ONE control, not four. The avatar is the button, and everything the user
  // needs hangs off it.
  //
  // Ye pehle teen alag controls the (Dashboard icon, Log out, avatar). Toolbar
  // me teen jagah teen kaam karna tha jabki teeno ek hi cheez hain: "main kaun
  // hoon aur yahan se kahan jaa sakta hoon". Aapne bhi yahi maanga - avatar pe
  // click, aur usme dashboard ka link.
  //
  // Dashboard ka link JAAN-BOOJH KAR dropdown me rakha gaya hai, toolbar me nahi.
  // Wajah: dashboard khatam karne wala control hai - editor khatam karne wala
  // nahi. Jo cheez user ka current kaam khatam karti hai, wo prominent hoti
  // hai; jo cheez is app se BAHAR le jaati hai, wo menu me rehti hai. Ise
  // hamesha dikhane se ek accidental click se user editor se nikal jaata.
  return (
    <div className="relative shrink-0" ref={menuRef}>
      {/*
        THE AVATAR - and the only place in this app where green means
        "you are signed in".

        It is a real `<button>`, not a span. A span with a click handler is not
        reachable by keyboard, does not respond to Enter or Space, and is
        invisible to a screen reader as a control - so the account menu would
        simply not exist for anyone not using a mouse.

        RING: a 1px green outline. 1px because that is the separator weight used
        throughout the editor, and a thicker ring would out-shout the controls
        next to it. The colour is the same green as the dot below, so the two
        read as one indicator rather than two.

        The initials are the fallback identity. There is no uploaded avatar
        image here, and there should not be one yet: an image would need a URL
        from the profile service, and a broken `img` is worse than initials
        because it looks like a bug rather than a placeholder. Initials are
        always present, always render, and never 404.

        THE DOT is a LIVE indicator, so it is animated - a static green circle
        claims "online" without any evidence. The pulse says "we checked, and
        you are here", which is the difference between an indicator and
        decoration.

        `prefers-reduced-motion` is respected via `motion-safe:`: some people
        find animation physically uncomfortable, and a pulsing dot is an
        accessibility problem for them. Under reduced motion it is simply a
        static dot - the indicator is unchanged, only the movement goes.
      */}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Account menu for ${session.email}`}
        title={`${session.email} (${session.role})`}
        className="relative flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-[9px] font-semibold uppercase tracking-wide text-white ring-1 ring-green-500/70 transition-colors hover:bg-sky-500"
      >
        {/*
          The uploaded avatar, or initials.

          The editor drew initials while the web profile drew the photo, so the
          same person had two faces depending on the app. An uploaded picture is
          the picture everywhere.

          `onError` hides a BROKEN image URL rather than leaving the browser's
          broken-image glyph inside the green ring, which looks worse than
          letters would.
        */}
        {session.avatarUrl ? (
          <img
            src={session.avatarUrl}
            alt=""
            className="h-full w-full rounded-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <span aria-hidden="true">{initials(session.email)}</span>
        )}
        <span
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-raised bg-green-500 motion-safe:animate-pulse"
          aria-hidden="true"
        />
      </button>

      {menuOpen ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-9 z-50 w-52 rounded-md border border-edge bg-surface-raised p-1 shadow-lg"
        >
          {/*
            Identity first, so a user who signed in as one of several accounts
            can tell at a glance WHICH one this menu belongs to. Truncated with
            `break-all` rather than an ellipsis: an email cut mid-character is
            useless for telling two accounts apart, which is the entire job.
          */}
          <div className="border-b border-edge px-2 py-1.5">
            <p className="break-all text-[8px] font-medium text-fg">{session.email}</p>
            <p className="mt-0.5 text-[8px] capitalize text-fg-muted">{session.role}</p>
          </div>

          <a
            href={DASHBOARD_URL}
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            className="mt-1 flex h-7 items-center gap-1.5 rounded px-2 text-[8px] text-fg transition-colors hover:bg-surface-overlay"
          >
            <LayoutDashboard className="h-2 w-2 shrink-0" aria-hidden="true" />
            Dashboard
          </a>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              void logout();
            }}
            disabled={busy}
            className="flex h-7 w-full items-center gap-1.5 rounded px-2 text-[8px] text-fg transition-colors hover:bg-surface-overlay disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-2 w-2 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <LogOut className="h-2 w-2 shrink-0" aria-hidden="true" />
            )}
            Log out
          </button>

          {/*
            Spelled out rather than left to a `title`, because this is a
            consequence users get wrong: signing out here ends the session on
            THIS device only, and their other devices stay signed in. That
            distinction is the whole reason device-scoped logout was built.
          */}
          <p className="border-t border-edge px-2 pt-1.5 pb-1 text-[8px] leading-relaxed text-fg-muted">
            Logging out ends this device only. Your other devices stay signed in.
          </p>
        </div>
      ) : null}
    </div>
  );
}
