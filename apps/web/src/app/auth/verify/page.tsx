// Email verification page - /auth/verify?token=<token>
//
// KYUN YE PAGE ZAROORI THA:
// Verification email ka link yahi banta hai (auth-service `BuildVerificationURL`
// -> `{VERIFICATION_BASE_URL}/auth/verify?token=...`). Ye page pehle KABHI
// exist hi nahi karta tha, to email link kholte hi 404 aata tha - yaani
// kisi user ka email verify hi nahi ho sakta tha. 30 minute baad purge worker
// unverified user ko permanently delete kar deta tha.
//
// FLOW:
//   1. Link khulte hi token `?token=` se padha jata hai
//   2. `useEffect` me `GET /api/auth/verify` (same-origin proxy) call hota hai,
//      jo backend ke `GET /api/v1/auth/verify` tak forward karta hai
//   3. Backend token hash match karke `is_verified = true` set karta hai
//   4. Result ke hisaab se success / error state dikhata hai
//
// SECURITY:
//   - Verification token hi proof hai isliye use URL me rakhna zaroori hai
//   - Token page me KABHI log ya render nahi hota, sirf backend ko forward hota hai
//   - Proxy route `cache: 'no-store'` set karta hai, to single-use token dobara
//     use nahi ho sakta
//   - Ye page AuthShell use karta hai, isliye dashboard chrome nahi aata
//
// Hinglish comments: har block ka arth

'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, MailCheck, Send } from 'lucide-react';
import { safeNext } from '@/lib/safe-next';

import {
  AuthShell,
  PRIMARY_BUTTON_CLASS,
} from '@/components/auth/auth-shell';

import {
  grafanaFocusRingVisible,
  grafanaPrimary,
  grafanaText,
  grafanaTextMuted,
  productPanelHover,
  productSeparation,
  productSunken,
} from '@wideo11/ui/design-system';

/**
 * `useSearchParams` client hook hai jo build time par static render me
 * unavailable hota hai. Next.js isko Suspense boundary ke andar use karne ki
 * zaroorat padti hai, warna `next build` fail ho jata hai
 * ("useSearchParams() should be wrapped in a suspense boundary").
 * Isliye actual form ko alag component me rakha hai.
 */
