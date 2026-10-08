// Registration page - /auth/register
//
// REDESIGN: Ab ye page shared AuthShell component use karta hai, jo login page
// ke SAATH share hota hai. Isse width (max-w-[450px]), height (h-[500px]),
// padding, brand header aur color palette BY CONSTRUCTION identical hain - pehle
// har page apna markup likhta tha aur styling drift ho jati thi.
//
// BOX-SIZING OWNERSHIP (is page ka apna koi wrapper NAHI hai):
//   Ye page koi root wrapper `<div>` render NAHI karta - `<AuthShell>` hi
//   outermost element hai. Isliye box-model refactor yahan nahi, balki
//   `components/auth/auth-shell.tsx` me kiya gaya hai:
//     - Card par `box-content` (content-box) - 500px ab sirf content ka
//       budget hai, uske bahar.
//     - Page wrapper par `box-border` PIN kiya gaya hai, kyunki uska
//       `min-h-screen` (100vh) + `py-6 sm:py-8` padding hai - content-box
//       hota to 100vh + 48/64px ho jata aur har page par scrollbar aa jata.
//   Is page ka kaam sirf apne andar ka vertical rhythm hai: STRICT
//   SINGLE-COLUMN stack (har field apni line pe, `space-y-4`) aur 44px
//   (`h-11`) inputs jo `design-system.ts` ke `input` token se match karte hain.
//
// LAYOUT MANDATE (enforced, non-negotiable):
//   - 2-column grids POORI TARAH hata di gayi hain. Is page par ab koi
//     `grid` / `sm:grid-cols-2` class nahi hai - ek bhi nahi.
//   - Har `<Field>` ab `<form>` ka DIRECT child hai, to `FORM_SPACING`
//     (`space-y-4`, 16px) har field ke beech uniform vertical gap deta hai.
//   - Card fixed-height NAHI hai - height content-driven hai, aur AuthShell
//     ka wrapper `py-[20vh]` se breathing room deta hai. Isliye 16px gap
//     comfortably fit hota hai (pehle `h-[500px]` fixed card par 8px gap
//     zaroori tha, warna submit button cut ho jata tha).
//
// RETAINED LOGIC (pichle version se, kuch nahi hataya):
//   - Dual sync show/hide (koi bhi eye icon DONO password fields toggle kare)
//   - Dynamic password strength meter (Shadcn Progress use kiya)
//   - Submit disabled jab tak valid + match + strength green na ho
//   - Submit click par instant freeze + spinner
//   - Brand logo via next/image from /brand.svg
//
// NEW (SPEC): Biometric checkbox sirf tab dikhta hai jab device me ASSLI sensor ho.
// karta to disabled state me render hota hai + "Unavailable" badge.
//
// NOTE (single column): biometric panel ki idle helper line ab render nahi
// hoti (sirf enrolling/message state me) - ye compactness ke liye hai.
// Detail register page ke biometric panel block me hai.
//
// Hinglish comments: har block ka arth

'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { deviceId } from '@/lib/device-id';
import { Button } from '@wideo11/ui/button';
import { Input } from '@wideo11/ui/input';
import { Checkbox } from '@wideo11/ui/checkbox';
import { Progress } from '@wideo11/ui/progress';
import { Badge } from '@wideo11/ui/badge';
import { AlertCircle, CheckCircle2, Loader2, Eye, EyeOff, ShieldCheck } from 'lucide-react';

import {
AuthShell,
Field,
INPUT_CLASS,
PRIMARY_BUTTON_CLASS,
FORM_SPACING,
} from '@/components/auth/auth-shell';
import { type BiometricMethod, type BiometricDiagnostics } from '@/lib/webauthn';
// Click tracking + security audit (staff trap)
import { reportSecurityViolation } from '@/lib/audit-tracking';
// `?next=` ko safe internal path me convert karne ke liye - absolute URL ya
// `//evil.com` jaisa value open-redirect ban sakta hai.
import { safeNext } from '@/lib/safe-next';

// Strength levels: 0 = empty, 4 = strong (green)
type Strength = 0 | 1 | 2 | 3 | 4;

