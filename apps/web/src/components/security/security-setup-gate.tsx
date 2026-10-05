// Mandatory Security Setup Gate
//
// YE COMPONENT DASHBOARD ENTRY BLOCK KARTA HAI jab tak mandatory security
// setup complete na ho (SPEC requirement):
//   1. 6-digit hidden PIN set karna
//   2. Biometric (WebAuthn) register karna
//   3. Exactly 3 security questions configure karna
//
// TEENO ke bina dashboard render hi nahi hota - gate structurally block karta hai.
// Backend bhi /dashboard jane se pehle security_setup_required check karta hai,
// to ye sirf UI layer nahi, defense-in-depth hai.
//
// Hinglish comments: har block ka arth
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@wideo11/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wideo11/ui/card';
import { Input } from '@wideo11/ui/input';
import { Label } from '@wideo11/ui/label';
import { AlertCircle, CheckCircle2, Fingerprint, KeyRound, Loader2, ShieldCheck, HelpCircle } from 'lucide-react';
import { reportSecurityViolation } from '@/lib/audit-tracking';
// `BiometricDiagnostics` type chahiye state declare karne ke liye.
// `diagnoseBiometrics` runtime pe dynamic import hota hai (load() ke andar)
// taaki ye sirf tab load ho jab gate render ho.
import type { BiometricDiagnostics } from '@/lib/webauthn';

// ---- SECURITY API BASE (same-origin proxy) ----
// Session token httpOnly cookie me hai, isliye browser JS use nahi padh sakta.
// Isliye security calls SAME-ORIGIN proxy (`/api/auth/security/*`) par jaati
// hain, aur token server-side attach hota hai. Isse:
//   - token browser tak nahi aata (XSS safe)
//   - CORS issue zero
// NOTE: pehle ye direct `${AUTH_API}/api/v1/auth/...` par auth-service ko
// jaati thi - jo httpOnly cookie wale architecture ke saath kaam hi nahi
// kar sakti thi (client ke paas token hota hi nahi).
const SECURITY_API = '/api/auth/security';

interface SetupStatus {
  pin_configured: boolean;
  biometric_registered: boolean;
  security_questions_configured: boolean;
  setup_complete: boolean;
  configured_questions: string[];
  required_questions: number;
}

/** Question catalogue - backend se bhi milta hai, ye fallback hai */
const QUESTION_LABELS: Record<string, string> = {
  first_school: 'What was the name of your first school?',
  mother_maiden_name: "What is your mother's maiden name?",
  first_pet_name: 'What was the name of your first pet?',
  childhood_nickname: 'What was your childhood nickname?',
  favourite_teacher: 'Who was your favourite teacher?',
  city_of_birth: 'In which city were you born?',
  first_car: 'What was the make of your first car?',
  mother_favourite_food: "What is your mother's favourite food?",
};

