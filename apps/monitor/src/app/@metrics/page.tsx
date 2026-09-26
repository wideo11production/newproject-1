// Metrics Dashboard Page - REAL Prometheus data (fake mock data DELETED)
//
// PEHLE KYA THA (deleted):
//   - generateMockMetrics() jo Math.random() se fake numbers bana raha tha
//   - Wo KABHI real data nahi dikhata tha - sirf "real" dikhne ka illusion
//   - Ab wo function aur uska poora fake data structure REMOVED hai
//
// AB KYA HAI:
//   - /api/metrics se REAL Prometheus data aata hai
//   - Har metric ke saath source label hai:
//       "live"   = real Prometheus query
//       "seeded" = placeholder (MinIO ne abhi Prometheus export nahi kiya)
//   - Jo metric real nahi hai, wo UI me CLEARLY "SEEDED" dikhata hai -
//     pehle ki tarah fake ko real jaisa dikhate hue NAHI
//
// Hinglish comments: har block ka arth

'use client';

import { useEffect, useState } from 'react';
import { Activity, Server, Database, ShieldCheck, ShieldAlert, Gauge, HardDrive, AlertCircle, CheckCircle2 } from 'lucide-react';

const THRESHOLD = 76; // 76% hard ceiling

// Real metrics ka shape - /api/metrics se aata hai
interface RealMetrics {
  containersUp: number | null;
  containersUpError?: string;
  cpuCores: number | null;
  cpuCoresError?: string;
  memoryGB: number | null;
  memoryError?: string;
  networkRxGB: number | null;
  networkRxError?: string;
  dataEgress: {
    rateMBps: number;
    bucket: string;
    source: 'seeded';
    note: string;
  };
  prometheusUrl: string;
  fetchedAt: string;
}

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<RealMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  useEffect(() => {
    // Real metrics fetch karo - 15 second interval (Prometheus ka scrape
    // interval bhi 15s hai, isliye hum bhi wahi rate use kar rahe hain)
    async function fetchMetrics() {
      try {
        const res = await fetch('/api/metrics', { cache: 'no-store' });
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data = await res.json();
        setMetrics(data);
        setLastUpdated(data.fetchedAt);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
      }
    }

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 15000);
    return () => clearInterval(interval);
  }, []);

  // Loading state
  if (!metrics) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-gray-400">
        <div className="text-center">
          <Activity className="mx-auto mb-3 h-8 w-8 animate-pulse text-blue-400" />
          <p>{error ? `Error: ${error}` : 'Connecting to Prometheus...'}</p>
        </div>
      </div>
    );
  }

  // ---- Derived real values ----
  // CPU percent: cores use ho rahe hain. Host typically 8-16 cores rakhta hai,
  // lekin exact count pata nahi - isliye hume percent ke bajaye CORES dikhate
  // hain (zyada honest). Percent chahiye to total cores SSOT se aayega.
  const cpuHealthy = metrics.cpuCores !== null && metrics.cpuCores < 4; // <4 cores = healthy
  const memHealthy = metrics.memoryGB !== null && metrics.memoryGB < 8; // <8GB = healthy
  const containersHealthy = metrics.containersUp !== null && metrics.containersUp > 0;

  // Overall health: sab real metrics healthy hain
  const allHealthy = cpuHealthy && memHealthy && containersHealthy;

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-gray-100">
      {/* ---- Header ---- */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Real System Metrics</h1>
          <p className="text-sm text-gray-400">
            Live from Prometheus • <span className="text-gray-500">{metrics.prometheusUrl}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Last updated</p>
          <p className="font-mono text-sm text-green-400">
            {new Date(lastUpdated).toLocaleTimeString()}
          </p>
        </div>
      </div>

      {/* ---- Overall health banner ---- */}
      <div
        className={`mb-6 flex items-center gap-3 rounded-lg border p-4 ${
          allHealthy
            ? 'border-green-700/60 bg-green-950/30'
            : 'border-red-700/60 bg-red-950/30'
        }`}
      >
        {allHealthy ? (
          <>
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
            </span>
            <span className="font-semibold text-green-300">ALL SYSTEMS NOMINAL</span>
            <span className="text-sm text-gray-400">Live data from Prometheus</span>
          </>
        ) : (
          <>
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
            <span className="font-semibold text-red-300">ATTENTION REQUIRED</span>
            <span className="text-sm text-gray-400">Check the metrics below</span>
          </>
        )}
      </div>

      {/* ---- Real metric cards ---- */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Containers up (REAL) */}
        <MetricCard
          label="Containers Up"
          value={metrics.containersUp}
          unit=""
          healthy={containersHealthy}
          source="live"
          icon={<Server className="h-5 w-5" />}
          error={metrics.containersUpError}
        />

        {/* CPU (REAL - cores) */}
        <MetricCard
          label="CPU (in cores)"
          value={metrics.cpuCores}
          unit="cores"
          healthy={cpuHealthy}
          source="live"
          icon={<Gauge className="h-5 w-5" />}
          error={metrics.cpuCoresError}
        />

        {/* Memory (REAL - GB) */}
        <MetricCard
          label="Memory Used"
          value={metrics.memoryGB}
          unit="GB"
          healthy={memHealthy}
          source="live"
          icon={<HardDrive className="h-5 w-5" />}
          error={metrics.memoryError}
        />

        {/* Network RX (REAL - GB) */}
        <MetricCard
          label="Network RX (egress proxy)"
          value={metrics.networkRxGB}
          unit="GB"
          healthy={true}
          source="live"
          icon={<Activity className="h-5 w-5" />}
          error={metrics.networkRxError}
        />
      </div>

      {/* ---- Data egress (SEEDED - clearly marked) ---- */}
      <div className="mt-6">
        <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-5 w-5 text-amber-400" />
            <h2 className="font-semibold text-white">Data Egress</h2>
            {/* SEEDED badge - user ko clearly dikhta hai ki ye REAL nahi hai */}
            <span className="rounded-full border border-amber-600/50 bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
              SEEDED (not live)
            </span>
          </div>
          <p className="text-sm text-amber-200/80">{metrics.dataEgress.note}</p>
          <p className="mt-2 text-xs text-gray-400">
            Bucket: <span className="font-mono">{metrics.dataEgress.bucket}</span>
          </p>
        </div>
      </div>

      {/* ---- Compliance status (static laws - unchanged) ---- */}
      <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
        <h2 className="mb-4 font-semibold text-white">Compliance Laws (Static)</h2>
        <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <span>5% Sister Share: UNCHANGED</span>
          </div>
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <span>INR 2000 Buffer Mask: UNCHANGED</span>
          </div>
          <div className="flex items-center gap-2 text-blue-400">
            <ShieldCheck className="h-4 w-4" />
            <span>{THRESHOLD}% Ceiling: ENFORCED</span>
          </div>
          <div className="flex items-center gap-2 text-blue-400">
            <ShieldCheck className="h-4 w-4" />
            <span>GORM Ledger: UNMODIFIED</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * MetricCard - ek real metric dikhata hai
 * source prop batata hai ki value LIVE hai ya SEEDED (placeholder)
 */
function MetricCard({
  label,
  value,
  unit,
  healthy,
  source,
  icon,
  error,
}: {
  label: string;
  value: number | null;
  unit: string;
  healthy: boolean;
  source: 'live' | 'seeded';
  icon: React.ReactNode;
  error?: string;
}) {
  return (
    <div
      className={`rounded-xl border p-5 transition-colors ${
        error
          ? 'border-gray-800 bg-gray-900/50'
          : healthy
          ? 'border-green-700/40 bg-gray-900/60'
          : 'border-red-700/50 bg-gray-900/60 animate-pulse'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-400">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        {/* LIVE badge - real data */}
        {source === 'live' ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-green-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
            </span>
            LIVE
          </span>
        ) : (
          <span className="text-[10px] font-semibold text-amber-400">SEEDED</span>
        )}
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error}</span>
        </div>
      ) : (
        <div className="flex items-baseline gap-1">
          <span
            className={`font-mono text-3xl font-bold ${
              healthy ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {value !== null ? value.toFixed(2) : '--'}
          </span>
          <span className="text-sm text-gray-500">{unit}</span>
        </div>
      )}
    </div>
  );
}