export default function RegisterPage() {
// ---- Click tracking ----
// `GlobalActivityTracker` already captures every click on this page, from
// `app/layout.tsx`. A second `useClickTracking` here used to write every click
// twice, and this file's version omitted `surface` and `element_id` - so the
// duplicate rows landed with a null surface. One mount point: the layout.

// ---- Form field states ----
// NOTE: `fullName` state HATA diya. Field remove hone ke baad ye sirf
// ek orphan variable ban gaya tha. Submit payload me ab hardcoded
// `fullName: ''` jaata hai (backend optional kar chuka hai).
const [username, setUsername] = useState('');
const router = useRouter();

const [email, setEmail] = useState('');
// Registration ke waqt ka email, submit ke baad form clear hone se pehle capture
// kar liya gaya. Verification screen ko ye chahiye taki user ko email type na
// karni pade (resend panel `?email=` se prefill hota hai), aur success redirect
// me bhi yehi value lagti hai.
const [registeredEmail, setRegisteredEmail] = useState('');
const [password, setPassword] = useState('');
const [confirmPassword, setConfirmPassword] = useState('');
const [acceptedTerms, setAcceptedTerms] = useState(false);
const [enableBiometric, setEnableBiometric] = useState(false);

// ---- DUAL SYNC password visibility ----
// EK state dono fields control karta hai. Isliye koi bhi eye icon dabao to
// DONO password fields ek saath show/hide ho jayenge (spec requirement).
const [showPassword, setShowPassword] = useState(false);

// ---- Validation + submit state ----
const [touched, setTouched] = useState<Record<string, boolean>>({});
const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
const [message, setMessage] = useState('');

// ---- Biometric capability ----
// Checkbox HAMESHA render hoga. Unsupported device par disabled + badge.
const [biometricSupported, setBiometricSupported] = useState(false);
const [biometricEnrolling, setBiometricEnrolling] = useState(false);
const [biometricMessage, setBiometricMessage] = useState('');
// WebAuthn diagnostic report - jisme user-READABLE reason hota hai ki
// biometric kyun available hai ya nahi. Register form me iska use: jab user
// checkbox nahi dekh raha, to usse pata chale KYA fix karna hai
// (localhost vs LAN IP, browser support, Windows Hello setup).
const [biometricDiag, setBiometricDiag] = useState<BiometricDiagnostics | null>(null);
// Kaunsa method chuna hai - 'face' ya 'fingerprint'
// Default 'face': Windows Hello laptop pe face unlock zyada common hai
  const [biometricMethod, setBiometricMethod] = useState<BiometricMethod>('face');
  // Biometric help popover khula hai ya nahi.
  // Reference component me ye state THA but sirf hover ke liye use hota tha
  // (touch devices par hover hota hi nahi). Maine ise click-toggle bana diya
  // hai + Escape-to-close, kyunki hover-only affordance keyboard aur touch
  // dono par inaccessible hai (WCAG 1.4.13).
  const [showBiometricHelp, setShowBiometricHelp] = useState(false);

// ---- Success alert auto-dismiss ----
// SPEC: "account created" alert 5 second baad AUTOMATICALLY vanish (unmount)
// ho jana chahiye. Isliye jab success aata hai hum 5 second ka timer
// lagate hain aur uske baad message ko null kar dete hain - jisse React
// us block ko UNMOUNT kar deta hai.
// Hinglish: success alert 5 second baad apne aap hat jata hai
useEffect(() => {
  if (status !== 'success' || !message) return;

  // ---- GO SOMEWHERE AFTER SUCCEEDING ----
  //
  // Ye pehle sirf 5 second wait karke message mitata tha aur form ko khaali
  // kar deta tha. Registration POORI ho chuki hoti hai - session cookie set
  // ho chuka hai, user signed in hai - aur phir bhi screen par kuch nahi
  // hota tha. User ke liye iska matlab hi ye hota hai: "maine register kiya,
  // login nahi hua, pipeline atak gaya."
  //
  // ---- AB YE `?next=` DESTINATION PAR JATA HAI, `?next=` DIKHATE HUYE ----
  //
  // DO STEP ZAROORI HAIN, warna verification skip ho jata hai:
  //
  //   1. Register ke baad auth-service ek valid session token deta hai (uska
  //      `exp` future me hota hai). Toh middleware ka JWT check pass hota hai.
  //   2. Naye account par `setup_complete` `false` hota hai. Pehle yahan seedha
  //      `/dashboard` jaate the, jahan middleware user ko security-setup par
  //      bhej deti thi - yaani 6-digit PIN form, bina email verify kiye.
  //
  // SPEC order ye hai: EMAIL VERIFY -> SECURITY SETUP -> app. Isliye ab
  // verification screen par bhejte hain jahan user link kholta hai. Uske baad
  // middleware unverified user ko security setup par pahunchne hi nahi deti.
  //
  // `?next=` (video-editor ka gate bhejta hai) ko aage `?next=` me bacha diya
  // gaya hai, taaki verification ke baad user seedhe editor par wapas pahunche,
  // dashboard par nahi.
  const params = new URLSearchParams(window.location.search);
  const destination = safeNext(params.get('next'));

  const verify = new URLSearchParams({ next: destination });
  if (registeredEmail) verify.set('email', registeredEmail);

  const timer = setTimeout(() => {
    router.push(`/auth/verify?${verify.toString()}`);
    router.refresh();
  }, 1200);

  return () => clearTimeout(timer);
}, [status, message, router, registeredEmail]);

useEffect(() => {
  // window sirf client side pe exist karta hai, isliye useEffect + state
  // use kiya hai (SSR hydration mismatch nahi hoga)
  //
  // REGISTRATION-TIME CAPABILITY CHECK (SPEC):
  // Sirf `!!window.PublicKeyCredential` se pata nahi chalta ki device me
  // ASSLI fingerprint/face sensor hai ya nahi - kai browsers me API hoti
  // hai par hardware nahi hota.
  // Isliye hum `isUserVerifyingPlatformAuthenticatorAvailable()` use karte
  // hain jo ACTUAL hardware presence check karta hai.
  //
  // SPEC: agar device me biometric NAHI hai to checkbox BHI DISPLAY NAHI hoga
  // (disabled placeholder nahi) - checkbox jo kabhi kaam nahi kar sakta wo
  // user ko sirf confuse karta hai.
  // Hinglish: asli sensor check karo, nahi hai to checkbox chhupa do
  //
  // NOTE: ab `diagnoseBiometrics` use ho raha hai (same helper jo security
  // gate me hai) taaki dono jagah EXACT same logic chale. Pehle ye inline
  // boolean check tha, jo bina reason bataye `false` de deta tha.
  const checkBiometric = async () => {
    const { diagnoseBiometrics } = await import('@/lib/webauthn');
    const diag = await diagnoseBiometrics();
    setBiometricDiag(diag);
    setBiometricSupported(diag.canUseBiometrics);
  };

  checkBiometric();
}, []);

// ---- ESCAPE-TO-CLOSE: biometric help popover ----
// Accordion/collapse patterns me standard behaviour hai: jab popover khula ho
// aur user Escape dabaye, wo band ho jata hai.
//
// `keydown` document-level pe sunna zaroori hai, sirf button pe nahi - kyunki
// jab focus popover ke andar kisi text pe hota hai, button pe keydown nahi
// fire hoga. Ye captured-phase listener hai (`true` = capture) taaki koi
// beech me `stopPropagation()` na kar de.
//
// NOTE: ye SIRF tab attached hai jab popover khula ho (`showBiometricHelp`).
// Band hone par listener automatically detach ho jata hai - isliye har keypress
// pe iska overhead nahi hai.
// Hinglish: popover khula ho aur Escape dabao -> band. Standard, accessible.
useEffect(() => {
  if (!showBiometricHelp) return;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setShowBiometricHelp(false);
  };
  // capture=true: har phase me suno, beech me koi rok nahi sakta
  document.addEventListener('keydown', onKeyDown, true);
  return () => document.removeEventListener('keydown', onKeyDown, true);
}, [showBiometricHelp]);

