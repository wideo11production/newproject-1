// Login page - /auth/login
// Ye page pehle exist nahi karta tha, isliye landing page ke "Log in" link par 404 aata tha.
// App Router conventions follow karte hain: src/app/auth/login/page.tsx -> /auth/login
// Client Component hai kyunki form state, validation aur submit handling chahiye.
// Hinglish comments: har block ka arth samjhne ke liye.

'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@wideo11/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@wideo11/ui/card';
import { Input } from '@wideo11/ui/input';
import { Label } from '@wideo11/ui/label';
import { AlertCircle, Loader2 } from 'lucide-react';

export default function LoginPage() {
  // Form field states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Client side validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Submit state: idle | submitting | error
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  // Server se aaya hua message
  const [message, setMessage] = useState('');

  // Client side validation
  // Hinglish: submit se pehle validation taaki user ko turant feedback mile
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

  // Form submit handler
  // POST /api/auth/login - ye path bhi middleware rate limiter ke under aata hai
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!validate()) {
      return;
    }

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
        // Login successful - user ko dashboard par bhejte hain
        window.location.href = '/dashboard';
        return;
      }

      if (response.status === 429) {
        setStatus('error');
        setMessage(
          payload.message ?? 'Too many attempts from this network. Please wait 60 seconds.'
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
    <div className="flex min-h-full items-center justify-center bg-gray-950 px-6 py-12">
      <Card className="w-full max-w-md border-gray-800 bg-gray-900/60">
        <CardHeader>
          {/* Landing page ka Login link yahan land karta hai - ab 404 nahi hoga */}
          <CardTitle className="text-2xl text-white">Welcome back</CardTitle>
          <CardDescription className="text-gray-400">
            Log in to manage your channels, catalog and payouts.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* Email field */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-300">
                Email address
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="border-gray-700 bg-gray-950 text-white"
                aria-invalid={Boolean(errors.email)}
              />
              {errors.email ? <p className="text-xs text-red-400">{errors.email}</p> : null}
            </div>

            {/* Password field */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-300">
                Password
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                className="border-gray-700 bg-gray-950 text-white"
                aria-invalid={Boolean(errors.password)}
              />
              {errors.password ? (
                <p className="text-xs text-red-400">{errors.password}</p>
              ) : null}
            </div>

            {/* Server response message */}
            {message ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-red-700 bg-red-950/40 p-3 text-sm text-red-300"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{message}</span>
              </div>
            ) : null}

            {/* Submit button */}
            <Button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full bg-blue-600 text-white hover:bg-blue-500"
            >
              {status === 'submitting' ? (
                <>
                  {/* Spinner - submit hone ke dauran */}
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in
                </>
              ) : (
                'Log in'
              )}
            </Button>
          </form>

          {/* Register cross-link - naye users yahan bhejte hain */}
          <p className="mt-6 text-center text-sm text-gray-400">
            New to Wideo11?{' '}
            <Link href="/auth/register" className="text-blue-400 hover:text-blue-300">
              Create an account
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
