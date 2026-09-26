// GET /api/metrics - dashboard ke liye real Prometheus metrics
//
// NOTE: Ye route file me sirf HTTP methods export ho sakte hain. Isliye
// saara query logic `src/lib/prometheus.ts` me hai aur yahan sirf GET hai.
// Pehle dono ek hi file me the jo type error deta tha:
//   "Route does not match the required types of a Next.js Route"
//
// Hinglish: route file me sirf GET, queries alag file me
import { NextResponse } from 'next/server';
import { getPrometheusMetrics } from '@/lib/prometheus';

export async function GET() {
  const metrics = await getPrometheusMetrics();
  return NextResponse.json(metrics, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