// ---- Password strength (4 checks) ----
// Length >= 12, lowercase, uppercase, digit/symbol.
// Sirf 4 (green) par hi submit unlock hota hai.
const strength = useMemo<Strength>(() => {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4) as Strength;
}, [password]);

// Strength indicator ka text
const strengthLabel = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][strength];

// ---- Validation ----
// USERNAME: public handle. Ye channel URL me dikhta hai, isliye rules tight:
// 3-30 chars, sirf lowercase letters / digits / `_` / `.` / `-`.
// NOTE: ye EXACTLY same rules hain jo backend `service.Register` aur
// web proxy dono lagate hain. Teen jagah same rule rakhna zaroori hai -
// warna user client pass ho jaye aur server reject kare.
const usernameError = !username
  ? 'Username is required'
  : !/^[a-z0-9._-]{3,30}$/.test(username)
  ? '3-30 characters: letters, numbers, _ . or -'
  : null;

const emailError = !email
  ? 'Email is required'
  : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ? null
  : 'Enter a valid email address';

const passwordError = !password
  ? 'Password is required'
  : password.length < 12
  ? 'Use at least 12 characters'
  : null;

const confirmError = !confirmPassword
  ? 'Please confirm your password'
  : confirmPassword !== password
  ? 'Passwords do not match'
  : null;