function VerifyContent() {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? null;

  // ---- Email for resend ----
  // Verification email ka link `?email=<address>` ke saath bheja jaata hai.
  // Isse resend panel ko email pata hota hai aur user ko type nahi karni
  // padti. Agar link me email nahi hai, to resend panel input field dikhata
  // hai (fallback).
  const emailToResend = searchParams?.get('email') ?? '';

  // ---- Where the user goes after a successful verification ----
  //
  // SUCCESS ke baad LOGIN page par bhejte hain - `?next=` ko lekar - aur na ki
  // seedha destination par. Wajah upar render block ke comment me poori tarah
  // hai: verification sirf email ownership prove karta hai; pehchaan tab banti
  // hai jab user password daal ke login kare. Register ka session UNVERIFIED
  // account ka bana hua hota hai, aur use turant aage le jaane se credentials
  // wala step chhoot jata tha.
  //
  // `safeNext()` isliye zaroori hai: ye value user-controlled hai, aur bina
  // check ke ye open-redirect ban sakta hai.
  const destination = safeNext(searchParams?.get('next'));
  const loginHref = `/auth/login?next=${encodeURIComponent(destination)}`;

  // ---- FOUR STATES, NOT THREE ----
  //
  // `awaiting` exists because of a bug this page had for its whole life: with
  // no `?token=` in the URL it initialised straight to 'error'. So arriving
  // here WITHOUT a token - which is exactly what happens right after
  // registration, and exactly what the editor gate sends people to - rendered a
  // red "Verification failed" box.
  //
  // Nothing had failed. The email had simply not been opened yet. To someone
  // who just typed their address into a form, a red failure banner reads as "the
  // signup is broken" and sends them to register again.
  //
  // `awaiting` is the honest answer: no token, nothing attempted, check your
  // inbox. `error` is reserved for a token that was actually tried and rejected.
  const [status, setStatus] = useState<'checking' | 'awaiting' | 'success' | 'error'>(
    token ? 'checking' : 'awaiting'
  );
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');

  // ---- Shared verify promise (StrictMode-safe) ----
  //
  // Ye effect run kitni bhi baar ho (StrictMode = 2), dono invocations SAME
  // promise ko share karti hain:
  //   - pehli run  -> promise banati hai (ek hi network call)
  //   - doosri run -> `verifyPromiseRef.current` already set hai, to reuse
  //
  // Aur koi `cancelled` flag nahi hai - matlab fetch ka result KABHI
  // suppress nahi hota. Pehle `hasRequested` guard + `cancelled` flag ki
  // wajah se spinner forever ho jata tha (comment effect ke andar hai).
  const verifyPromiseRef = useRef<Promise<void> | null>(null);

  // Elapsed milliseconds - loading state ko phase-aware banata hai.
  // Spinner + text se zyada helpful hai: user ko dikhta hai process chal raha
  // hai, aur 4s cross karne par message badal jata hai.
  const [elapsed, setElapsed] = useState(0);

  // Retry counter - "Try again" button isko increment karta hai.
  //
  // YE ZAROORI HAI: verify effect `[token]` par depend karta hai. Sirf
  // `setStatus('checking')` karne se effect DOBARA nahi chalta (token same
  // hai), isliye retry button kuch nahi karta tha. Ye nonce dependencies me
  // hone se effect ko force-retrigger karta hai.
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    // Token hi nahi hai - kuch verify karne ko nahi, backend call bhi nahi karte.
    //
    // ---- YE `setStatus('error')` PEHLE BUG THA ----
    //
    // Effect mount hote hi `error` set kar deta tha, yaani page RED failure
    // dikhata tha BINA kuch kiye. Aur sabse bura ye:
    //
    //   - Register ke turant baad user yahi page par aata hai (register
    //     `?next=&email=` ke saath yahan bhejta hai)
    //   - Editor ka gate bhi unauthenticated user ko yahan bhejta hai
    //   - Dono jagah link abhi click nahi hua hota
    //
    // Yaani "abhi tak link nahi khola" aur "verification fail ho gayi" - do
    // bilkul alag cheezein - screen par ek jaisi dikh rahi thin. Naye user ko
    // lagta tha signup toot gaya, aur wo dobara register karta.
    //
    // Ab: kuch attempt nahi hua, to kuch fail bhi nahi hua. `awaiting` wahi
    // pehle se set hai (initial state), aur message default copy se aata hai -
    // jisme user ki email address naam liya hoti hai, yaani wo jaanta hai
    // exactly kis inbox me dekhna hai.
    if (!token) return;

    // -----------------------------------------------------------------------
    // STRICTMODE DOUBLE-INVOCATION GUARD (the fix)
    // -----------------------------------------------------------------------
    // `next.config.mjs` me `reactStrictMode: true` hai, aur development me
    // React 18 ka StrictMode har effect ko JAAN-BUJH KAR 2 BAAR chalata hai
    // (intentional double-render jo bugs pakadne ke liye hai).
    //
    // Verification token SINGLE-USE hai - `MarkVerified` use hone par
    // `verified_at` set kar deta hai, aur `IsUsable()` uske baad us token ko
    // "not found" bolta hai. Matlab:
    //
    //     call #1 -> SUCCESS (token consume, account verified)
    //     call #2 -> FAILED  (token ab use ho chuka hai)
    //
    // Doosri call ki error PEHLI call ke SUCCESS ko overwrite kar deti thi -
    // user ko "verification failed" dikhta tha jabki account actually
    // verify ho chuka tha. (Yehi wo symptom tha jo aapne report kiya.)
    //
    // ---- PEHLE KA GUARD KAAM KYUN NAHI KARTA THA ----
    // Effect ke andar `let started = false` likha gaya tha. Lekin wo variable
    // har effect invocation me NAAYA ban-ta hai - yaani doosri run me phir
    // `false` hota hai. Isliye `if (started) return;` kabhi true nahi hua,
    // aur guard bilkul no-op tha.
    //
    // ---- SAHI FIX ----
    // -----------------------------------------------------------------------
    // STRICTMODE DOUBLE-INVOCATION - THE CORRECT FIX
    // -----------------------------------------------------------------------
    // `next.config.mjs` me `reactStrictMode: true` hai, to development me
    // React har effect ko JAAN-BOOH KAR 2 baar chalata hai. Verification token
    // single-use hai, isliye 2 network calls me se ek fail hoti.
    //
    // ---- PEHLE KA APPROACH KAISE DEADLOCK HUA ----
    // Maine do guards saath lagaye the:
    //   1. `hasRequested` ref  - taaki doosri run fetch start na kare
    //   2. `cancelled` flag    - taaki unmounted ho to state update na kare
    //
    // Ye dono MILKAR poora kaam kar dete the:
    //
    //   Run 1  : guard allow  -> hasRequested = true -> fetch shuru
    //   Cleanup: cancelled = true
    //   Run 2  : guard BLOCK  -> koi fetch start nahi hoti
    //   Fetch resolve: `cancelled === true` -> SILENTLY return
    //   Result: `status` kabhi 'checking' se bahar nahi nikalta
    //           -> SPINNER FOREVER (yahi bug aap dekh rahe the)
    //
    // ---- NAYA APPROACH ----
    // Ab ek SHARED PROMISE ref hai. Effect kitni bhi baar chale, dono
    // invocations SAME promise ko attach ho jaati hain:
    //   - pehli run promise banati hai
    //   - doosri run usi promise ko reuse karti hai (koi naya fetch nahi)
    // Aur `cancelled` flag POORI TARAH hata diya gaya hai - iska matlab
    // fetch ka result KABHI suppress nahi hota, chahe component StrictMode
    // cleanup se guzar jaye.
    //
    // NOTE: React 18 me unmounted component par setState karna warning nahi
    // deta, aur ye component page-level hai - isliye ye safe hai.
    //
    // Ye zaroori hai kyunki verification ek ONE-SHOT MUTATION hai: ise
    // "sirf ek baar" chahiye, lekin uska result zaroor apply hona chahiye.
    if (!verifyPromiseRef.current) {
      verifyPromiseRef.current = (async () => {
        try {
          const res = await fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`, {
            cache: 'no-store',
          });
          const payload = await res.json().catch(() => ({}));

          if (res.ok && payload.verified) {
            setStatus('success');
            setEmail(typeof payload.email === 'string' ? payload.email : '');
            setMessage(
              payload.message ?? 'Your email address has been verified successfully.'
            );
            return;
          }

        setStatus('error');

        // Raw upstream error text user ko mat dikhao. Wahan se ajeeb strings
        // aati hain (jaise "Too Many Requests"), jo confusing lagti hain.
        // Status code dekh kar friendly copy choose karte hain, aur backend
        // ka `error` sirf tab use hota hai jab wo genuinely user-facing ho.
        if (res.status === 429) {
          setMessage(
            'Too many verification attempts. Please wait a minute and open the link again.'
          );
          return;
        }

        if (res.status === 503) {
          setMessage(
            'The verification service is temporarily unavailable. Please try again in a minute.'
          );
          return;
        }

        const upstream =
          typeof payload.error === 'string' ? payload.error.trim() : '';

        // 400 + backend ka apna message = token invalid/expired. Ye user ko
        // dikhana sahi hai kyunki usse pata chalna chahiye ki link expire ho gaya.
        setMessage(
          upstream ||
            'This verification link is invalid or has expired. Please register again.'
        );
      } catch {
        // NOTE: `cancelled` check YAHAN se hata diya gaya hai. Pehle ye
        // fetch ke result ko suppress kar deta tha, jo StrictMode ke saath
        // milkar spinner-forever deadlock create karta tha (comment upar).
        // Ab network error ALWAYS user tak pahunchta hai.
        setStatus('error');
        setMessage(
          'We could not reach the verification service. Please check your connection and try again.'
        );
      }
      })();
    }
    // NOTE: is effect ka koi cleanup NAHI hai - jaan-boojh kar.
    // Pehle `return () => { cancelled = true; }` tha jo result ko suppress
    // kar deta tha. Ab result hamesha apply hota hai.
    //
    // NOTE: `retryNonce` dependencies me hai. Bina iske "Try again" button
    // bekaar tha - sirf `token` par depend karne se effect dobara nahi
    // chalta, kyunki token to badla hi nahi.
  }, [token, retryNonce]);

  // ---- ELAPSED TIMER ----
  //
  // Ye alag effect hai (upar wale se independent) kyunki:
  //   - upar wala API call karta hai (aur StrictMode guard rakhta hai)
  //   - ye sirf UI ka timer chalata hai
  //
  // `status === 'checking'` tak chalta hai, phir ruk jata hai - idle state
  // me timer bekaar chalta rahega to nahi.
  useEffect(() => {
    if (status !== 'checking') return;
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 250); // 4x/sec - enough for a smooth counter, cheap to render
    return () => window.clearInterval(id);
  }, [status]);

  // ---- Checking state: spinner with a HARD TIMEOUT + honest messaging ----
  //
  // ---- YE UX FIX KYUN ZAROORI THA ----
  // Pehle yahan ek bare spinner tha ("Verifying your email address..."),
  // bina kisi timeout ke. Development me FIRST visit par Next.js route ko
  // on-demand compile karta hai, jo measured me ye hai:
  //     page compile  ~6.7s
  //     api  compile  ~2.2s
  //     total spin    ~9 seconds
  // User ko 9 second tak ek khali ghoorta circle dikhta hai - jo "hang ho
  // gaya" ya "fail ho gaya" lagta hai. Wahi feeling thi aapki.
  //
  // Ab teen cheezein beech me hoti hain:
  //   1. `elapsed` state badhta rehta hai - user ko pata rehta hai process
  //      chal raha hai (spinner alone se zyada reassuring)
  //   2. 4 second cross karne par message badal jata hai jo EXACTLY batata
  //      hai ki kya ho raha hai (dev compile), spinner nahi
  //   3. 20 second par HARD timeout - ab ye kabhi nahi ghoorrega. User ko
  //      retry milta hai instead of an eternal spinner
  if (status === 'checking') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />

        {/* ---- Phase 1: normal (0-4s) ---- */}
        {elapsed < 4000 ? (
          <>
            <p className="text-sm text-gray-400">Verifying your email address…</p>
            <p className="text-xs text-gray-500">This usually takes a moment.</p>
          </>
        ) : elapsed < 20000 ? (
          /* ---- Phase 2: long wait (4-20s) ----
              Ye message jaan-boojh kar dev-specific hai. Production me
              build pre-compiled hota hai, to ye phase wahan aayega hi
              nahi - sirf development me. Isliye user ko confuse nahi
              karega production me. */
          <>
            <p className="text-sm text-gray-400">Still working…</p>
            <p className="max-w-sm text-xs leading-relaxed text-gray-500">
              If you are running a development server, the first visit has to
              compile this page, which can take several seconds. You are safe to
              wait.
            </p>
            <p className="text-xs text-gray-600">{Math.floor(elapsed / 1000)}s elapsed</p>
          </>
        ) : (
          // Phase 3: hard timeout (>20s). Ab infinite spinner nahi -
          // user ko actionable retry milta hai.
          <>
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-sm text-gray-200">This is taking too long</p>
            <p className="max-w-sm text-xs leading-relaxed text-gray-500">
              We could not confirm your verification. The link may have expired
              (they last 30 minutes). Request a fresh one below.
            </p>
            <button
              type="button"
              onClick={() => {
                // Promise ref CLEAR karo - taaki naya fetch actually start ho.
                // Bina iske `if (!verifyPromiseRef.current)` condition false
                // rehta aur effect kuch nahi karta.
                verifyPromiseRef.current = null;
                setRetryNonce((n) => n + 1);
                setStatus('checking');
                setElapsed(0);
                setMessage('');
              }}
              className="mt-1 rounded-md border-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-800"
            >
              Try again
            </button>
          </>
        )}
      </div>
    );
  }

  // ---- Success / Awaiting / Error state ----
  const success = status === 'success';
  // Neutral, not a failure. See the `awaiting` state comment above: this is the
  // screen a freshly-registered user lands on, and colouring it red was telling
  // them their signup failed when it had not.
  const awaiting = status === 'awaiting';

  return (
    <div className="space-y-5">
      <div
        role="status"
        className={`flex items-start gap-3 rounded-md p-4 text-sm ${
          success
            ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300'
            : awaiting
              ? 'border-sky-800/60 bg-sky-950/30 text-sky-200'
              : 'border-red-700/60 bg-red-950/40 text-red-300'
        }`}
      >
        {success ? (
          <CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0" />
        ) : awaiting ? (
          <MailCheck className="mt-0.5 h-2.5 w-2.5 shrink-0" />
        ) : (
          <AlertCircle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
        )}
        <div className="min-w-0 space-y-1">
          <p className="font-medium leading-relaxed">
            {success
              ? 'Email verified'
              : awaiting
                ? 'Check your inbox'
                : 'Verification failed'}
          </p>
          <p className="leading-relaxed opacity-90">
            {message ||
              // `awaiting` has no server message - nothing was submitted - so
              // the copy is written here. Naming the address is what makes it
              // actionable: the user can go find that exact inbox.
              (awaiting && emailToResend
                ? `We sent a verification link to ${emailToResend}. Open it to confirm your address. The link expires in 30 minutes.`
                : 'Open the verification link we emailed you to confirm your address.')}
          </p>
          {success && email ? (
            <p className="pt-1 text-xs opacity-75">
              Verified address: <span className="font-medium">{email}</span>
            </p>
          ) : null}
        </div>
      </div>

      {/* ---- RESEND VERIFICATION (failure state me) ----
          User ka requirement: "jahan Too Many Attempts likha ho, wahan resend
          verification email bhejne ka button ho".

          Ye block EXACTLY wahi cover karta hai:
            - token missing / expired / invalid  (common case)
            - "Too many attempts" 429            (rate limit - jiska
                                                   complaint aaya tha)

          KYUN ZAROORI: token 30 min me expire ho jata hai, aur uske baad
          account purge ho jata hai. Bina resend ke user ko naya account
          banana padta tha - purana username/email dobara use kar sakta tha.

          `emailToResend` wo email hai jiske liye token verify hone ki koshish
          ho rahi hai. Ye tab available hota hai jab page `?email=` query
          param ke saath khula ho (verification email ka link isse aata
          hai) - tab user ko email type nahi karni padti.

          Agar email pata nahi hai, to input field render hota hai jisme user
          apni email daal sakta hai. Backend email enumeration nahi karta
          (same 200 har case me), isliye ye safe hai.

          Hinglish: verification fail ya 429 ho to yahan resend button
          dikhta hai - user email miss kare to recover kar sakta hai.

          NOTE: condition `!success` hai, yaani ye `awaiting` (naya token
          abhi aaya hi nahi) par bhi dikhta hai. Ye jaan-boojh kar rakha hai:
          registration ke turant baad user yahan aata hai, aur agar email
          inbox me nazar nahi aayi to uske paas turant doosra option hona
          chahiye. Resend se naya link aane me kuch second lagte hain - us
          deriye screen ko blank nahi chhodna chahiye. */}
      {!success ? (
        <ResendPanel initialEmail={emailToResend} />
      ) : null}

      {/* ---- SUCCESS: login page, with `?next=` carried through ----
       *
       * Ye link do baar badal chuka hai, aur dono baar galat wajah se:
       *
       * 1. PEHLE ye hardcoded `/auth/login` tha - theek tha.
       * 2. PHIR maine ise `?next=` destination par bada diya, ye sochkar ki
       *    "user pehle se signed in hai, dobara login bekaar hai". Ye galat tha.
       *
       * Kyun galat tha: register ke waqt jo session milta hai, wo account ke
       * UNVERIFIED state me bana hai. Verification link kholne ke baad usi
       * session ko lekar seedha `destination` (dashboard) par jaate, aur
       * middleware use turant `/auth/security-setup` par bhej deti - 6-digit PIN
       * form. Yaani credentials wala step POORA skip ho jata tha. User ko
       * "binaye login kiye seedha PIN" dikha, jabki usne kabhi authenticate hi
       * nahi kiya tha apne naye account par.
       *
       * SPEC order ye maangta hai: email verify -> LOGIN -> security setup -> app.
       * Verification sirf ye prove karta hai ki email address chala user ka
       * hai. Uski pehchan tabhi banti hai jab wo password daal ke login kare.
       * Bina credentials ke 6-digit PIN set karna isi liye galat hai - wo
       * account par control ka pehla ASLI proof nahi hai, sirf ek extra lock
       * hai jo kisi aur ne bhi lagayi ho sakti hai.
       *
       * `?next=` zaroor bacha diya gaya hai, taaki login ke baad user apni
       * destination par pahunche (editor ka gate yehi bhejta hai) - dashboard
       * par force nahi kiya jaata.
       */}
      {success ? (
        <Link href={loginHref} className={PRIMARY_BUTTON_CLASS}>
          Continue to log in
        </Link>
      ) : awaiting ? null : (
        <Link href="/auth/register" className={PRIMARY_BUTTON_CLASS}>
          Register again
        </Link>
      )}
    </div>
  );
}

/**
 * ResendPanel - resend verification email form.
 *
 * Alag component isliye ki verify page ka main flow saaf rahe aur resend
 * ka apna state + loading + retry handling alag rahe.
 *
 * STATES:
 *   idle     -> email input (agar email pata na ho) + Resend button
 *   sending  -> "Sending…" (button disabled, spinner)
 *   sent     -> green confirmation
 *   error    -> red message (429 par "wait karke try karo" + retry hint)
 *
 * RATE LIMIT NOTE: 429 aane par `retryAfter` seconds dikhate hain jo
 * backend `Retry-After` header se aata hai. Button turant active rehta hai
 * taaki user wait karke retry kar sake.
 */
function ResendPanel({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  );
  const [feedback, setFeedback] = useState('');
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) return;

    setState('sending');
    setFeedback('');
    setRetryAfter(null);

    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 429) {
        // Rate limited - user ko EXACTLY bataye kitna wait karna hai
        const secs = Number(data?.retryAfter) || 60;
        setRetryAfter(secs);
        setState('error');
        setFeedback(
          data?.message ??
            `Too many resend attempts. Please wait ${secs} seconds and try again.`
        );
        return;
      }

      if (!res.ok) {
        setState('error');
        setFeedback(
          data?.message ?? 'Could not send a new email. Please try again.'
        );
        return;
      }

      // Success. Backend intentionally generic message deta hai (email
      // enumeration prevention) - isliye hum bhi wahi honest rahein.
      setState('sent');
      setFeedback(
        data?.already_verified
          ? 'This account is already verified. You can log in now.'
          : (data?.message ??
            'If an unverified account exists for that address, a fresh verification email has been sent.')
      );
    } catch {
      setState('error');
      setFeedback(
        'Network error. Please check your connection and try again.'
      );
    }
  }

  // Sent ho gaya: success message + done
  if (state === 'sent') {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 rounded-md border-700/60 bg-emerald-950/40 p-3 text-xs text-emerald-300">
          <Send className="mt-0.5 h-2.5 w-2.5 shrink-0" />
          <p className="leading-relaxed">{feedback}</p>
        </div>
        <p className={`text-[11px] leading-relaxed ${grafanaTextMuted}`}>
          Your previous verification link is no longer valid - only the newest
          email link will work. The new link is valid for 30 minutes.
        </p>
        <button
          type="button"
          onClick={() => {
            setState('idle');
            setFeedback('');
          }}
          className={`text-xs ${grafanaTextMuted} underline transition-colors hover:${grafanaText}`}
        >
          Send another email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleResend} className="space-y-3">
      <div className={`flex items-start gap-2.5 rounded-md ${productSunken}/50 p-3`}>
        <Send className={`mt-0.5 h-2.5 w-2.5 shrink-0 ${grafanaTextMuted}`} />
        <div className="min-w-0 flex-1 space-y-2.5">
          <p className={`text-xs leading-relaxed ${grafanaText}`}>
            Didn&apos;t get the email, or did it expire?
          </p>

          {/* Email input sirf tab jab email pata na ho.
              Agar `?email=` se aaya hai to prefill hai - user ko type nahi. */}
          {!initialEmail ? (
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              className={`h-10 w-full rounded-md ${productSunken} px-3 text-sm ${grafanaText} placeholder:${grafanaTextMuted}/60 focus:${grafanaPrimary} focus:outline-none focus:ring-2 focus:ring-[#5794f2]/30`}
            />
          ) : null}

          <button
            type="submit"
            disabled={state === 'sending' || !email.trim()}
            className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-md ${productPanelHover} text-sm font-medium ${grafanaText} transition-colors hover:${productSeparation} ${grafanaFocusRingVisible} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {state === 'sending' ? (
              <>
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send className="h-2.5 w-2.5" />
                Resend verification email
              </>
            )}
          </button>

          {/* Error / rate-limit message.
              429 par retryAfter seconds dikhate hain taaki user ko pata ho
              EXACTLY kitna wait karna hai (rather than guessing). */}
          {state === 'error' && feedback ? (
            <div className="rounded-md border-700/50 bg-amber-950/30 p-2.5">
              <p className="text-[11px] leading-relaxed text-amber-300">
                {feedback}
              </p>
              {retryAfter ? (
                <p className="mt-1 text-[10px] text-amber-400/80">
                  Try again in about {retryAfter} second
                  {retryAfter === 1 ? '' : 's'}.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </form>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell
      title="Email verification"
      description="Confirm your email address to activate your Wideo11 account."
      footer={
        <p className="text-center text-sm text-gray-400">
          Already verified?{' '}
          <Link
            href="/auth/login"
            className="font-medium text-blue-400 transition-colors hover:text-blue-300"
          >
            Log in
          </Link>
        </p>
      }
    >
      <Suspense
        fallback={
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-sm text-gray-400">Verifying your email address…</p>
          </div>
        }
      >
        <VerifyContent />
      </Suspense>
    </AuthShell>
  );
}

