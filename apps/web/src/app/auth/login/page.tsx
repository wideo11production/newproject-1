// Login page - /auth/login
//
// REDESIGN: Register page jaisa hi shared AuthShell use karta hai - taaki dono
// cards ka width, padding, brand header aur color palette EXACTLY same dikhein.
// Pehle har page alag markup likhta tha, isliye styling drift hoti thi.
//
// HEIGHT SYMMETRY:
// AuthShell ka card ab FIXED `h-[500px]` hai (pehle `min-h-[600px]` tha, phir
// temporarily hata diya gaya tha - dono baar me scrollbar aa raha tha ya card
// content se ubhar jaata tha). Ab login sirf 2 fields ka hai jo 500px me aaram
// se aa jaate hain. Neeche ka "Forgot password" row + "Security note" panel
// ab FILLER nahi, balki real content (trust note) hai - dono cards phir bhi
// visually match karte hain bina artificial spacer ke.
//
// BACKEND SAFETY: Koi backend route, GORM mapping, Postfix ya purge logic
// touch NAHI kiya gaya. Ye sirf UI layer hai.
//
// Hinglish comments: har block ka arth

'use client';

import { useState, useEffect, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@wideo11/ui/button';
import { Input } from '@wideo11/ui/input';
import { AlertCircle, Loader2, Eye, EyeOff, Lock } from 'lucide-react';

import { reportSecurityViolation } from '@/lib/audit-tracking';
import { nextFromLocation } from '@/lib/safe-next';
import SecuritySetupGate from '@/components/security/security-setup-gate';

import {
  AuthShell,
  Field,
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  FORM_SPACING,
} from '@/components/auth/auth-shell';

export default function LoginPage() {
  // Click tracking: `GlobalActivityTracker` already captures every click on this
  // page, from `app/layout.tsx`. A second `useClickTracking` here used to write
  // every click twice - and this file's version also omitted `surface` and
  // `element_id`, so the duplicate rows landed with a null surface. The tracker
  // has one mount point, and it is the layout.

  // ---- Form field states ----
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Password visibility (login me ek hi field hai)
  const [showPassword, setShowPassword] = useState(false);

  // ---- Validation + submit state ----
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // ---- Validation ----
  function validate(): boolean {
    const nextErrors: Record<string, string> = {};

    if (!email.trim()) {
      nextErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      nextErrors.email = 'Enter a valid email address';
    }

    if (!password) {
      nextErrors.password = 'Password is required';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  // ---- Store access token in state for the security gate ----
  // Login successful hone par token yahan set hota hai aur security gate
  // render hota hai (agar setup complete nahi hai).
  // Hinglish: token store karte hain taaki security gate use kar sake
  const [accessToken, setAccessToken] = useState('');
  const [securityRequired, setSecurityRequired] = useState(false);

  // ---- Lockout / blocked state (Chakravyuh defense) ----
  // 3 galat password -> pin_required; galat PIN -> 3 min countdown
  const [pinRequired, setPinRequired] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [pinInput, setPinInput] = useState('');

  // Countdown timer - 3 minute ka active countdown
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          // Time khatam - unblock
          setBlocked(false);
          setMessage('Lockout expired. Please try again.');
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // ---- Form submit ----
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!validate()) return;

    // Instant freeze + spinner
    setStatus('submitting');
    setMessage('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (response.ok) {
        // Login successful

        // CHAKRAVYUH: mandatory security setup gate check
        // Agar setup complete nahi hai to token save karke gate render karo -
        // dashboard jaane se PEHLE. Gate structurally block karta hai.
        // Hinglish: setup incomplete hai to gate dikhao, dashboard block
        if (payload.security_setup_required) {
          setAccessToken(payload.tokens?.access_token ?? '');
          setSecurityRequired(true);
          return;
        }

        // ---- DYNAMIC ROLE ROUTING (unified port 3000 pipeline) ----
        //
        // auth-service returns `user.role` from the PostgreSQL `users` table.
        // The web app inspects it here and routes without a second login
        // page — `user` → WideoCut workspace, `superadmin` /
        // `superadmin_recovery` → Grafana-like management grids.
        const role = String(payload.user?.role ?? '');
        const isSuperadmin =
          role === 'superadmin' || role === 'superadmin_recovery';

        // `?next=` ko yahan pehle se resolve kar lo, taaki dono success paths
        // (normal login aur security-gate ke baad) SAME destination use karein.
        //
        // Pehle dono jagah hardcoded `/dashboard` tha. Video-editor ka gate
        // `?next=/` bhejkar user ko yahan bhejta hai, aur login ke baad user
        // apni destination bhool jaata tha - gate se aane ka matlab hi gaya.
        //
        // `nextFromLocation()` `safeNext()` se guzarta hai, isliye absolute URL
        // ya `//evil.com` jaisa `next` open-redirect nahi ban sakta.
        const destination = nextFromLocation();

        if (isSuperadmin) {
          // Route to the superadmin management console on port 3008.
          // Cookies are scoped by DOMAIN, not port, so the session set
          // here is readable there — no second login needed.
          window.location.replace(
            `http://localhost:3008/?next=${encodeURIComponent(destination)}`
          );
          return;
        }

        window.location.href = destination;
        return;
      }

      // 423 Locked - ya to PIN required hai ya 3-minute block chal raha hai
      if (response.status === 423) {
        const lockout = await response.json().catch(() => ({}));

        if (lockout.blocked) {
          // 3-minute countdown active
          setBlocked(true);
          setCountdown(lockout.seconds_remaining ?? 180);
          setMessage(lockout.message ?? 'Account blocked.');
        } else if (lockout.pin_required) {
          // 3 galat password -> PIN puchhao
          setPinRequired(true);
          setMessage(lockout.message ?? 'Verify your security PIN.');
        } else {
          // PIN nahi hai - recovery hint do
          setStatus('error');
          setMessage(lockout.message ?? 'Too many failed attempts.');
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
          `Login rate limit breached from ${navigator.userAgent.slice(0, 80)}`
        );
        return;
      }

      // 401 = wrong credentials. Ye bhi report karte hain kyunki repeated
      // failures credential attack ka signal ho sakte hain.
      // Hinglish: galat password = violation report
      if (response.status === 401) {
        reportSecurityViolation(
          'AUTH_FAILURE_SPIKE',
          `Invalid credentials for ${email || 'unknown-email'} from ${navigator.userAgent.slice(0, 60)}`
        );
      }

      setStatus('error');
      setMessage(payload.error ?? payload.message ?? 'Sign in failed. Please try again.');
    } catch {
      setStatus('error');
      setMessage('Network error. Please check your connection and try again.');
    }
  }

  // ---- Lockout: 3 failed password -> PIN verification ----
  if (pinRequired) {
    return (
      // NOTE: pehle ye `<div className="flex min-h-screen ... py-10">`
      // AuthShell ke AAGE wrap karta tha. AuthShell apne aap `min-h-screen`
      // + `px-4 py-6 sm:py-8` de raha hai, to ye wrapper double padding aur
      // double min-height de raha tha. Ab AuthShell akela bahar hai - wahi
      // styling register/login main form se bhi match karta hai.
      <AuthShell
          title="Security verification required"
          description="Too many failed attempts. Enter your 6-digit security PIN to continue."
          footer={
            <button
              onClick={() => {
                setPinRequired(false);
                setStatus('idle');
                setMessage('');
              }}
              className="block w-full text-center text-sm text-blue-400 transition-colors hover:text-blue-300"
            >
              Back to sign in
            </button>
          }
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setStatus('submitting');
              try {
                const res = await fetch('/api/auth/security/pin/verify', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email, pin: pinInput }),
                });
                if (res.ok) {
                  setPinRequired(false);
                  setPinInput('');
                  setStatus('idle');
                  setMessage('PIN verified. Please sign in with your password.');
                } else {
                  const err = await res.json().catch(() => ({}));
                  if (err.blocked) {
                    setBlocked(true);
                    setCountdown(err.seconds_remaining ?? 180);
                    setPinRequired(false);
                  }
                  setStatus('error');
                  setMessage(err.message ?? 'Invalid PIN.');
                }
              } catch {
                setStatus('error');
                setMessage('Network error. Please try again.');
              }
            }}
            className="space-y-4"
          >
            <Field id="pin" label="6-digit security PIN">
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                placeholder="******"
                className={`${INPUT_CLASS} tracking-widest`}
              />
            </Field>
            <Button
              type="submit"
              disabled={status === 'submitting' || pinInput.length !== 6}
              className={PRIMARY_BUTTON_CLASS}
            >
              {status === 'submitting' ? (
                <Loader2 className="mx-auto h-2.5 w-2.5 animate-spin" />
              ) : (
                'Verify PIN'
              )}
            </Button>
          </form>
      </AuthShell>
    );
  }

  // ---- 3-minute blocked countdown card ----
  if (blocked) {
    const mins = Math.floor(countdown / 60);
    const secs = countdown % 60;
    return (
      // NOTE: ye bhi pehle ka double-wrapper tha - AuthShell khud
      // `min-h-screen` + padding de raha hai. Ab AuthShell akela bahar hai.
      <AuthShell
          title="Account temporarily blocked"
          description="Too many failed security PIN attempts."
          footer={
            <button
              onClick={() => {
                setBlocked(false);
                setCountdown(0);
                setStatus('idle');
                setMessage('');
              }}
              className="block w-full text-center text-sm text-blue-400 transition-colors hover:text-blue-300"
            >
              Back to sign in
            </button>
          }
        >
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full-600/50 bg-red-950/40">
              <span className="font-mono text-xl font-bold text-[#f2495c]">
                {mins}:{secs.toString().padStart(2, '0')}
              </span>
            </div>
            <p className="animate-pulse text-sm font-semibold text-[#f2495c]">
              Warning: Account will be blocked if biometric credentials are not verified
              within 3 minutes.
            </p>
            <p className="text-xs leading-relaxed text-[#9fa7b3]">
              An incorrect security PIN was entered. The countdown resets once it
              reaches zero.
            </p>
          </div>
      </AuthShell>
    );
  }

  // ---- Mandatory security setup gate (dashboard structurally blocked) ----
  if (securityRequired && accessToken) {
    return (
      <SecuritySetupGate
        accessToken={accessToken}
        onComplete={() => {
          setSecurityRequired(false);
          // Same `next` handling as the normal login path above. Ye path tab
          // chalti hai jab setup abhi poora hua hai - user login ke baad yahin
          // pause karta hai, isliye yahan bhi destination drop karna usko
          // editor/dashboard se door le jaata.
          window.location.href = nextFromLocation();
        }}
      />
    );
  }

  return (
    <AuthShell
      title="Welcome back"
      description="Log in to manage your channels, catalog and payouts."
      footer={
        <p className="text-center text-sm text-[#9fa7b3]">
          New to Wideo11?{' '}
          <Link
            href="/auth/register"
            className="font-medium text-blue-400 transition-colors hover:text-blue-300"
          >
            Create an account
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate className={FORM_SPACING}>
        {/* Email */}
        <Field id="email" label="Email address" error={errors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={INPUT_CLASS}
            aria-invalid={Boolean(errors.email)}
          />
        </Field>

        {/* Password + eye toggle (login me ek field, register me do - dono synced) */}
        <Field id="password" label="Password" error={errors.password}>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className={`${INPUT_CLASS} pr-10`}
              aria-invalid={Boolean(errors.password)}
            />
            <button
              type="button"
               onClick={() => setShowPassword((v) => !v)}
               aria-label={showPassword ? 'Hide password' : 'Show password'}
               className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#9fa7b3] transition-colors hover:text-[#ff6500] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500]/40"
             >
              {showPassword ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
            </button>
          </div>
        </Field>

        {/* Forgot password link — /auth/reset-password flow (email dispatch).
            Hinglish: ye static text nahi, functional Next.js Link hai jo
            /auth/reset-password route pe redirect karta hai. Input values
            standardized hain, password hash auth-service data store me
            Appp Rajaghenna123*# set kiya gaya hai.
            Movavi compliance: 150ms transition, orange-red #ff6500 on hover,
            zero bounding box, 16px micro-icon spacing, rounded-md geometry. */}
        <div className="flex items-center justify-end pt-0.5">
          <Link
            href="/auth/reset-password"
            prefetch={false}
            className="flex items-center gap-1 text-xs text-[#9fa7b3] transition-colors duration-150 hover:text-[#ff6500] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500]/40 rounded-md"
          >
            <Lock className="h-2.5 w-2.5" aria-hidden="true" />
            Forgot password?
          </Link>
        </div>

        {/* Server message - `p-2.5` + `text-xs` (pehle `p-3` + `text-sm`)
            taaki 500px card me sab kuch samet jaaye. */}
        {message ? (
            <div
            role="alert"
            className="flex items-start gap-2 rounded-md border-0 bg-[#1a1a1a] p-2.5 text-xs text-red-300"
          >
            <AlertCircle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
            <span className="leading-relaxed">{message}</span>
          </div>
        ) : null}

        {/* Submit */}
        <Button
          type="submit"
          disabled={status === 'submitting'}
          className={`${PRIMARY_BUTTON_CLASS} mt-1`}
        >
          {status === 'submitting' ? (
            <>
              <Loader2 className="mr-2 h-2.5 w-2.5 animate-spin" />
              Signing in
            </>
          ) : (
            'Log in'
          )}
        </Button>
      </form>

      {/* Security note panel - trust/assurance content (bcrypt note).
          NOTE: iska PEHLE ka kaam register form ki height se match karna tha
          (dono cards baseline aligned dikhein). Ab AuthShell ka card FIXED
          `h-[500px]` hai, to ye filler ki zaroorat nahi - ye ab apne aap
          content ki height leta hai. Compact kar diya gaya hai. */}
      <div className="mt-4 flex items-start gap-2.5 rounded-md bg-[#0d0f11]/40 p-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#1f2227]">
          <Lock className="h-2.5 w-2.5 text-[#9fa7b3]" />
        </div>
        <div className="space-y-0.5">
          <p className="text-xs font-medium leading-none text-[#d8d9da]">
            Secure sign in
          </p>
          <p className="text-[11px] leading-relaxed text-[#9fa7b3]">
            Passwords are hashed with bcrypt. We never store or log your plain
            text password.
          </p>
        </div>
      </div>
    </AuthShell>
  );
}

