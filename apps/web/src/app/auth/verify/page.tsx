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

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import {
  AuthShell,
  PRIMARY_BUTTON_CLASS,
} from '@/components/auth/auth-shell';

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

  const [status, setStatus] = useState<'checking' | 'success' | 'error'>(
    token ? 'checking' : 'error'
  );
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    // Token hi nahi hai - kuch verify karne ko nahi. Backend call bhi nahi karte
    if (!token) {
      setStatus('error');
      setMessage(
        'This verification link is missing its token. Please use the link from your email, or register again.'
      );
      return;
    }

    // React 18 StrictMode development me effect 2 baar chala deta hai.
    // Verification token SINGLE-USE hai, isliye hum ek guard latch karte hain
    // taaki dobara call na jaaye aur valid token waste na ho.
    let cancelled = false;
    let started = false;

    if (started) return;
    started = true;

    (async () => {
      try {
        const res = await fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        const payload = await res.json().catch(() => ({}));

        if (cancelled) return;

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
        if (cancelled) return;
        setStatus('error');
        setMessage(
          'We could not reach the verification service. Please check your connection and try again.'
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  // ---- Checking state: spinner + "verifying" ----
  if (status === 'checking') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <p className="text-sm text-gray-400">Verifying your email address…</p>
        <p className="text-xs text-gray-500">This usually takes a moment.</p>
      </div>
    );
  }

  // ---- Success / Error state ----
  const success = status === 'success';

  return (
    <div className="space-y-5">
      <div
        role="status"
        className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${
          success
            ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300'
            : 'border-red-700/60 bg-red-950/40 text-red-300'
        }`}
      >
        {success ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
        ) : (
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
        )}
        <div className="min-w-0 space-y-1">
          <p className="font-medium leading-relaxed">
            {success ? 'Email verified' : 'Verification failed'}
          </p>
          <p className="leading-relaxed opacity-90">{message}</p>
          {success && email ? (
            <p className="pt-1 text-xs opacity-75">
              Verified address: <span className="font-medium">{email}</span>
            </p>
          ) : null}
        </div>
      </div>

      {/* Success me login, failure me register - dono ke liye clear next step */}
      {success ? (
        <Link href="/auth/login" className={PRIMARY_BUTTON_CLASS}>
          Continue to log in
        </Link>
      ) : (
        <Link href="/auth/register" className={PRIMARY_BUTTON_CLASS}>
          Register again
        </Link>
      )}
    </div>
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
