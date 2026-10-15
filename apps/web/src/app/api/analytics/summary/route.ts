// Minimal analytics summary proxy
// Aggregates what analytics-service exposes and returns the shape @analytics expects

import { NextResponse } from "next/server";

const ANALYTICS_SERVICE_URL =
  process.env.ANALYTICS_INTERNAL_URL ?? "http://analytics-service:8086";

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized", message: "Authorization required" }, { status: 401 });
    }

    // Fetch a few common endpoints in parallel; tolerate failures
    const [viewsRes, clicksRes, revenueRes] = await Promise.allSettled([
      fetch(`${ANALYTICS_SERVICE_URL}/api/v1/analytics/views?limit=1&offset=0`, { headers: { Authorization: authHeader }, cache: "no-store" }),
      fetch(`${ANALYTICS_SERVICE_URL}/api/v1/analytics/clicks?limit=1&offset=0`, { headers: { Authorization: authHeader }, cache: "no-store" }),
      fetch(`${ANALYTICS_SERVICE_URL}/api/v1/analytics/revenue?limit=1&offset=0`, { headers: { Authorization: authHeader }, cache: "no-store" }),
    ]);

    let viewsTotal = 0;
    if (viewsRes.status === "fulfilled" && viewsRes.value.ok) {
      try {
        const j = await viewsRes.value.json();
        viewsTotal = j.total ?? j.count ?? (Array.isArray(j.views) ? j.views.length : 0);
      } catch {}
    }

    let clicksTotal = 0;
    if (clicksRes.status === "fulfilled" && clicksRes.value.ok) {
      try {
        const j = await clicksRes.value.json();
        clicksTotal = j.total ?? j.count ?? (Array.isArray(j.clicks) ? j.clicks.length : 0);
      } catch {}
    }

    let revenueTotal = 0;
    if (revenueRes.status === "fulfilled" && revenueRes.value.ok) {
      try {
        const j = await revenueRes.value.json();
        revenueTotal = j.total_amount ?? j.total ?? (Array.isArray(j.reports) ? j.reports.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0) : 0);
      } catch {}
    }

    return NextResponse.json(
      {
        views: viewsTotal || 0,
        watchTime: 0,
        revenue: revenueTotal || 0,
        subscribers: clicksTotal || 0,
        fetched_at: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ error: "internal_error", message: String(e) }, { status: 500 });
  }
}