// ---- Submit enablement ----
// Sab valid + match + strength GREEN + terms accepted
const isFormValid =
  !usernameError &&
  !emailError &&
  !passwordError &&
  !confirmError &&
  acceptedTerms &&
  strength === 4 &&
  status !== 'submitting' &&
  status !== 'success';

// Field touched mark karo (tabhi error dikhate hain)
const markTouched = (field: string) =>
  setTouched((prev) => ({ ...prev, [field]: true }));

const showError = (field: string, err: string | null) =>
  touched[field] ? err : null;

// WebAuthn device enrollment - browser authenticator call karta hai
//
// ---- YE AB PRE-REGISTER CALL NAHI HAI ----
// Pehle ye form submit se PEHLE call hota tha, `undefined` auth header ke
// saath. Wo STRUCTURALLY IMPOSSIBLE tha:
//   - WebAuthn endpoints (auth-service me) authenticated hain
//   - registration ke waqt user ka koi session hota hi nahi
//   - to `register/begin` par 401 -> "Could not start biometric registration"
//
// Ab enrollment registration KE BAAD hoti hai, jab:
//   - backend ne tokens return kiye (register response me)
//   - proxy ne `wideo11_session` cookie set kar di
//   - to proxy cookie se token uthakar authenticated call kar pata hai
//
// Hinglish: pehle login ke bina hi biometric puchh rahe the (impossible);
// ab register hone ke baad, jab session ban chuka ho.
async function enrollBiometricAfterRegistration(): Promise<string | null> {
  const { registerCredential } = await import('@/lib/webauthn');
  // `undefined` = koi header nahi; proxy httpOnly cookie se token uthayega.
  const result = await registerCredential(email.trim().toLowerCase(), undefined, biometricMethod);
  if (!result.ok) {
    return result.message;
  }

  // Backend ko batado ki credential enroll ho gaya - tabhi `biometric_registered`
  // flag set hota hai aur security setup recompute hota hai.
  try {
    await fetch('/api/auth/security/biometric/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch {
    // Is failure ko fatal mat samjho - credential device par enroll ho chuka
    // hai. Security gate me userdobara enroll kar sakta hai.
  }
  return null;
}

// ---- Form submit ----
async function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();

  // Sab fields touched mark karo taaki saare errors ek saath dikhayein
  // NOTE: `name` key hata di - ab full name field exist nahi karta.
  setTouched({ username: true, email: true, password: true, confirm: true });

  if (!isFormValid) return;

  // Instant freeze + spinner (multi-hit DDoS protection)
  setStatus('submitting');
  setMessage('');

  // =============================================================================
// THE DEVICE FINGERPRINT GOES FROM HERE, NOT FROM THE API ROUTE
// =============================================================================
//
// The obvious place to attach it was `api/auth/register/route.ts`, and that was
// where it was first written — where it does not work, because that is a SERVER
// route and `deviceId()` reads `localStorage`.
//
// `deviceId()` returns `null` when `typeof window === 'undefined'`, so the header
// was never sent, `ClaimTrial("")` returned "granted" without writing, and
// `trial_devices` stayed empty through a full register/verify cycle. The browser
// check caught it: the trial was granted and the registry had zero rows.
//
// The fingerprint is therefore minted HERE, in the browser, and forwarded by the
// route. The route's `deviceId()` call stays as a fallback for API clients that
// do not send one — it will still return null server-side, and that is the
// documented "no fingerprint, allow" path rather than a silent second attempt.
const fingerprint = deviceId();

try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Read server-side by auth-service to enforce one-trial-per-BROWSER.
        // Omitted when storage is blocked; auth-service then allows the trial, which
        // is the right call — see `lib/device-id.ts` for why that is a decision
        // rather than a loophole.
        ...(fingerprint ? { 'X-Fingerprint': fingerprint } : {}),
      },
      body: JSON.stringify({
        // NOTE: `fullName` ab empty string jaata hai. Backend ne ise optional
        // kar diya hai, to ye valid hai. User apna display naam baad me
        // profile me bhar sakta hai.
        fullName: '',
        // Username lowercase + trim bhejte hain - backend bhi yahi karta hai.
        // Isse "Taken" vs "taken" ka mismatch nahi hoga.
        username: username.trim().toLowerCase(),
        // NEW (migration 004): device me biometric sensor hai ya nahi, ye
        // backend ko batana zaroori hai. Bina iske backend assume karta hai
        // ki sensor hai (strict default), aur jiske device me sensor nahi
        // hai wo security gate me permanently phas jata - kyunki wo enroll
        // hi nahi kar sakta.
        // `biometricSupported` client-side WebAuthn check ka result hai.
        biometricCapable: biometricSupported,
        email: email.trim().toLowerCase(),
        password,
        enableBiometric,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (response.ok) {
      setStatus('success');
      setRegisteredEmail(email.trim().toLowerCase());
      setMessage(
        payload.message ??
          'Account created. Please check your email to verify your address within 30 minutes.'
      );

      // ---- BIOMETRIC ENROLLMENT (AB SESSION KE BAAD) ----
      // Agar user ne "Enable biometric" tick kiya tha, to ab enroll karo.
      // Ye tabhi possible hai kyunki ab `wideo11_session` cookie set ho chuki
      // hai (proxy ne registration response pe set ki) - isliye WebAuthn ke
      // authenticated endpoints call ho sakte hain.
      //
      // NOTE: ye AWAIT nahi karta main success path se - message foran
      // dikhana zaroori hai, enrollment background me chalta hai. Par error
      // aaye to user ko pata chalna chahiye, isliye state update hota hai.
      if (enableBiometric) {
        setBiometricEnrolling(true);
        void enrollBiometricAfterRegistration().then((err) => {
          setBiometricEnrolling(false);
          if (err) {
            setBiometricMessage(`Biometric setup failed: ${err}`);
            // User ko gate me bhej do jahan wo dobara try kar sake
            setMessage(
              `Account created, but biometric enrollment failed: ${err}. You can enable it from your security settings after verifying your email.`
            );
          } else {
            setBiometricMessage('Biometric enrolled on this device.');
          }
        });
      }
      return;
    }

    if (response.status === 429) {
      setStatus('error');
      setMessage(
        'Too many attempts from this network. Please wait 60 seconds and try again.'
      );
      // STAFF TRAP: rate limit breach = possible automation/bypass attempt.
      // Ye report master dashboard ke "Awareness Reports" me RED alert banata hai.
      // Hinglish: rate limit toota to security violation report karte hain
      reportSecurityViolation(
        'RATE_LIMIT_BYPASS_ATTEMPT',
        `Registration rate limit breached from ${navigator.userAgent.slice(0, 80)}`
      );
      return;
    }

    if (response.status === 409) {
      setStatus('error');
      setMessage('An account with this email address already exists.');
      return;
    }

    setStatus('error');
    setMessage(payload.error ?? payload.message ?? 'Registration failed. Please try again.');
  } catch {
    setStatus('error');
    setMessage('Network error. Please check your connection and try again.');
  }
}

