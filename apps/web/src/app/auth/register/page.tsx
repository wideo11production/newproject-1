// Registration page - /auth/register
//
// REDESIGN: Ab ye page shared AuthShell component use karta hai, jo login page
// ke SAATH share hota hai. Isse width (max-w-[450px]), min-height, padding,
// brand header aur color palette BY CONSTRUCTION identical hain - pehle har page
// apna markup likhta tha aur styling drift ho jati thi.
//
// RETAINED LOGIC (pichle version se, kuch nahi hataya):
//   - Dual sync show/hide (koi bhi eye icon DONO password fields toggle kare)
//   - Dynamic password strength meter (Shadcn Progress use kiya)
//   - Submit disabled jab tak valid + match + strength green na ho
//   - Submit click par instant freeze + spinner
//   - Brand logo via next/image from /brand.svg
//
// NEW: Biometric checkbox ab KABHI hide nahi hota. Agar device support nahi
// karta to disabled state me render hota hai + "Unavailable" badge, jisse card
// height symmetry bani rahegi.
//
// Hinglish comments: har block ka arth

'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@wideo11/ui/button';
import { Input } from '@wideo11/ui/input';
import { Checkbox } from '@wideo11/ui/checkbox';
import { Progress } from '@wideo11/ui/progress';
import { Badge } from '@wideo11/ui/badge';
import { AlertCircle, CheckCircle2, Loader2, Eye, EyeOff, Fingerprint, ShieldCheck } from 'lucide-react';

import {
  AuthShell,
  Field,
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  FORM_SPACING,
} from '@/components/auth/auth-shell';

// Strength levels: 0 = empty, 4 = strong (green)
type Strength = 0 | 1 | 2 | 3 | 4;

