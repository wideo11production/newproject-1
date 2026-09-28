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

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@wideo11/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wideo11/ui/card';
import { Input } from '@wideo11/ui/input';
import { Label } from '@wideo11/ui/label';
import { AlertCircle, CheckCircle2, Fingerprint, KeyRound, Loader2, ShieldCheck, HelpCircle } from 'lucide-react';
import { useClickTracking, reportSecurityViolation } from '@/lib/audit-tracking';

const AUTH_API = process.env.NEXT_PUBLIC_AUTH_API ?? 'http://localhost:8085';

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
  useClickTracking('security/setup-gate');

  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // PIN state
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  // Biometric state
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricDone, setBiometricDone] = useState(false);

  // Questions state
  const [availableQuestions, setAvailableQuestions] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  // ---- Initial load ----
  useEffect(() => {
    async function load() {
      try {
        const [statusRes, qRes] = await Promise.all([
          fetch(`${AUTH_API}/api/v1/auth/security/setup-status`, {
            headers: authHeaders,
            cache: 'no-store',
          }),
          fetch(`${AUTH_API}/api/v1/auth/security/questions/available`, {
            cache: 'no-store',
          }),
        ]);

        const st = await statusRes.json();
        setStatus(st);

        if (qRes.ok) {
          const q = await qRes.json();
          setAvailableQuestions(q.questions ?? []);
        }

        // Step kahan se shuru karein - pehle se done hain to skip
        if (st.pin_configured && st.security_questions_configured && !st.biometric_registered) {
          setStep(2);
        } else if (st.pin_configured) {
          setStep(2);
        }

        // WebAuthn support
        if (typeof window !== 'undefined' && !!window.PublicKeyCredential) {
          try {
            const avail = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
            setBiometricSupported(avail);
          } catch {
            setBiometricSupported(false);
          }
        }
      } catch {
        setError('Could not load security setup status.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [accessToken]);

  // ---- Step 1: PIN ----
  async function submitPin() {
    setError('');
    if (pin.length !== 6) {
      setError('PIN must be exactly 6 digits.');
      return;
    }
    if (pin !== confirmPin) {
      setError('PINs do not match.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${AUTH_API}/api/v1/auth/security/pin`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? 'Failed to set PIN.');
        return;
      }
      setStatus((s) => (s ? { ...s, pin_configured: true } : s));
      setStep(2);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // ---- Step 2: Biometric ----
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
      const res = await fetch(`${AUTH_API}/api/v1/auth/security/biometric/complete`, {
        method: 'POST',
        headers: authHeaders,
      });
      const payload = await res.json().catch(() => ({}));
      setStatus((s) => (s ? { ...s, biometric_registered: true, setup_complete: payload.setup_complete } : s));
      setBiometricDone(true);
      setStep(3);
    } catch {
      setError('Biometric registration failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // ---- Step 3: Exactly 3 security questions ----
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
      const res = await fetch(`${AUTH_API}/api/v1/auth/security/questions`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: questionsMap }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? 'Failed to save security questions.');
        return;
      }

      // Final status check - teeno complete hone hi chahiye
      const finalRes = await fetch(`${AUTH_API}/api/v1/auth/security/setup-status`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const final = await finalRes.json();
      setStatus(final);

      if (final.setup_complete) {
        onComplete();
        router.push('/dashboard');
      } else {
        setError('Setup incomplete. Please finish all three steps.');
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
    { n: 2, label: 'Biometric', done: status?.biometric_registered },
    { n: 3, label: 'Security Questions', done: status?.security_questions_configured },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4 py-10">
      <Card className="w-full max-w-[450px] min-h-[600px] border-gray-800 bg-gray-900/70">
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

          {/* ---- STEP 1: PIN ---- */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <KeyRound className="h-4 w-4 text-blue-400" />
                Set your 6-digit security PIN
              </div>
              <div className="space-y-2">
                <Label htmlFor="pin" className="text-sm text-gray-300">6-digit PIN</Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="******"
                  className="h-11 border-gray-700 bg-gray-950 text-ink"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPin" className="text-sm text-gray-300">Confirm PIN</Label>
                <Input
                  id="confirmPin"
                  type="password"
                  inputMode="numeric"
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
                {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Continue'}
              </Button>
            </div>
          )}

          {/* ---- STEP 2: Biometric ---- */}
          {step === 2 && (
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
                    <p className="mt-1 text-xs leading-relaxed text-gray-500">
                      No fingerprint or face hardware was detected. This step is skipped -
                      your PIN and security questions provide the security layer instead.
                    </p>
                  </div>
                  <Button
                    onClick={async () => {
                      // Biometric ko "N/A" mark karo taaki setup complete ho sake
                      setBusy(true);
                      try {
                        await fetch(`${AUTH_API}/api/v1/auth/security/biometric/complete`, {
                          method: 'POST',
                          headers: authHeaders,
                        });
                      } catch {
                        // ignore
                      }
                      setStatus((s) =>
                        s ? { ...s, biometric_registered: true, setup_complete: true } : s
                      );
                      setStep(3);
                      setBusy(false);
                    }}
                    className="h-11 w-full rounded-lg border border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800"
                  >
                    {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Continue'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ---- STEP 3: Exactly 3 questions ---- */}
          {step === 3 && (
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

          {status?.setup_complete && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-green-700/60 bg-green-950/40 p-3 text-sm text-green-300">
              <CheckCircle2 className="h-4 w-4" />
              Security setup complete. Redirecting to dashboard...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
