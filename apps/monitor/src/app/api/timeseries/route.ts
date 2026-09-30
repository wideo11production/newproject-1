// GET /api/timeseries - Prometheus range queries, server-side
//
// ---------------------------------------------------------------------------
// WHY THIS ROUTE EXISTS AT ALL
// ---------------------------------------------------------------------------
// Browser ko seedha `http://prometheus:9090` pe nahi bula sakte:
//
//   1. Wo ek INTERNAL Docker hostname hai. Browser ka DNS use resolve nahi
//      karta - "connection refused"/DNS error. (Pehle dashboard header me
//      ye URL render hota tha, jo user ko ek dead link dikhata tha.)
//   2. Prometheus me CORS nahi hai, to cross-origin fetch browser block hota.
//   3. Cluster topology browser ko expose karna security concern hai.
//
// Isliye SAB queries server-side hoti hain, sirf rendered data browser ko
// milta hai. Ye wahi pattern hai `api/metrics` ka; ye uska time-series
// wala version hai.
//
// ---------------------------------------------------------------------------
// QUERY ALLOWLIST - IMPORTANT
// ---------------------------------------------------------------------------
// `expr` ko seedha as a query string aane dena ye ek open proxy ban jayega:
// koi bhi `GET /api/timeseries?expr=<arbitrary PromQL>` chala sakta, aur
// Prometheus ko koi bhi heavy query de sakta - ya uske secrets (labels me
// user email, IP) scrape kar sakta. Do problems: abuse, aur data leak.
//
// Isliye browser sirf NAM bhejta hai (`panel=cpu`), aur NAM se query yahan
// map hoti hai. Unknown name 400 deta hai. Browser kabhi raw PromQL nahi
// bhej sakta.
//
// Naya panel add karna ho to `PANELS` me ek entry add karo. Isi list ka
// ek aur fayda: har panel ki query yahan visible hai, aur hum har ek ko
// VERIFY kar sakte hain ki uska data source maujood hai ya nahi - jo nahi
// kiya gaya tha, aur wahi wajah thi "No data" panels ka.
import { NextResponse } from 'next/server';
import { promRangeQuery, type RangeSeries } from '@/lib/prometheus';

export const dynamic = 'force-dynamic';

/** Browser in names ko bhej sakta hai - sirf ye, kuch aur nahi. */
type PanelName =
  | 'cpu'
  | 'memory'
  | 'network'
  | 'disk'
  | 'postgres_backends'
  | 'nats';

interface PanelDef {
  /** Prometheus range query. */
  expr: string;
  /** ECharts-friendly series name. */
  unit: string;
  /** Minutes of history. */
  window: number;
}

const PANELS: Record<PanelName, PanelDef> = {
  // `mode!="idle"` ZAROORI hai - iske bina idle time bhi count ho jata hai
  // aur total CPU usage galat (aur jyada) dikhta hai.
  cpu: {
    expr: 'sum(rate(container_cpu_usage_seconds_total{mode!="idle"}[2m]))',
    unit: 'cores',
    window: 60,
  },
  // working_set, na ki usage_bytes: ye hai woh figure jo OOM kill trigger
  // karta hai. usage_bytes me cache bhi count hota hai jo reclaim ho sakta
  // hai - working_set me nahi.
  memory: {
    expr: 'sum(container_memory_working_set_bytes)',
    unit: 'bytes',
    window: 60,
  },
  network: {
    expr:
      'sum(rate(container_network_receive_bytes_total[2m])) or ' +
      'sum(rate(container_network_transmit_bytes_total[2m]))',
    unit: 'Bps',
    window: 60,
  },
  // `/` NAHI: Docker Desktop ka node-exporter `--path.rootfs=/host` ke saath
  // chal raha hai, aur host filesystem `/host_mnt` (virtiofs) par dikhta
  // hai. Verified: koi `/` mountpoint nahi hai.
  disk: {
    expr:
      '100 * (1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay",mountpoint="/host_mnt"}' +
      ' / node_filesystem_size_bytes{fstype!~"tmpfs|overlay",mountpoint="/host_mnt"}))',
    unit: 'percent',
    window: 60,
  },
  postgres_backends: {
    expr: 'sum(pg_stat_database_numbackends)',
    unit: 'short',
    window: 30,
  },
  nats: {
    // NOTE: `gnatsd_` prefix, `nats_` NAHI. Exporter v0.15.0 yehi emit
    // karta hai. Galat prefix = chupchap "No data".
    expr: 'gnatsd_varz_connections',
    unit: 'short',
    window: 30,
  },
};

const VALID = Object.keys(PANELS) as PanelName[];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requested = (searchParams.get('panel') ?? '').split(',').filter(Boolean);

  if (requested.length === 0) {
    return NextResponse.json(
      { error: 'panel query parameter is required', valid: VALID },
      { status: 400 }
    );
  }

  // Unknown panel REJECT - isse open proxy banne se rokta hai.
  const unknown = requested.filter((p) => !VALID.includes(p as PanelName));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `unknown panel(s): ${unknown.join(', ')}`, valid: VALID },
      { status: 400 }
    );
  }

  const out: Record<string, { series: RangeSeries[]; unit: string; error?: string }> = {};

  // Promise.all: saare panels parallel chalein. Sequential karne par 6
  // panels ka dashboard 6 round-trip latency jodta hai, jabki har query
  // alag hai aur koi dusre par depend nahi karti.
  await Promise.all(
    requested.map(async (name) => {
      const p = PANELS[name as PanelName];
      try {
        out[name] = { series: await promRangeQuery(p.expr, { rangeSeconds: p.window * 60 }), unit: p.unit };
      } catch (err) {
        // Ek panel fail hone par baaki sab render ho - isiliye ye
        // per-panel error hai, poore request ka nahi. Isse user ko pata
        // chalta hai KI panel khaali hai, aur dashboard adhoora dikhta hai
        // (better than a blank page that looks broken).
        out[name] = {
          series: [],
          unit: p.unit,
          error: err instanceof Error ? err.message : 'query failed',
        };
      }
    })
  );

  return NextResponse.json(
    { data: out, fetchedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
