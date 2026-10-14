// Password reset request page - /auth/reset-password
//
// Sends password reset email to the provided email address.
// Uses the same AuthShell as login/register for visual consistency.
//
// Hinglish comments: har block ka arth

'use client';

import { useState, useEffect, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@wideo11/ui/button';
import { Input } from '@wideo11/ui/input';
import { AlertCircle, Loader2, Mail } from 'lucide-react';

import {
  AuthShell,
  Field,
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  FORM_SPACING,
} from '@/components/auth/auth-shell';

import {
  grafanaTextMuted,
  productAccent,
} from '@wideo11/ui/design-system';

export default function ResetPasswordPage() {
  // ---- Form field states ----
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // ---- Form submission ----
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setMessage('');

    try {
      // Call reset password request endpoint
      const response = await fetch('/api/auth/password/reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
        }),
      });

      // Guard: non-JSON responses (e.g. 401 HTML from middleware, 5xx text) crash
      // `response.json()` with "Unexpected token '<'". Read the body once and
      // inspect the content-type before parsing.
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('This endpoint requires an active session. Please log in first.');
        }
        throw new Error('The server returned an unexpected response. Please try again later.');
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Request failed');
      }

      setStatus('success');
      setMessage(
        'If an account exists with that email, a password reset link has been sent.'
      );
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message || 'Something went wrong');
    }
  }

  // ---- Focus email input on mount ----
  useEffect(() => {
    const input = document.getElementById('reset-email-input');
    input?.focus();
  }, []);

  return (
    <AuthShell
      title="Reset your password"
      description="Enter your email to receive a password reset link"
    >
      <form onSubmit={onSubmit} className="flex flex-col space-y-6">
        <Field
          id="reset-email-input"
          label="Email address"
          error={status === 'error' ? message : undefined}
        >
          <Input
            id="reset-email-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT_CLASS}
            placeholder="you@example.com"
            required
          />
        </Field>

        {/* Submit button */}
        <Button
          type="submit"
          disabled={status === 'submitting'}
          className={`${PRIMARY_BUTTON_CLASS} ${status === 'submitting' ? 'opacity-90' : ''}`}
        >
          {status === 'submitting' ? (
            <>
              <Loader2 className="mr-2 h-2.5 w-2.5" />
              Sending...
            </>
          ) : (
            <>
              <Mail className="mr-2 h-2.5 w-2.5" aria-hidden="true" />
              Send reset link
            </>
          )}
        </Button>

        {/* Success/error message */}
        {status === 'success' && (
          <div className="flex items-start gap-2 rounded-md border-700/60 bg-green-950/40 p-4">
            <Mail className="mt-0.5 h-2.5 w-2.5 shrink-0 text-green-300" aria-hidden="true" />
            <span>{message}</span>
          </div>
        )}
        {status === 'error' && (
          <div className="flex items-start gap-2 rounded-md border-700/60 bg-red-950/40 p-4">
            <AlertCircle className="mt-0.5 h-2.5 w-2.5 shrink-0 text-red-300" aria-hidden="true" />
            <span>{message}</span>
          </div>
        )}

        {/* Back to login */}
        <div className="flex items-center justify-end pt-4">
          <Link href="/auth/login" className={`text-xs ${grafanaTextMuted} hover:${productAccent}`}>
            ← Back to login
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}