return (
  <AuthShell
    title="Create your account"
    description="Free to begin, no card required."
    footer={
      <p className="text-center text-sm text-[#9fa7b3]">
        Already have an account?{' '}
        <Link
          href="/auth/login"
          className="font-medium text-blue-400 transition-colors hover:text-blue-300"
        >
          Log in
        </Link>
      </p>
    }
  >
    <form onSubmit={handleSubmit} noValidate className={FORM_SPACING}>
      {/* ---- FIELD 1: Username ----
          Hinglish: ye pehla field hai. Public handle jo channel URL me
          dikhega (jaise /@aarav). Rules: 3-30 chars, sirf lowercase letters,
          digits, `_`, `.`, `-`.

          NOTE: `maxLength={30}` native browser limit lagata hai, aur
          `autoCapitalize="none"` + `spellCheck={false}` mobile par auto-
          correction/capitalization rokta hai - warna user "Aarav" type kare
          aur hum use lowercase karke "taken" error dikha dein (confusing).

          `pattern` attribute bhi rakha hai - native browser validation
          (`noValidate` ki wajah se ye actually trigger nahi hota, par
          semantics/screen-reader ke liye helpful hai). */}
      <Field
        id="username"
        label="Username"
        error={showError('username', usernameError)}
      >
        <Input
          id="username"
          type="text"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={30}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onBlur={() => markTouched('username')}
          placeholder="aarav"
          className={INPUT_CLASS}
          aria-invalid={Boolean(touched.username && usernameError)}
        />
      </Field>

      {/* ---- FIELD 2: Email address (single column) ----
          Hinglish: `space-y-3` (12px) har field ke beech uniform gap deta hai. */}
      <Field id="email" label="Email address" error={showError('email', emailError)}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => markTouched('email')}
          placeholder="you@example.com"
          className={INPUT_CLASS}
          aria-invalid={Boolean(touched.email && emailError)}
        />
      </Field>

      {/* ---- FIELD 3: Password (single column) ----
          Hinglish: password + confirm ab apni-apni line pe hain. Grid
          wrapper hata diya gaya, to strength meter ab poore width ka
          dikhta hai (pehle 2-column me narrow tha). */}
      {/* Password + eye icon #1 */}
      <Field id="password" label="Password" error={showError('password', passwordError)}>
        <div className="relative">
          <Input
            id="password"
            // Shared state - dono fields ek saath toggle hote hain
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => markTouched('password')}
            placeholder="12+ characters"
            className={`${INPUT_CLASS} pr-10`}
            aria-invalid={Boolean(touched.password && passwordError)}
          />
          {/* Pehla eye icon - DONO password fields toggle karta hai */}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
            className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#9fa7b3] transition-colors hover:text-[#d8d9da] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            {showPassword ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
          </button>
        </div>

        {/* ---- Password strength meter ----
            Shadcn `Progress` primitive. Bar + label ek hi row me (~18px).

            ---- UX FIX: empty state me CHHUPANA ----
            Screenshot ne dikhaya: page load hote hi "Too short" + ek khaali
            (grey) bar dikh raha tha, jabki user ne abhi EK CHARACTER bhi nahi
            likha tha. Ye:
              - galat feedback deta hai (lagta hai password weak hai, jabki
                password hi nahi hai)
              - form ko extra height kharch karata tha
            Isliye ab meter SIRF tab render hota hai jab `password` non-empty
            ho. Pehla character type karte hi meter + label appear ho jaate
            hain, aur `space-y-*` automatically adjust ho jaata hai kyunki ye
            `Field` ke andar hai (form-level spacing nahi badalti).

            Colour logic unchanged: 0 = red, 2 = orange, 3 = amber, 4 = emerald.
            Hinglish: kuch type karne se pehle strength meter nahi dikhta. */}
        {password.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <Progress
              // Shadcn Progress sirf ek value leta hai - isliye 4 segments
              // ko ek single percentage me convert kiya gaya hai (0/25/50/75/100)
              value={(strength / 4) * 100}
              className={`h-1 flex-1 ${
                strength === 4
                  ? '[&>div]:bg-emerald-500'
                  : strength >= 3
                  ? '[&>div]:bg-amber-400'
                  : strength >= 2
                  ? '[&>div]:bg-orange-400'
                  : '[&>div]:bg-red-500'
              }`}
            />
            <p
              className={`shrink-0 text-[10px] font-medium leading-none transition-colors ${
                strength === 4
                  ? 'text-emerald-400'
                  : strength >= 3
                  ? 'text-amber-400'
                  : strength >= 2
                  ? 'text-orange-400'
                  : 'text-[#9fa7b3]'
              }`}
            >
              {strengthLabel}
            </p>
          </div>
        )}
      </Field>

      {/* Confirm password + eye icon #2 (SAME state = synced) */}
      <Field
        id="confirmPassword"
        label="Confirm password"
        error={showError('confirm', confirmError)}
      >
        <div className="relative">
          <Input
            id="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onBlur={() => markTouched('confirm')}
            placeholder="Re-enter password"
            className={`${INPUT_CLASS} pr-10`}
            aria-invalid={Boolean(touched.confirm && confirmError)}
          />
          {/* Doosra eye icon - bhi WAHI state toggle karta hai (synced) */}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
            className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#9fa7b3] transition-colors hover:text-[#d8d9da] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            {showPassword ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
          </button>
        </div>
      </Field>

      {/* ---- Terms & Conditions consent - SIMPLIFIED (single line) ----
          Hinglish: pehle ye ek BORDERED BOX (p-2.5 + + background) tha
          jo ~40px leta tha. Ab plain ek-line row hai (~24px)./box hata
          diya gaya taaki 600px card me jagah bache.
          Checkbox + text ek hi line pe - checkbox `mt-0` se text ke saath
          baseline align hota hai (multi-line wrap hone par bhi theek).
          NOTE: ye abhi bhi ZAROORI hai - `isFormValid` me `acceptedTerms`
          shamil hai, to submit button bina tick ke disabled rahega. */}
      <div className="flex items-start gap-2">
        <Checkbox
          id="terms"
          checked={acceptedTerms}
          onCheckedChange={(v) => setAcceptedTerms(v === true)}
          className="mt-px-[#3d4348] data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600"
        />
        <label
          htmlFor="terms"
          className="cursor-pointer select-none text-xs leading-snug text-[#9fa7b3]"
        >
          I agree to the{' '}
          <span className="font-medium text-blue-400">Terms &amp; Conditions</span> and{' '}
          <span className="font-medium text-blue-400">Privacy Policy</span>
        </label>
      </div>

      {/* ---- BIOMETRIC - SIMPLIFIED to a single line ----
          Pehle ye ek BORDERED PANEL tha jisme:
            - checkbox + label row
            - helper/status paragraph
            - method selector (Face / Fingerprint buttons)
            - "?" help button + expandable help panel
          Total ~90-100px. 600px card me ye bahut zyada tha.

          AB: ek single compact row - [checkbox] Enable biometric  [?]
          Methods (Face/Fingerprint) ka separate selector HATA diya.
          KYUN ye theek hai: WebAuthn browser/device ko exact modality force
          karne nahi deta - jab bhi tum checkbox tick karte ho, device ka
          APNA Windows Hello / Touch ID dialog khulta hai aur wahi decide karta
          hai face lena hai ya fingerprint. Toh pehle se chunne ka UI ka koi
          technical fayda nahi tha, sirf height kharch karta tha.
          Ab device pe jo configured hai wo automatically use hota hai.

          NOTE: ye row SIRF tab render hoti hai jab `biometricSupported` true ho
          (device me asli platform authenticator hai). Sensor nahi hai to row
          chhup jati hai - disabled placeholder dikhana confuse karta hai.
          Hinglish: ek line me checkbox + label + help. Methods chhup gaye. */}
      {biometricSupported && (
        <div className="space-y-1">
          {/* Row 1: [checkbox] label [?] -- single line */}
          <div className="flex items-center gap-2">
          <Checkbox
            id="biometric"
            checked={enableBiometric}
            disabled={biometricEnrolling}
            onCheckedChange={async (v) => {
              // ---- CHECKBOX AB SIRF FLAG SET KARTA HAI ----
              // Pehle yahan turant device enrollment shuru hoti thi. Wo
              // IMPOSSIBLE tha - registration ke waqt koi session nahi hota,
              // to WebAuthn ke authenticated endpoints 401 dete the aur user
              // ko "Could not start biometric registration" dikhta tha.
              //
              // Ab checkbox sirf `enableBiometric` flag set karti hai, aur
              // ACTUAL enrollment registration submit hone ke BAAD hoti hai
              // (jab session cookie ban chuki ho). Dekho
              // `enrollBiometricAfterRegistration()`.
              setEnableBiometric(v === true);
              if (v !== true) {
                setBiometricMessage('');
              } else {
                setBiometricMessage(
                  'Biometric will be enrolled on this device right after you create your account.'
                );
              }
            }}
            className="mt-px shrink-0-[#3d4348] data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600 disabled:opacity-50"
          />
          <label
            htmlFor="biometric"
            className="min-w-0 flex-1 cursor-pointer select-none text-xs font-medium leading-snug text-[#d8d9da]"
          >
            Enable biometric login
          </label>

          {/* ---- BIOMETRIC HELP DISCLOSURE (accessible popup) ----
              Reference component me ek hover-tooltip tha. Maine wo
              JAAN-BOOH kar BUTTON + click-toggle banaya hai, kyunki
              hover-only tooltips 3 accessibility problems create karte hain:

                1. TOUCH DEVICES par hover exist hi nahi hota - phone
                   users ko help kabhi dikhegi hi nahi.
                2. KEYBOARD users par bhi nahi - tab se focus to aata
                   hai par trigger nahi hota.
                3. WCAG 1.4.13 (Content on Hover or Focus) me ye
                   dismissible + hoverable + persistent hona chahiye -
                   plain CSS `group-hover` teeno me fail harta hai.

              Isliye: proper `<button>` + `aria-expanded` + `aria-controls`
              + conditional render. Click karo -> khulta hai, dobara click
              ya Escape -> band. Ye Shadcn `Collapsible` jaisa behaviour hai
              bina extra dependency ke.

              NOTE: ye button hamesha visible rehta hai (state chahe koi bhi
              ho), sirf help PANEL conditional hai - isliye user ko pata
              rehta hai ki help exist karti hai.

              Hinglish: "?" dabaye to help khulti hai, Escape se band. */}
          <button
            type="button"
            onClick={() => setShowBiometricHelp((v) => !v)}
            aria-expanded={showBiometricHelp}
            aria-controls="biometric-help"
            aria-label="About biometric login"
            className="inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full-[#3d4348] text-[10px] font-bold leading-none text-[#9fa7b3] transition-colors hover:text-[#d8d9da] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
          >
            ?
          </button>
        </div>

        {/* ---- Enrollment status (live feedback) ----
            Ye sirf TAB dikhta hai jab enrollment chal raha ho ya result aaya
            ho. Idle state me kuch nahi - card auto-height hai, par extra line
            sirf tabhi aati hai jab zaroorat ho. */}
        {biometricEnrolling || biometricMessage ? (
          <p className="mt-1 text-[11px] leading-snug text-[#9fa7b3]">
            {biometricEnrolling
              ? 'Touch your fingerprint or face to finish setting up...'
              : biometricMessage}
          </p>
        ) : null}

        {/* ---- BIOMETRIC HELP PANEL (conditional) ----
            ---- BUG FIX: ye panel PEHLE GHAAYAB tha ----
            Biometric block simplify karte waqt (Face/Fingerprint method
            selector hataate waqt) ye `{showBiometricHelp ? ... : null}`
            JSX bhi galti se delete ho gaya tha.

            Uska asar: "?" button `onClick` se state toggle to hota tha, par
            render karne ke liye kuch tha hi nahi. User ko button daba kar
            KUCH nahi hota tha - yahi report mila ("? wala kaam nahi kar raha").

            Isliye ab ye panel wapas aa gaya hai, aur `aria-controls` attribute
            (jo pehle ek DANDA (dangling) id ko point kar raha tha) ab ek
            sach me maujood element ko point karta hai. `id="biometric-help"`
            dono jagah MATCH karna zaroori hai - accessibility tooling aur
            keyboard/screen-reader testing dono isi par depend karti hai.

            BEHAVIOUR:
              - "?" click -> khulta hai, dobara click -> band
              - Escape (document-level capture listener) -> band
            Card ab `h-auto` hai, isliye panel khulne se card thoda barha sakta
            hai - jo theek hai, kyunki form ke content ko koi scroll nahi chahiye.
            Text COMPLETE hai - koi "..." truncation nahi. */}
        {showBiometricHelp ? (
          <div
            id="biometric-help"
            role="region"
            aria-label="About biometric login"
            className="mt-1.5 space-y-1.5 rounded-md bg-[#0d0f11]/70 p-2.5"
          >
            <p className="text-[11px] leading-relaxed text-[#9fa7b3]">
              Biometric login uses your device&apos;s own security hardware - a
              fingerprint scanner or a face camera. Your biometric data never
              leaves the device and is never sent to our servers. We only store
              a public key that your device generates.
            </p>
            <p className="text-[11px] leading-relaxed text-[#9fa7b3]">
              This is an addition, not a replacement. Your password keeps
              working, and you can turn biometrics off at any time from
              settings.
            </p>
            <p className="text-[11px] leading-relaxed text-[#9fa7b3]">
              If this checkbox is not showing, your device was not detected as
              having a platform authenticator. Check that you opened the site
              at <span className="font-mono">http://localhost:3000</span> (WebAuthn
              needs HTTPS or localhost - a LAN address like 192.168.x.x will not
              work), and that Windows Hello is set up in Settings &gt; Accounts &gt;
              Sign-in options.
            </p>
          </div>
        ) : null}
      </div>
      )}

      {/* ---- Server message (success / error) ----
          Compact: `p-2` + `text-xs` (~36px). Ye SIRF tab render hota hai
          jab message set ho - idle state me koi height nahi kharch karta.
          Hinglish: idle me ye block nahi dikhta. */}
      {message ? (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-md p-2.5 text-xs ${
            status === 'success'
              ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300'
              : 'border-red-700/60 bg-red-950/40 text-red-300'
          }`}
        >
          {status === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
          )}
          <span className="leading-relaxed">{message}</span>
        </div>
      ) : null}

      {/* Submit - disabled jab tak form valid + strong na ho */}
      <Button
        type="submit"
        disabled={!isFormValid}
        className={`${PRIMARY_BUTTON_CLASS} mt-1`}
      >
        {status === 'submitting' ? (
          <>
            <Loader2 className="mr-2 h-2.5 w-2.5 animate-spin" />
            Creating account
          </>
        ) : status === 'success' ? (
          <>
            <ShieldCheck className="mr-2 h-2.5 w-2.5" />
            Account created
          </>
        ) : (
          'Create account'
        )}
      </Button>
      </form>
    </AuthShell>
  );
}

