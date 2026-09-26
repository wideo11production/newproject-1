// Registration page - /auth/register
// Ye page pehle exist nahi karta tha, isliye landing page ke "Register" link par 404 aata tha.
// App Router conventions follow karte hain: src/app/auth/register/page.tsx -> /auth/register
// Client Component hai kyunki form state, validation aur submit handling chahiye.
// Hinglish comments: har block ka arth samjhne ke liye.

'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@wideo11/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@wideo11/ui/card';
import { Input } from '@wideo11/ui/input';
import { Label } from '@wideo11/ui/label';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

export default function RegisterPage() {
  // Form ke field states - har field ka apna controlled state hai
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Client side validation errors ka state
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Submit state: idle | submitting | success | error
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  // Server se aaya hua message
  const [message, setMessage] = useState('');

  // Client side validation - form submit se pehle chalta hai
  // Hinglish: submit se pehle hi galtiyan pakad lete hain taaki user ko clear feedback mile
  function validate(): boolean {
    const nextErrors: Record<string, string> = {};

    if (!fullName.trim()) {
      nextErrors.fullName = 'Full name is required';
    }

    // Basic email shape check - domain aur @ dono hone chahiye
    if (!email.trim()) {
      nextErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      nextErrors.email = 'Enter a valid email address';
    }

    if (!password) {
      nextErrors.password = 'Password is required';
    } else if (password.length < 8) {
      // 8 character minimum - weak password block karne ke liye
      nextErrors.password = 'Password must be at least 8 characters';
    }

    setErrors(nextErrors);
    // Object.keys empty hua to sab theek hai
    return Object.keys(nextErrors).length === 0;
  }

  // Form submit handler
  // POST /api/auth/register par jaata hai - ye path middleware ke rate limiter
  // ke under aata hai (1 request per IP per minute), isliye defense barrier engage hota hai
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Pehle client validation
    if (!validate()) {
      return;
    }

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
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (response.ok) {
        setStatus('success');
        setMessage(payload.message ?? 'Registration submitted successfully.');
      } else if (response.status === 429) {
        // Rate limiter ne request block ki - user ko clearly bata dete hain
        setStatus('error');
        setMessage(
          payload.message ?? 'Too many attempts from this network. Please wait 60 seconds.'
        );
      } else {
        setStatus('error');
        setMessage(payload.error ?? payload.message ?? 'Registration failed. Please try again.');
      }
    } catch {
      // Network failure case - user ko inform karte hain
      setStatus('error');
      setMessage('Network error. Please check your connection and try again.');
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gray-950 px-6 py-12">
      <Card className="w-full max-w-md border-gray-800 bg-gray-900/60">
        <CardHeader>
          {/* Landing page ka Register link yahan land karta hai - ab 404 nahi hoga */}
          <CardTitle className="text-2xl text-white">Create your account</CardTitle>
          <CardDescription className="text-gray-400">
            Start publishing on Wideo11. Free to begin, no card required.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* Full name field */}
            <div className="space-y-2">
              <Label htmlFor="fullName" className="text-gray-300">
                Full name
              </Label>
              <Input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Aarav Sharma"
                className="border-gray-700 bg-gray-950 text-white"
                aria-invalid={Boolean(errors.fullName)}
              />
              {errors.fullName ? (
                <p className="text-xs text-red-400">{errors.fullName}</p>
              ) : null}
            </div>

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
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="border-gray-700 bg-gray-950 text-white"
                aria-invalid={Boolean(errors.password)}
              />
              {errors.password ? (
                <p className="text-xs text-red-400">{errors.password}</p>
              ) : null}
            </div>

            {/* Server response message - success ya error dono ke liye */}
            {message ? (
              <div
                role="status"
                className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                  status === 'success'
                    ? 'border-green-700 bg-green-950/40 text-green-300'
                    : 'border-red-700 bg-red-950/40 text-red-300'
                }`}
              >
                {status === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{message}</span>
              </div>
            ) : null}

            {/* Submit button - loading state ke saath */}
            <Button
              type="submit"
              disabled={status === 'submitting' || status === 'success'}
              className="w-full bg-blue-600 text-white hover:bg-blue-500"
            >
              {status === 'submitting' ? (
                <>
                  {/* Spinner - submit hone ke dauran dikhta hai */}
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating account
                </>
              ) : status === 'success' ? (
                'Account created'
              ) : (
                'Create account'
              )}
            </Button>
          </form>

          {/* Login cross-link - registration ke baad yahan aa sakte hain */}
          <p className="mt-6 text-center text-sm text-gray-400">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-blue-400 hover:text-blue-300">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
