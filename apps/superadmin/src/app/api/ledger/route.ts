// Unified ledger proxy - MERGES auth-service + billing-service
//
// KYUN YE HAI (data integrity):
// `users` table        -> AUTH database (auth-service)
// `device_ad_revenue`  -> BILLING database (billing-service)
//
// Postgres me cross-database SQL JOIN possible NAHI hai. Isliye agar superadmin
// sirf ek service se data le, to half columns khali rah jayenge.
//
// Is proxy dono ko parallel fetch karke MERGE karta hai, taaki Awareness grid
// me ek hi row me:
//   - Registration date   (auth DB)
//   - Per-device earnings (billing DB)
// dono dikhaye ja sakein.
//
// Hinglish comments: har block ka arth
import { NextResponse } from 'next/server';

const AUTH_SERVICE = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';
const BILLING_SERVICE = process.env.BILLING_INTERNAL_URL ?? 'http://billing-service:8082';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Superadmin access token required' },
      { status: 401 }
    );
  }

  // ---- Dono sources PARALLEL fetch (cross-DB merge) ----
  //
  // PATH NOTE: auth-service routes `/api/v1/auth/*` ke neeche hain, lekin
  // billing-service ke routes ROOT pe hain (`/payouts`, `/admin/device-revenue`).
  // Pehle yahan bhi `/api/v1/auth/` prefix lagaya tha jiski wajah se 404 aa
  // raha tha. Do services ka URL shape alag hai - ye documented hai.
  const [activityRes, revenueRes] = await Promise.all([
    fetch(`${AUTH_SERVICE}/api/v1/auth/admin/activity/all`, {
      headers: { Authorization: authHeader },
      cache: 'no-store',
    }).catch(() => null),
    fetch(`${BILLING_SERVICE}/admin/device-revenue`, {
      headers: { Authorization: authHeader },
      cache: 'no-store',
    }).catch(() => null),
  ]);

  const activities = activityRes?.ok ? (await activityRes.json()).activities ?? [] : [];
  const revenue = revenueRes?.ok ? (await revenueRes.json()) : null;

  // ---- Device revenue ko map me daalo for O(1) lookup ----
  const revenueByDevice = new Map<string, Record<string, unknown>>();
  if (revenue?.devices) {
    for (const d of revenue.devices as Record<string, unknown>[]) {
      revenueByDevice.set(String(d.device_id), d);
    }
  }

  // ---- MERGE: har activity row me device revenue attach karo ----
  //
  // NOTE: user -> device mapping `user_sessions.device_id` se aati hai.
  // Jo bhi device revenue match hua, uska data row me chipak jayega.
  const merged = activities.map(
    (a: Record<string, unknown>) => ({
      ...a,
      // Device earnings (billing DB se)
      device_revenue: revenueByDevice.get(String(a.primary_device_id ?? '')) ?? null,
    })
  );

  return NextResponse.json({
    activities: merged,
    // Saare device revenue alag se bhi bhejte hain - grid unhe alag table me
    // device-level dikha sakta hai (device identifier ke saath)
    devices: revenue?.devices ?? [],
    period: revenue?.period ?? null,
    cap_inr: revenue?.cap_inr ?? null,
    review_at_inr: revenue?.review_at_inr ?? null,
    // Batate hain kaunsa source fail hua (transparent diagnostics)
    sources: {
      activity: activityRes?.ok ?? false,
      device_revenue: revenueRes?.ok ?? false,
    },
  });
}
