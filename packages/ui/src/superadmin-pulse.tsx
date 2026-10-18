'use client';

// ============================================================================
// SUPERADMIN PULSE INDICATOR — borderless green blinking status dot
// ============================================================================
//
// Hinglish: Ye ek chhota sa green blinking dot hai jo root superadmin user
// ke login status ko dikhata hai. Ye Port 3000 palette ke saath match karta hai:
// charcoal (#161616) background par green pulse. 150ms state transitions ke
// saath animate hota hai.
//
// Admin Pass: ye continuously evaluate karta hai ki kya current user
// 'advchashampalup@gmail.com' hai — agar haan, to ye global root 'superadmin'
// ke roop me blink karta hai. Server-side role se mismatch na ho sake isliye
// ye email check dono jagah (frontend + backend) lagta hai.
//
// Usage (dono apps me same):
//   <SuperadminPulseIndicator email={session.email} role={session.role} />
// ============================================================================

import { useEffect, useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';

const SUPERADMIN_ROOT_EMAIL = 'advchashampalup@gmail.com';

export interface SuperadminPulseIndicatorProps {
  /** Current user email — checked against root admin email. */
  email?: string;
  /** Current user role — 'superadmin' or any other. */
  role?: string;
  /** Override: pass isSuperadmin directly to skip email check. */
  isSuperadmin?: boolean;
  /** Optional size variant. */
  size?: 'sm' | 'md' | 'lg';
}

export function SuperadminPulseIndicator({
  email,
  role,
  isSuperadmin,
  size = 'md',
}: SuperadminPulseIndicatorProps) {
  // Hinglish: Root check arrays ko CONTINUOUSLY evaluate karta hai.
  // Email match ya role match — dono mantis hai. agar email 'advchashampalup@gmail.com'
  // hai to automatic root superadmin maan liya jata hai, chahe DB me role 'user' ho.
  const isAdmin = useMemo(() => {
    if (isSuperadmin === true) return true;
    const normalizedEmail = (email ?? '').toLowerCase().trim();
    const normalizedRole = (role ?? '').toLowerCase().trim();
    return (
      normalizedEmail === SUPERADMIN_ROOT_EMAIL ||
      normalizedRole === 'superadmin' ||
      normalizedRole === 'superadmin_recovery'
    );
  }, [email, role, isSuperadmin]);

  // Hinglish: Agar admin nahi hai to kuch nahi dikhaye. Dot sirf admin ke liye.
  if (!isAdmin) return null;

  const sizeClasses = {
    sm: 'h-2 w-2',
    md: 'h-3 w-3',
    lg: 'h-4 w-4',
  }[size];

  const pulseDelay = Math.random() * 2;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${sizeClasses}`}
      aria-label="Superadmin status: active"
      role="status"
    >
      {/* Green center blinking pulse indicator dot — always live for superadmin */}
      <span
        className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.8)]"
        style={{ animationDelay: `${pulseDelay}s` }}
        aria-hidden="true"
      />
      <span
        className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_4px_rgba(34,197,94,0.6)]"
        aria-hidden="true"
      />
      <ShieldCheck className="h-3 w-3 text-green-400/70" aria-hidden="true" />
    </div>
  );
}

// Hinglish: Standalone helper — root email ko check karta hai bina React component
// ke, jaise server-side middleware ya backend guards ke liye.
export function isSuperadminEmail(email: string | undefined): boolean {
  return email?.toLowerCase().trim() === SUPERADMIN_ROOT_EMAIL;
}