export default function RegisterPage() {
  // ---- Form field states ----
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
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

  useEffect(() => {
    // window sirf client side pe exist karta hai, isliye useEffect + state
    // use kiya hai (SSR hydration mismatch nahi hoga)
    const supported = typeof window !== 'undefined' && !!window.PublicKeyCredential;
    setBiometricSupported(supported);
  }, []);

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
  const nameError = fullName.trim() ? null : 'Full name is required';

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
    !nameError &&
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
  async function registerBiometric() {
    const { registerCredential } = await import('@/lib/webauthn');
    return registerCredential(email.trim().toLowerCase());
  }

  // ---- Form submit ----
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Sab fields touched mark karo taaki saare errors ek saath dikhayein
    setTouched({ name: true, email: true, password: true, confirm: true });

    if (!isFormValid) return;

    // Instant freeze + spinner (multi-hit DDoS protection)
    setStatus('submitting');
    setMessage('');

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          password,
          enableBiometric,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (response.ok) {
        setStatus('success');
        setMessage(
          payload.message ??
            'Account created. Please check your email to verify your address within 30 minutes.'
        );
        return;
      }

      if (response.status === 429) {
        setStatus('error');
        setMessage(
          'Too many attempts from this network. Please wait 60 seconds and try again.'
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
      description="Start publishing on Wideo11. Free to begin, no card required."
      footer={
        <p className="text-center text-sm text-gray-400">
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
        {/* Full name */}
        <Field id="fullName" label="Full name" error={showError('name', nameError)}>
          <Input
            id="fullName"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            onBlur={() => markTouched('name')}
            placeholder="Aarav Sharma"
            className={INPUT_CLASS}
            aria-invalid={Boolean(touched.name && nameError)}
          />
        </Field>

        {/* Email */}
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
              placeholder="At least 12 characters"
              className={`${INPUT_CLASS} pr-11`}
              aria-invalid={Boolean(touched.password && passwordError)}
            />
            {/* Pehla eye icon - DONO password fields toggle karta hai */}
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition-colors hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {/* Password strength meter - Shadcn Progress primitive */}
          <div className="space-y-1.5 pt-1">
            <Progress
              // Shadcn Progress sirf ek value leta hai - isliye 4 segments
              // ko ek single percentage me convert kiya hai (0/25/50/75/100)
              value={(strength / 4) * 100}
              className={`h-1.5 ${
                strength === 4
                  ? '[&>div]:bg-emerald-500'
                  : strength >= 3
                  ? '[&>div]:bg-amber-400'
                  : strength >= 2
                  ? '[&>div]:bg-orange-400'
                  : '[&>div]:bg-red-500'
              }`}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Password strength</p>
              <p
                className={`text-xs font-medium transition-colors ${
                  strength === 4
                    ? 'text-emerald-400'
                    : strength >= 3
                    ? 'text-amber-400'
                    : strength >= 2
                    ? 'text-orange-400'
                    : 'text-gray-500'
                }`}
              >
                {strengthLabel}
              </p>
            </div>
          </div>
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
              placeholder="Re-enter your password"
              className={`${INPUT_CLASS} pr-11`}
              aria-invalid={Boolean(touched.confirm && confirmError)}
            />
            {/* Doosra eye icon - bhi WAHI state toggle karta hai (synced) */}
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition-colors hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        {/* Terms & Conditions - Shadcn Checkbox */}
        <div className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3">
          <Checkbox
            id="terms"
            checked={acceptedTerms}
            onCheckedChange={(v) => setAcceptedTerms(v === true)}
            className="mt-0.5 border-gray-600 data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600"
          />
          <label
            htmlFor="terms"
            className="cursor-pointer select-none text-sm leading-relaxed text-gray-400"
          >
            I agree to the{' '}
            <span className="font-medium text-blue-400">Terms &amp; Conditions</span> and{' '}
            <span className="font-medium text-blue-400">Privacy Policy</span>
          </label>
        </div>

        {/* Biometric - HAMESHA render hota hai (symmetry ke liye).
            Unsupported device par disabled + "Unavailable" badge. */}
        <div className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3">
          <Checkbox
            id="biometric"
            checked={enableBiometric}
            // Unsupported device par disabled - field dikhta rehta hai, sirf interact nahi kar sakte
            disabled={!biometricSupported || biometricEnrolling}
            onCheckedChange={async (v) => {
              if (v !== true) {
                setEnableBiometric(false);
                return;
              }

              // User ne checkbox ON kiya - actual device enrollment shuru karo
              setBiometricEnrolling(true);
              setBiometricMessage('');

              try {
                const result = await registerBiometric();
                if (result.ok) {
                  setEnableBiometric(true);
                  setBiometricMessage(result.message);
                } else {
                  setEnableBiometric(false);
                  setBiometricMessage(result.message);
                }
              } catch {
                setEnableBiometric(false);
                setBiometricMessage(
                  'Biometric setup failed on this device. Password login will still work.'
                );
              } finally {
                setBiometricEnrolling(false);
              }
            }}
            className="mt-0.5 border-gray-600 data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600 disabled:opacity-50"
          />
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="biometric"
                className="cursor-pointer select-none text-sm leading-relaxed text-gray-400"
              >
                Enable biometric login
              </label>
              {/* Device support na ho to ye badge user ko batata hai */}
              {!biometricSupported ? (
                <Badge
                  variant="secondary"
                  className="h-5 rounded-full border-gray-700 bg-gray-800/60 px-2 text-[10px] font-medium text-gray-400"
                >
                  Unavailable
                </Badge>
              ) : null}
            </div>
            <p className="text-xs leading-relaxed text-gray-500">
              {biometricEnrolling
                ? 'Touch your fingerprint or face to enroll this device...'
                : biometricMessage ||
                  (biometricSupported
                    ? 'Use your device fingerprint or face instead of a password.'
                    : 'This device has no fingerprint or face hardware detected.')}
            </p>
          </div>
          {/* Fingerprint icon - visual cue */}
          <Fingerprint
            className={`mt-0.5 h-4 w-4 shrink-0 ${
              biometricSupported ? 'text-blue-400' : 'text-gray-600'
            }`}
          />
        </div>

        {/* Server message - success ya error */}
        {message ? (
          <div
            role="status"
            className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
              status === 'success'
                ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300'
                : 'border-red-700/60 bg-red-950/40 text-red-300'
            }`}
          >
            {status === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
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
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating account
            </>
          ) : status === 'success' ? (
            <>
              <ShieldCheck className="mr-2 h-4 w-4" />
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
