'use client';

// ============================================================================
// Security setup page - /auth/security-setup
// ============================================================================
//
// Ye page MANDATORY security Chakravyuh (PIN + biometric + 3 security
// questions) render karta hai. Ye tab tak dikhta hai jab user logged-in hai
// par usne security setup COMPLETE nahi kiya.
//
// ---- KYUN YE PAGE ZAROORI HAI ----
// Pehle security gate sirf `/auth/login` ke andar render hota tha. Matlab:
//   1. User login karta -> gate dikhta
//   2. Gate render hote-hote user /dashboard pe chala jata
//   3. Middleware sirf JWT validity check karta tha (security status nahi)
//   4. RESULT: security setup SKIP karke dashboard aa gaya
//
// Is page + middleware enforcement ke saath:
//   - Middleware har protected request pe `setup_complete` verify karta hai
//   - Complete nahi hai to yahan redirect hota hai
//   - Is page pe gate render hoti hai (token cookie se, httpOnly)
//
// TOKEN: gate ko token ki zaroorat NAHI hai - security API calls same-origin
// proxy (`/api/auth/security/*`) par jaati hain jo server-side cookie se
// token attach karta hai.
//
// Hinglish comments: har block ka arth

import { useRouter } from 'next/navigation';
import SecuritySetupGate from '@/components/security/security-setup-gate';

/**
 * SecuritySetupPage - gate render karta hai, complete hone par dashboard.
 *
 * NOTE: `onComplete` ke baad full reload (`window.location.href`) karte
 * hain, `router.push` nahi. Reason: setup complete hone ke baad middleware
 * ka cached "setup incomplete" state invalidate karna zaroori hai. Full page
 * load se middleware dobara run hota hai aur fresh status fetch hota hai.
 * `router.push` (client-side nav) se middleware middleware-triggered
 * navigation pe nahi chalta, to user wahi stale redirect loop me fas sakta
 * hai.
 */
export default function SecuritySetupPage() {
  const router = useRouter();

  return (
    <SecuritySetupGate
      // Token optional hai ab - proxy cookie se kaam chalata hai.
      // Empty string dena safe hai kyunki gate ise security calls me use
      // nahi karta (sirf webauthn enrollment ke liye tha, jo ab bhi proxy
      // se cookie padhta hai).
      accessToken=""
      onComplete={() => {
        // Cache-busting full reload - middleware fresh status check kare.
        window.location.href = '/dashboard';
      }}
    />
  );
}
