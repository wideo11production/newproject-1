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
import { bearerFromRequest, requireSuperadmin } from '@/lib/telemetry-proxy';

const AUTH_SERVICE = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';
const BILLING_SERVICE = process.env.BILLING_INTERNAL_URL ?? 'http://billing-service:8082';

export async function GET(request: Request) {
  // ----------------------------------------------------------------------------
  // YE PEHLE SIRF `if (!authHeader)` CHECK KARTA THA. SIRF PRESENCE.
  // ----------------------------------------------------------------------------
  //
  // Matlab is route par koi bhi LOGGED-IN user - koi bhi normal creator - poora
  // user ledger padh sakta tha: har user ki email, registration date, sessions,
  // online minutes, devices, role, AUR har device ka ad revenue (₹ amounts).
  // Role check zero tha. Token verification zero thi - koi bhi string chalta tha.
  //
  // Ye isliye bhi dangerous hai kyunki ye route `middleware.ts` ke gate ke PICHHE
  // hai, jahan `requireRole: ['superadmin']` hai - lekin middleware tabhi chalti
  // hai jab session cookie ho. Ye route khud `Authorization` header padhta hai.
  // Do alag auth surfaces, aur sirf ek pe check tha.
  //
  // Ab `requireSuperadmin` - WOHI function jo `api/clicks` use karta hai. Ek
  // guard, har route ke liye. Do copies me se ek weak reh jaata hai, ye wahi
  // galti hai jo `check-app-gates.mjs` ko banata hai.
  // `bearerFromRequest`, NOT `request.headers.get('authorization')`.
  //
  // The browser sends an httpOnly cookie and cannot attach a header by hand - that
  // is the property that keeps the session token out of JavaScript. Reading the
  // header here therefore found nothing, every relay 401'd, and the dashboard
  // reported "Your session ended" to an operator whose session was still valid.
  const guard = await requireSuperadmin(bearerFromRequest(request));
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status });
  }

  // Verified, and known to be superadmin/recovery. Now relay.
  const authHeader = bearerFromRequest(request) as string;

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

  // ---- MERGE: attach device revenue to each activity row ----
//
// -----------------------------------------------------------------------------
// THIS WAS JOINING ON A FIELD THAT DOES NOT EXIST
// -----------------------------------------------------------------------------
//
// The original line was:
//
//     device_revenue: revenueByDevice.get(String(a.primary_device_id ?? '')) ?? null
//
// `primary_device_id` is present on **no struct in this repository**. It is not a
// column, not a Go field, not a JSON tag. So:
//
//   a.primary_device_id      ->  undefined
//   String(undefined ?? '')  ->  ''
//   revenueByDevice.get('')  ->  undefined
//   ... ?? null              ->  null
//
// Every user, every request, forever. Not an occasional failure - a *structurally*
// impossible one, and completely silent: HTTP 200, correct row count, `null`
// revenue, and a `sources.device_revenue: true` telling the operator the upstream
// was healthy.
//
// That last detail is why it survived. The route already had a diagnostics block
// reporting which source failed, and it reported SUCCESS, because billing really
// was reachable. The failure was in the join, which no diagnostic covered.
//
// -----------------------------------------------------------------------------
// WHY THE FIX IS A DEVICE LIST, NOT A "PRIMARY DEVICE" FIELD
// -----------------------------------------------------------------------------
//
// The join is user -> devices -> revenue, and that is the real shape of the data.
// Billing's `device_ad_revenue` is keyed by `DeviceID`, a device fingerprint. A
// user may have several, and their revenue is the SUM over the devices they used.
//
// Picking one "primary" device would be a design choice that discards revenue the
// user actually earned, and it would have to be defined on one side and guessed on
// the other - which is how `primary_device_id` came to exist in the first place:
// somebody assumed a single device per user, wrote the assumption into the client,
// and never found out it was wrong because `undefined` looks exactly like "no
// revenue".
//
// auth-service now returns `device_ids` on every activity row
// (`UserActivity.DeviceIDs`), built from `user_sessions.device_id`. The join
// below is on real data end to end.
//
// ---- WHY A SUM, AND WHY IT IS SAFE TO BE ZERO ----
//
// A user with devices but no `device_ad_revenue` row gets `0`, which is CORRECT:
// `RecordAdRevenue` has no production caller yet, so most devices genuinely have
// no revenue recorded. Returning `0` rather than `null` distinguishes "measured,
// nothing earned" from "we could not find the user" - and the second case now
// happens only when the account has no devices at all, which is visible.

type DeviceRevenueRow = Record<string, unknown>;

/**
 * Total revenue for a set of devices.
 *
 * Reads `total_revenue` because that is the field `device_ad_revenue` declares.
 * The value is a `numeric(20,2)` string on the wire, so it is coerced rather than
 * added as a string - `"10.00" + "5.00"` is `"10.005.00"`, which is `NaN` in
 * every dashboard that touches it.
 */
function sumRevenue(rows: DeviceRevenueRow[]): number {
  let total = 0;
  for (const r of rows) {
    const raw = r.total_revenue ?? r.TotalRevenue ?? 0;
    const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

const merged = activities.map((a: Record<string, unknown>) => {
  const deviceIds = Array.isArray(a.device_ids) ? (a.device_ids as string[]) : [];

  // Every revenue row belonging to ANY device this user has used.
  const rows = deviceIds
    .map((id) => revenueByDevice.get(id))
    .filter((r): r is DeviceRevenueRow => Boolean(r));

  return {
    ...a,
    // The revenue rows themselves, so the UI can show the device breakdown rather
    // than a single number with no provenance.
    device_revenue_rows: rows,
    device_revenue_count: rows.length,
    // 0, not null - see the note above. `null` is reserved for "we looked and this
    // account has no devices", which is a different statement.
    device_revenue: deviceIds.length > 0 ? sumRevenue(rows) : null,
  };
});

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
