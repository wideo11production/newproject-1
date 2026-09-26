// Currency service proxy helper (server-side only)
//
// KYUN YE ZAROORI HAI:
// Currency dashboard browser me chalti hai (port 3007) aur service 8086 par hai.
// Browser seedha service ko call karta to CROSS-ORIGIN request hota
// (localhost:3007 -> localhost:8086), aur browser CORS block kar deta tha:
//   "Failed to fetch" / "Cannot reach currency service"
//
// Kyunki currency-service me CORS headers nahi hain (aur karne ki zarurat
// bhi nahi - service internal hona chahiye), hum SAME-ORIGIN proxy banate hain:
//   Browser -> /api/rates (port 3007, same origin) -> currency-service (internal)
//
// Isse:
//   - CORS ka issue permanently khatam
//   - Service browser se directly expose NAHI hota (security better)
//   - Internal service URL chhupi rehti hai
//
// Hinglish: browser same-origin proxy use karta hai - CORS problem solved
import { NextResponse } from 'next/server';

// Internal service URL - container network se resolve hota hai.
// NOTE: ye "currency-service:8086" hai (internal), browser ko iska pata nahi hona chahiye.
const SERVICE_URL =
  process.env.CURRENCY_INTERNAL_URL ?? 'http://currency-service:8086';

/**
 * forwardToCurrency service ke kisi bhi path tak request bhejta hai
 * Timeout ke saath taaki service hang ho to UI freeze na ho.
 */
export async function forwardToCurrency(
  path: string,
  init?: RequestInit
) {
  const controller = new AbortController();
  // 10 second timeout - user ko jaldi feedback mile
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${SERVICE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      // Real-time data - kabhi cache nahi
      cache: 'no-store',
    });
    clearTimeout(timeout);

    const payload = await res.json().catch(() => ({}));

    // Service ka status pass-through karte hain (200, 400, 404 etc.)
    return NextResponse.json(payload, { status: res.status });
  } catch (err) {
    clearTimeout(timeout);

    // Ye error tab aata hai jab service down hai / network fail
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Currency service timed out'
        : 'Cannot reach currency service';

    return NextResponse.json(
      {
        error: 'Service Unavailable',
        message,
        detail: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 503 }
    );
  }
}