export default function SecuritySetupGate({
  accessToken,
  onComplete,
}: {
  accessToken: string;
  onComplete: () => void;
}) {
  const router = useRouter();
  // Click tracking: `GlobalActivityTracker` in `app/layout.tsx` already captures
  // this page. A second listener here wrote every click twice.

  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // PIN state
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  // ---- PIN CHANGE MODE ----
  // `changingPin` true ho to step 1 "set" nahi, "change" mode me chalta hai:
  //   - current PIN verify karna zaroori (taaki koi logged-in attacker
  //     silently PIN badal na sake)
  //   - new PIN + uska confirm dono chahiye
  //
  // NOTE: ye tab zaroori hai jab user pehle se PIN set karke aata hai
  // (jaise login ke baad security screen kholne par).
  const [changingPin, setChangingPin] = useState(false);
  const [currentPin, setCurrentPin] = useState('');

  // Biometric state
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricDone, setBiometricDone] = useState(false);
  // Full WebAuthn diagnostic report - jisme user-READABLE reason hota hai.
  // Iske bina "biometrics not available" ek black box hai.
  const [biometricDiag, setBiometricDiag] = useState<BiometricDiagnostics | null>(null);

  // Questions state
  const [availableQuestions, setAvailableQuestions] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [answers, setAnswers] = useState<Record<number, string>>({});

  // ---- AUTO-REDIRECT jab setup complete ho ----
  //
  // BUG FIX: pehle ye redirect KABHI nahi hota tha. Gate "Security setup
  // complete. Redirecting to dashboard..." message to dikhata tha, par
  // koi redirect logic hi nahi tha - `onComplete()` sirf button handlers
  // me call hota tha.
  //
  // Result: biometric/skip complete hone ke baad, ya page refresh karne
  // par, ya back button se wapas aane par, user us message par ATKA
  // rehta tha. Dashboard tak pahunchta hi nahi tha.
  //
  // Ye effect har render pe `setup_complete` check karta hai, isliye complete
  // status kaise bhi aaye (fresh load, refresh, back nav) - redirect ho jayega.
  //
  // `redirected` ref isliye hai ki redirect hone ke baad component dobara
  // render ho to user wapas na aaye (double navigation).
  //
  // NOTE: ye hooks component ke TOP LEVEL par hain - loading effect ke
  // andar nahi. Hooks conditional ya nested call nahi hone CHAHIYE, warna
  // "Invalid hook call" error aata hai.
  const redirected = useRef(false);
  useEffect(() => {
    if (status?.setup_complete && !redirected.current) {
      redirected.current = true;
      onComplete();
    }
  }, [status?.setup_complete, onComplete]);

  // ---- Auth headers ----
  //
  // SECURITY FIX: pehle ye unconditional tha:
  //     const authHeaders = { Authorization: `Bearer ${accessToken}` };
  // `/auth/security-setup` page par `accessToken=""` hota hai (token httpOnly
  // cookie me hai, JS nahi padh sakta), isliye ye `Authorization: "Bearer "`
  // bhejta - ek MALFORMED header.
  //
  // Wo string truthy hai, isliye webauthn-proxy me cookie fallback ko override
  // kar deti thi -> auth-service ko empty bearer milta -> 401 ->
  // "Could not start biometric registration".
  //
  // Ab: token na ho to header BILKUL nahi bhejte. Proxy phir httpOnly cookie
  // se token uthata hai - jo secure bhi hai aur hamesha kaam karta hai.
  const authHeaders: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  // ---- Initial load ----
  useEffect(() => {
    async function load() {
      try {
        const [statusRes, qRes] = await Promise.all([
          fetch(`${SECURITY_API}/setup-status`, {
            headers: authHeaders,
            cache: 'no-store',
          }),
          fetch(`${SECURITY_API}/questions/available`, {
            cache: 'no-store',
          }),
        ]);

        const st = await statusRes.json();
        setStatus(st);

        if (qRes.ok) {
          const q = await qRes.json();
          setAvailableQuestions(q.questions ?? []);
        }

        // ---- Step kahan se shuru karein (pehle se done hain to skip) ----
        //
        // BUG FIX: ye logic STEP REORDER ke BAAD stale ho gaya tha.
        //
        // Step order ab: 1 = PIN, 2 = Security Questions, 3 = Biometric.
        // Pehle (purane order me) ye tha: 1 = PIN, 2 = Biometric,
        // 3 = Questions.
        //
        // Stale code me likha tha:
        //     if (pin && questions && !biometric) setStep(2)   // 2 = biometric THA
        //     else if (pin) setStep(2)                        // 2 = biometric THA
        // Aaj ke order me 2 = QUESTIONS hai, isliye user biometric complete
        // karne ke baad dobara questions par wapas chala jata tha, dashboard
        // par pahunchta hi nahi tha.
        //
        // Naya logic EXPLICIT hai, taaki order change karne par dobara ye
        // galti na ho - har step ka apna number likha hai.
        if (!st.pin_configured) {
          setStep(1); // PIN abhi nahi
        } else if (!st.security_questions_configured) {
          setStep(2); // questions abhi nahi
        } else {
          // PIN + questions dono done. Biometric bhi ho chuka hai to gate
          // khatam - user ko dashboard jaana chahiye.
          setStep(3);
        }

        // ---- WebAuthn support: DIAGNOSTIC version ----
        // Pehle ye single boolean check tha, jo `false` aane par koi
        // reason nahi batata tha - user ko bas "not available" dikhta.
        // Ab full report lete hain jisme USER-READABLE reason hota hai, taaki
        // actual fix pata chale (secure context? browser? Windows setting?).
        const { diagnoseBiometrics } = await import('@/lib/webauthn');
        const diag = await diagnoseBiometrics();
        setBiometricDiag(diag);
        setBiometricSupported(diag.canUseBiometrics);
      } catch {
        setError('Could not load security setup status.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [accessToken]);

  // ---- Step 1: PIN ----
  //
  // Do modes:
  //   - SET    (naya user): sirf new PIN + confirm
  //   - CHANGE (purana user): current PIN + new PIN + confirm
  //
  // CHANGE mode kyun zaroori: agar koi device shared ho, ya kisi ne
  // shoulder-surf karke PIN dekha ho, to user ko PIN badalna chahiye - bina
  // purana PIN verify kiye nahi. Isse attacker ka already-logged-in session
  // useless ho jata hai.
  async function submitPin() {
    setError('');

    // ---- Length check ----
    if (pin.length !== 6) {
      setError('PIN must be exactly 6 digits.');
      return;
    }
    if (pin !== confirmPin) {
      setError('The two new PINs do not match.');
      return;
    }

    // ---- CHANGE mode: current PIN bhi validate karo (client side sanity) ----
    if (changingPin) {
      if (currentPin.length !== 6) {
        setError('Enter your current 6-digit PIN.');
        return;
      }
      if (currentPin === pin) {
        setError('Your new PIN must be different from the current one.');
        return;
      }
    }

    setBusy(true);
    try {
      if (changingPin) {
        // ---- CHANGE: PUT /security/pin {old_pin, new_pin} ----
        // Backend purana PIN verify karta hai (bcrypt compare) aur naya set
        // karta hai. Galat purana PIN -> 403 OLD_PIN_INCORRECT.
        const res = await fetch(`${SECURITY_API}/pin`, {
          method: 'PUT',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ old_pin: currentPin, new_pin: pin }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setError(
            err.message ?? err.error ?? 'Could not change your PIN.'
          );
          return;
        }

        // ---- RE-AUTH REQUIRED ----
        // Backend PIN change ke baad SAARE sessions revoke kar deta hai
        // (security: purana PIN chura gaya ho to uska session bhi mare).
        // Iska matlab user ka APNA session bhi ab dead hai. Agar ise
        // chup-chaap continue karenge to har subsequent call 401 dega aur
        // user ko confuse 401 screens dikhenge.
        //
        // Isliye backend `reauth_required: true` bhejta hai, aur hum user ko
        // saaf message ke saath login page par bhej dete hain - naye PIN se
        // dobara login karna hoga.
        const payload = await res.json().catch(() => ({}));
        if (payload?.reauth_required) {
          // Cookie bhi saaf kardo taaki stale token na rahe
          try {
            document.cookie =
              'wideo11_session=; Max-Age=0; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
          } catch {
            // httpOnly cookie JS se delete nahi ho sakti - backend logout
            // endpoint par bhejna padega. Par redirect ke baad middleware
            // use reject kar dega (session revoked), isliye ye best-effort hai.
          }
          setError(
            'Your PIN was changed and all devices were signed out. Please log in again with your new PIN.'
          );
          setTimeout(() => {
            window.location.href = '/auth/login?reason=pin-changed';
          }, 2500);
          return;
        }
      } else {
        // ---- SET: POST /security/pin {pin} ----
        const res = await fetch(`${SECURITY_API}/pin`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setError(err.error ?? 'Failed to set PIN.');
          return;
        }
      }

      setStatus((s) => (s ? { ...s, pin_configured: true } : s));
      // Change mode me fields clear karo sensitive data hatane ke liye
      setPin('');
      setConfirmPin('');
      setCurrentPin('');
      setChangingPin(false);
      setStep(2);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // ---- Biometric skip (shared by both branches) ----
  //
  // Pehle ye logic inline sirf `!biometricSupported` button ke andar tha.
  // Upar wale fix ke baad DONO branches me chahiye, aur duplicate karne se
  // do jagah ka logic diverge hota - jo is bug ki asli wajah hai.
  //
  // NOTE: server ka status AUTHORITATIVE hai. Local optimistic update nahi
  // karte - pichla bug wahi tha (frontend ne `biometric_registered: true`
  // set kar diya jabki backend ke paas koi credential nahi tha).
  async function skipBiometric() {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`${SECURITY_API}/biometric/skip`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? 'Could not skip biometric setup.');
        return;
      }

      const stRes = await fetch(`${SECURITY_API}/setup-status`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const final = await stRes.json().catch(() => ({}));
      setStatus(final);

      if (final.setup_complete) {
        onComplete();
      } else {
        setError(
          'Setup is still incomplete. Please review the earlier steps.'
        );
      }
    } catch {
      setError('Could not skip biometric setup. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // ---- Step 3 (LAST): Biometric ----
  async function registerBiometric() {
    setError('');
    setBusy(true);
    try {
      const { registerCredential } = await import('@/lib/webauthn');
      const result = await registerCredential('', authHeaders.Authorization);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      // Backend ko batao biometric register ho gaya
      const res = await fetch(`${SECURITY_API}/biometric/complete`, {
        method: 'POST',
        headers: authHeaders,
      });
      const payload = await res.json().catch(() => ({}));
      setStatus((s) => (s ? { ...s, biometric_registered: true, setup_complete: payload.setup_complete } : s));
      setBiometricDone(true);

      // ---- STEP 3 (LAST) ke baad: final status check ----
      // Pehle yahan `setStep(3)` tha jo questions step pe le jaata tha.
      // Ab questions step 2 pe hain, to iske baad seedha completion check.
      const finalRes = await fetch(`${SECURITY_API}/setup-status`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const final = await finalRes.json().catch(() => ({}));
      setStatus(final);

      if (final.setup_complete) {
        onComplete();
      } else {
        setError('Setup is still incomplete. Please review the previous steps.');
      }
    } catch {
      setError('Biometric registration failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // ---- Step 2: Exactly 3 security questions ----
  async function submitQuestions() {
    setError('');

    // EXACTLY 3 required (SPEC)
    const selected = Object.values(picked);
    if (selected.length !== 3) {
      setError('Please select exactly 3 security questions.');
      return;
    }
    // Sab 3 answers bhi required
    for (const key of selected) {
      const pos = Number(Object.keys(picked).find((k) => picked[Number(k)] === key));
      if (!answers[pos]?.trim()) {
        setError('Please answer all 3 questions.');
        return;
      }
    }

    const questionsMap: Record<string, string> = {};
    for (const [pos, key] of Object.entries(picked)) {
      questionsMap[key] = answers[Number(pos)];
    }

    setBusy(true);
    try {
      const res = await fetch(`${SECURITY_API}/questions`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: questionsMap }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? 'Failed to save security questions.');
        return;
      }

      // Final status check - teeno complete hone hi chahiye.
      // NOTE: ab questions ke baad seedha biometric step pe jaate hain
      // (step 3), onComplete yahan NAHI call hota - wo biometric ke baad hota
      // hai. Isse user ko biometric enroll karne ka mauka milta hai.
      const finalRes = await fetch(`${SECURITY_API}/setup-status`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const final = await finalRes.json();
      setStatus(final);

      if (final.security_questions_configured) {
        setStep(3);
      } else {
        setError('Could not save your security questions. Please retry.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  const steps = [
    { n: 1, label: 'Security PIN', done: status?.pin_configured },
    // NOTE: order SPEC ke mutabiq hai - 1) PIN, 2) Security Questions,
    // 3) Biometric. Pehle yahan 1=PIN, 2=Biometric, 3=Questions tha.
    // Biometric ko LAST kyun rakha gaya:
    //   - Wo sabse fragile step hai (hardware, OS dialog, cancel)
    //   - Agar wo beech me hota aur fail hota, user ko yeh sochna padta ki
    //     kahan se dobara start kare
    //   - Last me hone se saare data entry steps pehle complete ho jaate hain,
    //     aur biometric last me fail hone par bhi user ka kaam zyada ho chuka
    //     hota hai
    { n: 2, label: 'Security Questions', done: status?.security_questions_configured },
    { n: 3, label: 'Biometric', done: status?.biometric_registered },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4 py-10">
      {/* ---- CARD SIZING FIX ----
          Pehle yaha `min-h-[600px]` tha. Ye problem create kar raha tha:

          Biometric step ka content sirf ~200px ka hai (heading + ek button +
          ek chhota note), lekin card 600px MINIMUM height force kar raha
          tha - yaani ~400px ka KHALI void dikhai de raha tha. Screenshot
          me yahi "bahut khaali khaali" wala issue dikha.

          Fix: `min-h` hata diya. Ab card apne content ke barabar hota
          hai. Har step ka content alag length ka hai, to card height step
          change par badlegi - ye NORMAL hai aur huge empty space se kahin
          behtar dikhta hai.

          NOTE: `transition` nahi lagaya height par - flex centering me
          height transition karne se card "jump" karta hai jo awkward
          lagta hai. Content change par seedha settle hona better hai. */}
      <Card className="w-full max-w-[450px] border-gray-800 bg-gray-900/70">
        <CardHeader className="space-y-3 px-8 pt-8">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-blue-400" />
            <CardTitle className="text-2xl font-semibold tracking-tight text-ink">
              Mandatory Security Setup
            </CardTitle>
          </div>
          <CardDescription className="text-sm leading-relaxed text-gray-400">
            Dashboard access is blocked until all three steps are completed.
          </CardDescription>

          {/* Progress indicator */}
          <div className="flex gap-2 pt-2">
            {steps.map((s) => (
              <div key={s.n} className="flex-1">
                <div
                  className={`h-1.5 rounded-full ${
                    s.done ? 'bg-green-500' : step === s.n ? 'bg-blue-500' : 'bg-gray-700'
                  }`}
                />
                <p className="mt-1.5 text-[10px] text-gray-500">
                  {s.n}. {s.label}
                </p>
              </div>
            ))}
          </div>
        </CardHeader>

        <CardContent className="px-8 pb-8">
          {error ? (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-700/60 bg-red-950/40 p-3 text-sm text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {/* ---- STEP 1: PIN (set OR change) ---- */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <KeyRound className="h-4 w-4 text-blue-400" />
                {changingPin
                  ? 'Change your 6-digit security PIN'
                  : status?.pin_configured
                  ? 'Your security PIN is set. Change it if you want.'
                  : 'Set your 6-digit security PIN'}
              </div>

              {/* ---- CHANGE mode: current PIN (verify + rollback safety) ----
                  Ye field sirf tab dikhta hai jab user PIN CHANGE kar raha
                  ho. Backend ye bcrypt se verify karta hai - bina sahi
                  current PIN ke naya PIN set nahi ho sakta. */}
              {changingPin ? (
                <div className="space-y-2">
                  <Label htmlFor="currentPin" className="text-sm text-gray-300">
                    Current 6-digit PIN
                  </Label>
                  <Input
                    id="currentPin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={currentPin}
                    onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="Current PIN"
                    className="h-11 border-gray-700 bg-gray-950 text-ink"
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="pin" className="text-sm text-gray-300">
                  {changingPin ? 'New 6-digit PIN' : '6-digit PIN'}
                </Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  // `autoComplete="new-password"` browser se "save this PIN"
                  // prompt rokta hai - security PIN browser me store hona
                  // nahi chahiye (hum khud bcrypt se hash karte hain).
                  autoComplete="new-password"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="******"
                  className="h-11 border-gray-700 bg-gray-950 text-ink"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPin" className="text-sm text-gray-300">
                  Confirm {changingPin ? 'new ' : ''}PIN
                </Label>
                <Input
                  id="confirmPin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="******"
                  className="h-11 border-gray-700 bg-gray-950 text-ink"
                />
              </div>
              <Button
                onClick={submitPin}
                disabled={busy}
                className="h-11 w-full rounded-lg bg-blue-600 text-white hover:bg-blue-500"
              >
                {busy ? (
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                ) : changingPin ? (
                  'Change PIN'
                ) : (
                  'Continue'
                )}
              </Button>

              {/* ---- Toggle: set <-> change ----
                  Sirf tab dikhta hai jab PIN ALREADY set hai (status se pata
                  chalta hai). Naye user ko ye option nahi chahiye. */}
              {status?.pin_configured ? (
                <button
                  type="button"
                  onClick={() => {
                    setChangingPin((v) => !v);
                    setError('');
                    setPin('');
                    setConfirmPin('');
                    setCurrentPin('');
                  }}
                  className="w-full text-center text-xs text-gray-500 underline underline-offset-2 transition-colors hover:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                >
                  {changingPin ? 'Cancel PIN change' : 'Change PIN'}
                </button>
              ) : null}

              {/* ---- Security note: PIN change ka asar ----
                  User ko bataya jaata hai ki PIN change karne par kya
                  hota hai - transparency best practice hai. */}
      {changingPin ? (
        <p className="rounded-md border border-amber-700/40 bg-amber-950/20 p-2.5 text-[11px] leading-relaxed text-amber-300/90">
          When you change your PIN, every other signed-in device is signed
          out - including this one. Your old PIN stops working immediately,
          and you will be asked to log in again with the new PIN.
        </p>
      ) : null}
            </div>
          )}

          {/* ---- STEP 2: Exactly 3 questions ---- */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <HelpCircle className="h-4 w-4 text-blue-400" />
                Select exactly 3 security questions
              </div>

              {[1, 2, 3].map((pos) => (
                <div key={pos} className="space-y-2 rounded-lg border border-gray-800 p-3">
                  <Label className="text-xs text-gray-400">Question {pos}</Label>
                  <select
                    value={picked[pos] ?? ''}
                    onChange={(e) => setPicked((p) => ({ ...p, [pos]: e.target.value }))}
                    className="h-10 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 text-sm text-ink focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select a question...</option>
                    {availableQuestions.map((q) => (
                      <option key={q} value={q} disabled={Object.values(picked).includes(q) && picked[pos] !== q}>
                        {QUESTION_LABELS[q] ?? q}
                      </option>
                    ))}
                  </select>
                  {picked[pos] ? (
                    <Input
                      type="text"
                      value={answers[pos] ?? ''}
                      onChange={(e) => setAnswers((a) => ({ ...a, [pos]: e.target.value }))}
                      placeholder="Your answer"
                      className="h-10 border-gray-700 bg-gray-950 text-sm text-ink"
                    />
                  ) : null}
                </div>
              ))}

              <Button
                onClick={submitQuestions}
                disabled={busy}
                className="h-11 w-full rounded-lg bg-blue-600 text-white hover:bg-blue-500"
              >
                {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Complete setup'}
              </Button>
            </div>
          )}
          {/* ---- STEP 3: Biometric ---- */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <Fingerprint className="h-4 w-4 text-blue-400" />
                Register biometric authentication
              </div>

              {biometricSupported ? (
                <>
                  <p className="text-sm leading-relaxed text-gray-400">
                    You will be asked to touch your fingerprint or face. This credential never
                    leaves your device.
                  </p>
                  <Button
                    onClick={registerBiometric}
                    disabled={busy}
                    className="h-11 w-full rounded-lg bg-blue-600 text-white hover:bg-blue-500"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Touch your sensor
                      </>
                    ) : (
                      'Register biometric'
                    )}
                  </Button>

                  {/* ---- ESCAPE HATCH: EVEN WHEN SUPPORT IS REPORTED ----
                      Ye button pehle SIRF `!biometricSupported` branch me
                      render hota tha. Usi wajah se kuch users PERMANENTLY
                      gate me phanse rehte the:

                        browser bolta hai  "biometrics available"  (capable=true)
                        user ka sensor      chalta hi nahi, ya
                        OS dialog           cancel ho jata hai, ya
                        user ne             Touch ID face-enroll karna hi nahi kiya

                      Tab `biometricSupported === true` hone ki wajah se
                      skip button RENDER hi nahi hota tha. User ke paas
                      koi raasta nahi bacha - gate par khada, dashboard
                      tak pahunch nahi sakta, koi error bhi nahi dikhta.
                      Ye wo loop hai jo report hua: har reload par wahi
                      biometric step.

                      Ab skip button DONO branches me hai. Support hone par
                      bhi, secondary styling me - wo primary action nahi,
                      par escape zaroor hai.

                      SECURITY: skip karne se biometric ENROLL nahi hota.
                      Backend `biometric/skip` sirf user ke decision ko
                      persist karta hai (`security_profiles.biometric_opted_out`),
                      aur completion rule use "satisfied" maanti hai. User
                      ka PIN aur security questions phir bhi mandatory
                      hain - isiliye account un-enrolled biometric ke saath
                      bhi poori tarah protected rehta hai.

                      Ye koi weakening nahi hai: pehle bhi skip ka raasta
                      tha, bas wo sirf un devices par dikhta tha jahan
                      support REPORT hi nahi hota tha - yaani asli problem
                      wahi jagah thi jahan zaroorat thi. */}
                  <button
                    type="button"
                    onClick={skipBiometric}
                    disabled={busy}
                    className="w-full text-center text-xs text-gray-500 underline underline-offset-2 transition-colors hover:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-50"
                  >
                    {busy ? 'Skipping...' : "This isn't working — skip biometric"}
                  </button>
                </>
              ) : (
                /* DEVICE SENSOR NAHI HAI - ALTERNATE RECOVERY PATH.
                   SPEC clarification ke mutabiq: register form me checkbox
                   chhupa diya gaya hai jab sensor nahi hota. Yahan bhi hum
                   step ko SKIP karke user ko aage badhte hain - taaki koi
                   user PERMANENTLY trap na ho.

                   Ye "hard block" nahi hai, balki capability-aware bypass:
                   - device me sensor hai   -> biometric HARD required
                   - device me sensor nahi  -> skip + PIN/Questions se aage
                */
                  <div className="space-y-3">
                    <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3 text-sm text-gray-300">
                      <p className="font-medium">Biometrics not available on this device</p>

                      {/* ---- DIAGNOSTIC: ASLI WAJAH BATHAO ----
                          Pehle yahan hardcoded text tha ("No fingerprint or
                          face hardware was detected") - jo GALAT bhi ho
                          sakta tha aur useless bhi.

                          Ab `biometricDiag.reason` dikhaya jaata hai, jo
                          actually check karke batata hai problem kya hai:
                            - secure context nahi (LAN IP se khola?)
                            - browser WebAuthn support nahi karta
                            - Windows "Web Authentication" setting band
                            - Windows Hello set up nahi
                          Bina iske user ko sirf ek dead-end message milta
                          tha. Ab use EXACT fix milta hai. */}
                      <p className="mt-1 text-xs leading-relaxed text-gray-400">
                        {biometricDiag?.reason ??
                          'Checking your device for a Windows Hello or Touch ID authenticator...'}
                      </p>

                      {/* Diagnostic facts - compact, debug-friendly */}
                      {biometricDiag ? (
                        <ul className="mt-2 space-y-0.5 text-[10px] text-gray-500">
                          <li>
                            Secure context: {biometricDiag.secureContext ? 'yes' : 'no'}
                            {' '}({biometricDiag.origin})
                          </li>
                          <li>
                            WebAuthn API: {biometricDiag.hasPublicKeyCredential ? 'yes' : 'no'}
                          </li>
                          <li>
                            Platform authenticator (Windows Hello):{' '}
                            {biometricDiag.platformAuthenticator ? 'found' : 'not found'}
                          </li>
                        </ul>
                      ) : null}

                      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                        You can skip this step - your PIN and security questions still
                        protect your account.
                      </p>
                    </div>
                  <Button
                    onClick={skipBiometric}
                    disabled={busy}
                    className="h-11 w-full rounded-lg border border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800"
                  >
                    {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Continue without biometric'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ---- SETUP COMPLETE: auto-redirect ----
              BUG FIX: ye message pehle sirf DIKHATA tha ("Redirecting to
              dashboard...") par KABHI redirect nahi karta tha. `onComplete()`
              sirf button handlers me call hota tha - agar status load hone
              par complete mila (page refresh, back button, ya kisi aur flow
              se aakar), to user yahi message dekh kar ATKA rehta tha,
              kyunki koi redirect hone wala hi nahi tha.

              Ab niche ek `useEffect` hai jo `setup_complete` true hote hi
              redirect karta hai. Ye effect har render check karta hai, isliye
              chahe complete status kaise bhi aaye - redirect ho jayega. */}
          {status?.setup_complete && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-700/60 bg-emerald-950/40 p-3 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Security setup complete. Taking you to your dashboard...</span>
              <Loader2 className="ml-auto h-4 w-4 animate-spin" aria-hidden="true" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
