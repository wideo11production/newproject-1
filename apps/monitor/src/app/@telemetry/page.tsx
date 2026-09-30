"use client";

// ============================================================================
// @telemetry - side panel
// ============================================================================
//
// ---- YE PEHLE 5 INVENTED NUMBERS THA ----
//
// Is file ka pehla version HAR metric ko hardcode karta tha, bina kisi data
// source ke:
//
//     Events/sec:     1.2K      <- likha hua
//     Avg. Latency:   12ms      <- likha hua
//     Error Rate:     0.01%     <- likha hua
//     Active Users:   245       <- likha hua
//     Session Duration: 12.5m   <- likha hua
//     Feature Usage:  Editor: 45%, Dashboard: 30%   <- likha hua
//
// Sab GREEN (`text-green-400`) the, "Real-time Telemetry" heading ke neeche.
// Yaani ek operator dekhta: "Error Rate 0.01%, sab healthy" - jabki system
// me aisa KOI metric exist hi nahi karta tha.
//
// ---- YE NUMBERS KAHAN SE AA SAKTE THE, AUR NAHI ----
//
// Verify kiya gaya: Prometheus me `http_requests_total`,
// `http_request_duration_seconds_bucket`, ya koi bhi `http_*` family ka
// metric EXIST NAHI karta (koi service /metrics par request metrics
// expose nahi karti). Isi liye:
//
//   - Events/sec, Latency, Error Rate -> koi source nahi. Instrument
//     karna padega (see MISSING INSTRUMENTATION neeche).
//   - Active Users / Session Duration -> Postgres me hain (`sessions`),
//     auth-service ke superadmin endpoint ke peeche. Saare users ke liye
//     expose nahi hote, isliye yahan nahi dikhaye.
//
// ---- RULE ----
//
// Is panel ka rule: KABHI number invent mat karo. Jo measure nahi ho sakta,
// use "n/a" dikhao - aur kyun, wo bhi. Ek khali cell honest hai; ek jhootha
// number dangerous hai. Operator ka sabse bada nuksaan ye hota hai ki wo
// number dekh kar bharosa kare.
//
// REAL data `/api/metrics` se aata hai, jo Prometheus se server-side query
// karta hai (browser ko Prometheus hostname dene ki zaroorat nahi).

import { useEffect, useState } from 'react';

export const dynamic = 'force-dynamic';

/** Same shape as `src/lib/prometheus.ts` returns. */
interface RealMetrics {
  containersUp: number | null;
  cpuCores: number | null;
  memoryGB: number | null;
  networkRxGB: number | null;
  dataEgress: {
    totalBytes: number | null;
    objectCount: number | null;
    bucket: string;
    source: 'live';
    scrapeError: number | null;
  };
  dataSource: 'live' | 'degraded';
  fetchedAt: string;
}

// A metric jo instrument nahi hai. `why` isliye zaroori hai: blank cell
// future me kisi aur se fill ho sakta hai, lekin "why" batane se koi
// jaanta hai ki ye jaan-boojh kar khaali hai - oversight nahi.
const NOT_INSTRUMENTED =
  'Go metrics par expose nahi hoti - service ne /metrics par sirf process_* expose kiya hai';

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-2" title={hint}>
      <span className="text-gray-300">{label}</span>
      <span className={value === 'n/a' ? 'text-gray-500' : 'text-green-400'}>
        {value}
      </span>
    </div>
  );
}

export default function TelemetryPage() {
  const [m, setM] = useState<RealMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/metrics', { cache: 'no-store' });
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setM(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'failed');
      }
    }
    load();
    const t = setInterval(load, 15000); // Prometheus ka scrape interval
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const fmtBytes = (b: number | null) => {
    if (b === null) return 'n/a';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(i === 0 ? 0 : 1)}${u[i]}`;
  };

  return (
    <div className="space-y-4 p-4">
      {/* ---- Infra (REAL) ---- */}
      <div className="rounded bg-gray-700 p-4">
        <h3 className="font-semibold">Infrastructure</h3>
        <div className="mt-2 space-y-2">
          {error ? (
            <p className="text-sm text-red-400">Error: {error}</p>
          ) : !m ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <>
              <Row
                label="Scrape targets up:"
                value={m.containersUp === null ? 'n/a' : String(m.containersUp)}
                hint="sum(up) from Prometheus - live scrape health"
              />
              <Row
                label="CPU (cores):"
                value={m.cpuCores === null ? 'n/a' : m.cpuCores.toFixed(2)}
                hint="cAdvisor container CPU - real"
              />
              <Row
                label="Memory:"
                value={m.memoryGB === null ? 'n/a' : `${m.memoryGB.toFixed(2)} GB`}
                hint="cAdvisor working set - real"
              />
              <Row
                label="Network RX:"
                value={fmtBytes(m.networkRxGB === null ? null : m.networkRxGB * 1024 ** 3)}
                hint="cAdvisor - real"
              />
              <Row
                label={`Storage (${m.dataEgress?.bucket ?? '?'}):`}
                value={
                  m.dataEgress?.scrapeError
                    ? 'scraper down'
                    : fmtBytes(m.dataEgress?.totalBytes ?? null)
                }
                hint="MinIO exporter - real bucket size"
              />
              <Row
                label="Objects:"
                value={
                  m.dataEgress?.objectCount === null || m.dataEgress?.objectCount === undefined
                    ? 'n/a'
                    : String(m.dataEgress.objectCount)
                }
                hint="MinIO exporter - real object count"
              />
            </>
          )}
        </div>
      </div>

      {/* ---- Request metrics (NOT instrumented) ----
          Ye section jaan-boojh kar khali rakha gaya hai. Khaali dikhne se
          pata chalta hai ki yahan kuch aana CHAHIYE tha, aur ye gap
          dashboard se nazarband nahi ho jayega. */}
      <div className="rounded bg-gray-700 p-4">
        <h3 className="font-semibold">Request Telemetry</h3>
        <div className="mt-2 space-y-2">
          <Row label="Events/sec:" value="n/a" hint={NOT_INSTRUMENTED} />
          <Row label="Avg. Latency:" value="n/a" hint={NOT_INSTRUMENTED} />
          <Row label="Error Rate:" value="n/a" hint={NOT_INSTRUMENTED} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-gray-400">
          Ye teen metrics abhi instrument nahi hain, isliye koi number
          dikhaya nahi gaya. Pehle yahan hardcoded values the jo bilkul
          fabricated thiyan.
        </p>
      </div>

      {/* ---- User activity (NOT instrumented) ---- */}
      <div className="rounded bg-gray-700 p-4">
        <h3 className="font-semibold">User Activity</h3>
        <div className="mt-2 space-y-2">
          <Row
            label="Active Users:"
            value="n/a"
            hint="needs a public aggregate endpoint; only the superadmin awareness endpoint exposes this today"
          />
          <Row label="Session Duration:" value="n/a" hint="same as above" />
        </div>
      </div>
    </div>
  );
}
