// Click Tracking + Security Audit (frontend)
//
// YE KYA KARTA HAI:
// 1. `reportSecurityViolation` - security event report karta hai
// 2. Click capture NAHI - wo `GlobalActivityTracker` karta hai
//
// ----------------------------------------------------------------------------
// YE FILE CLICK CAPTURE KE LIYE AB USE NAHI HOTI. AUR YE JAAN-BOJH KAR HAI.
// ----------------------------------------------------------------------------
//
// Ye hook pehle `document` par ek TEESRA capture-phase `click` listener lagati
// thi - jabki `apps/web/src/app/layout.tsx:65` par `GlobalActivityTracker` pehle
// se mounted hai. Dono same phase me sunte hain, dono same queue bharte hain, dono
// `/api/audit` par POST karte hain.
//
// Matlab `/auth/login`, `/auth/register` aur `/auth/security-setup` - teeno pages
// par HAR CLICK DO BAAR LIKHI JA RAHI THI. Ye bug dikhta nahi: ledger bhari hui
// lagti hai, dashboard "clicks aa rahe hain" dikhata hai, aur koi test fail nahi
// hota. Sirf `COUNT(*)` galat hota hai - aur wahi number jo product decisions
// liy jaate hain.
//
// Doosri wajah se ye schema bhi galat thi. Ye `surface` aur `element_id` bhejti
// hi nahi thi, jabki dono `ClickEventInput` me NON-OPTIONAL hain. Matlab in teen
// pages ke rows `surface: undefined` ke saath likhte the - exactly wahi collision
// jisse `surface` column add kiya gaya tha. Ek copy sahi thi aur ek nahi, aur
// jis par bharosa tha wahi galat thi.
//
// ----------------------------------------------------------------------------
// AB YE FILE KYA KARTA HAI
// ----------------------------------------------------------------------------
//
// Sirf `reportSecurityViolation`, jo security events bhejta hai - config tamper,
// rate-limit bypass attempt, auth-failure spike. Ye
// `@wideo11/ui/audit-handler` se jaata hai, wahi path se jaisa clicks, aur
// `identityHeaders` wala verified session use karta hai.
//
// Click capture ke liye SAHI jagah: `@wideo11/ui/activity-tracker`, jo app layout
// me ek baar mount hota hai aur poori app ke liye capture karta hai.
//
// Ek capture path. Ek schema. Ek jagah.
//
'use client';

import { API_ENDPOINT as AUDIT_ENDPOINT } from './audit-endpoint';

// ---- Config ----
const VIOLATION_KEY = 'wideo11_security_violations';

export interface SecurityViolation {
  id: string;
  timestamp: string;
  /** Kya violate hua */
  type: 'CONFIG_TAMPER' | 'RATE_LIMIT_BYPASS_ATTEMPT' | 'AUTH_FAILURE_SPIKE';
  /** Details */
  detail: string;
  /** Kahan se aaya */
  page: string;
  userAgent: string;
}

/**
 * reportSecurityViolation - staff trap / config tamper report
 *
 * JAB call karna hai: jab pata chale ki hardcoded config change hui hai,
 * rate limit bypass attempt hua hai, ya auth failures spike kar rahe hain.
 *
 * Ye superadmin dashboard ka "Awareness Reports" section consume karta hai
 * aur RED pulsing alert flash karta hai.
 */
export async function reportSecurityViolation(
  type: SecurityViolation['type'],
  detail: string
) {
  const violation: SecurityViolation = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    type,
    detail,
    page: typeof window !== 'undefined' ? window.location.pathname : 'unknown',
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : 'unknown',
  };

  // Local me turant save (UI turant dikha sake)
  try {
    const existing = JSON.parse(localStorage.getItem(VIOLATION_KEY) ?? '[]');
    localStorage.setItem(
      VIOLATION_KEY,
      JSON.stringify([...existing, violation].slice(-100))
    );
  } catch {
    // ignore
  }

  // Server ko bhejo. `/api/audit` se - wahi endpoint jo clicks use karte hain, taaki
  // ek hi schema, ek hi rate limit aur ek hi verified-attribution path ho.
  //
  // Pehle ye `${API_ENDPOINT}/violation` bhejta tha, jiska route KISI app me
  // exist nahi karta tha. Iska matlab: 404, silently swallowed, aur violation
  // server par KABHI nahi pohochti. Local storage me dikhti thi, dashboard par
  // nahi - yaani wo security alert jo "master dashboard par RED dikhta hai" wo
  // kabhi bhi kisi ko nahi dikhta tha.
  try {
    await fetch(`${AUDIT_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [
          {
            timestamp: violation.timestamp,
            page: violation.page,
            surface: 'web',
            target: `security:${violation.type}`,
            label: violation.detail,
            element_id: '',
            x: 0,
            y: 0,
            referrer: '',
          },
        ],
      }),
      keepalive: true,
    });
  } catch {
    // ignore - local me save hai
  }

  return violation;
}

/**
 * getSecurityViolations - local violations padho (dashboard ke liye)
 */
export function getSecurityViolations(): SecurityViolation[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(VIOLATION_KEY) ?? '[]');
  } catch {
    return [];
  }
}
