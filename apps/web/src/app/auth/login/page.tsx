// Login page - /auth/login
//
// REDESIGN: Register page jaisa hi shared AuthShell use karta hai - taaki dono
// cards ka width, padding, brand header aur color palette EXACTLY same dikhein.
// Pehle har page alag markup likhta tha, isliye styling drift hoti thi.
//
// HEIGHT SYMMETRY:
// Register card me 5 fields + strength meter + 2 checkbox panels hain, login me
// sirf 2 fields. AuthShell par `min-h-[600px]` hai, aur neeche hum "Forgot
// password" row + "Security" note panel add kiya hai - ye naturally card ko
// fill karta hai jisse dono cards baseline par align hote hain, bina kuch
// overflow ya artificial spacer ke.
//
// BACKEND SAFETY: Koi backend route, GORM mapping, Postfix ya purge logic
// touch NAHI kiya gaya. Ye sirf UI layer hai.
//
// Hinglish comments: har block ka arth

'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@wideo11/ui/button';
import { Input } from '@wideo11/ui/input';
import { AlertCircle, Loader2, Eye, EyeOff, Lock } from 'lucide-react';

import {
  AuthShell,
  Field,
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  FORM_SPACING,
} from '@/components/auth/auth-shell';

export default function LoginPage() {
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
        // Login successful - dashboard par bhejte hain
        window.location.href = '/dashboard';
        return;
      }

      if (response.status === 429) {
        setStatus('error');
        setMessage(
          'Too many attempts from this network. Please wait 60 seconds and try again.'
        );
        return;
      }

      setStatus('error');
      setMessage(payload.error ?? payload.message ?? 'Sign in failed. Please try again.');
    } catch {
      setStatus('error');
      setMessage('Network error. Please check your connection and try again.');
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      description="Log in to manage your channels, catalog and payouts."
      footer={
        <p className="text-center text-sm text-gray-400">
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
              className={`${INPUT_CLASS} pr-11`}
              aria-invalid={Boolean(errors.password)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition-colors hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        {/* Forgot password row - register form ki "options" row se visually
            balanced lagta hai, aur card height symmetry me help karta hai */}
        <div className="flex items-center justify-end pt-0.5">
          <span className="text-xs text-gray-500">Forgot password?</span>
        </div>

        {/* Server message */}
        {message ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-red-700/60 bg-red-950/40 p-3 text-sm text-red-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
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
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Signing in
            </>
          ) : (
            'Log in'
          )}
        </Button>
      </form>

      {/* Security note panel - ye register form ke checkbox panels jaisa height
          fill karta hai, jisse dono cards baseline par align hote hain.
          Ye card symmetry ke liye hai, koi naya feature nahi. */}
      <div className="mt-6 flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-700 bg-gray-800/60">
          <Lock className="h-4 w-4 text-gray-400" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium leading-none text-gray-300">
            Secure sign in
          </p>
          <p className="text-xs leading-relaxed text-gray-500">
            Passwords are hashed with bcrypt. We never store or log your plain
            text password.
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
