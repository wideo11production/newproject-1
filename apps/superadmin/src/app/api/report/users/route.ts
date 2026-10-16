// Per-user superadmin report - MERGES auth-service + billing-service
//
// Cross-database join is impossible in Postgres across services, so this proxy
// fetches from both services in parallel and merges by user ID.
//
// Each row:
//   - email, role, created_at            -> auth-service (users)
//   - upload_count, total_upload_bytes   -> auth-service (media_assets)
//   - ad_impressions, total_earnings_inr -> billing-service (content_revenue)
//   - subscription_plan, subscription_status -> billing-service (subscriptions)
//
// Hinglish comments: har block ka arth

import { NextResponse } from 'next/server';
import { bearerFromRequest, requireSuperadmin } from '@/lib/telemetry-proxy';

const AUTH_SERVICE = process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';
const BILLING_SERVICE = process.env.BILLING_INTERNAL_URL ?? 'http://billing-service:8082';

export async function GET(request: Request) {
  const guard = await requireSuperadmin(bearerFromRequest(request));
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status });
  }

  const authHeader = bearerFromRequest(request) as string;

  // ---- Fetch all three sources in parallel ----
  const [usersRes, revenueRes, subsRes] = await Promise.all([
    // All user activity from auth-service
    fetch(`${AUTH_SERVICE}/api/v1/auth/admin/activity/all`, {
      headers: { Authorization: authHeader },
      cache: 'no-store',
    }).catch(() => null),

    // Content revenue grouped by user from billing-service
    fetch(`${BILLING_SERVICE}/ads/revenue/user-summary`, {
      headers: { Authorization: authHeader },
      cache: 'no-store',
    }).catch(() => null),

    // All subscriptions from billing-service
    fetch(`${BILLING_SERVICE}/subscriptions`, {
      headers: { Authorization: authHeader },
      cache: 'no-store',
    }).catch(() => null),
  ]);

  // ---- Parse users ----
  const users = usersRes?.ok ? (await usersRes.json()).activities ?? [] : [];

  // ---- Parse revenue per user ----
  const revenueByUser = new Map<string, { impressions: number; earnings: number }>();
  if (revenueRes?.ok) {
    const rev = await revenueRes.json();
    const rows = rev.rows ?? rev ?? [];
    for (const r of rows as Record<string, unknown>[]) {
      const uid = String(r.user_id ?? r.userId ?? '');
      if (!uid) continue;
      revenueByUser.set(uid, {
        impressions: typeof r.ad_impressions === 'number' ? r.ad_impressions : Number(r.ad_impressions ?? 0) || 0,
        earnings: typeof r.total_earnings === 'number' ? r.total_earnings : Number(r.total_earnings ?? 0) || 0,
      });
    }
  }

  // ---- Parse subscriptions per user ----
  const subsByUser = new Map<string, { plan: string; status: string }>();
  if (subsRes?.ok) {
    const subs = await subsRes.json();
    const rows = subs.subscriptions ?? subs ?? [];
    for (const r of rows as Record<string, unknown>[]) {
      const uid = String(r.user_id ?? r.userId ?? '');
      if (!uid) continue;
      subsByUser.set(uid, {
        plan: String(r.plan_code ?? r.planCode ?? r.plan ?? ''),
        status: String(r.status ?? ''),
      });
    }
  }

  // ---- Merge ----
  const report = users.map((u: Record<string, unknown>) => {
    const uid = String(u.id ?? u.user_id ?? '');
    const rev = revenueByUser.get(uid);
    const sub = subsByUser.get(uid);

    // Count uploads from activity row
    const uploadCount = typeof u.upload_count === 'number' ? u.upload_count :
      typeof u.uploadCount === 'number' ? u.uploadCount : 0;
    const uploadBytes = typeof u.upload_bytes === 'number' ? u.upload_bytes :
      typeof u.uploadBytes === 'number' ? u.uploadBytes : 0;

    return {
      user_id: uid,
      email: String(u.email ?? ''),
      role: String(u.role ?? 'user'),
      created_at: u.created_at ?? u.createdAt ?? null,
      is_active: u.is_active ?? u.isActive ?? true,
      is_verified: u.is_verified ?? u.isVerified ?? false,

      // Uploads
      upload_count: uploadCount,
      upload_bytes: uploadBytes,

      // Earnings from ads
      ad_impressions: rev?.impressions ?? 0,
      total_earnings_inr: rev?.earnings ?? 0,

      // Subscription
      subscription_plan: sub?.plan ?? '',
      subscription_status: sub?.status ?? '',
    };
  });

  // Sort by earnings descending (top earners first)
  report.sort((a, b) => (b.total_earnings_inr as number) - (a.total_earnings_inr as number));

  return NextResponse.json({
    users: report,
    count: report.length,
    sources: {
      activity: usersRes?.ok ?? false,
      revenue: revenueRes?.ok ?? false,
      subscriptions: subsRes?.ok ?? false,
    },
  });
}
