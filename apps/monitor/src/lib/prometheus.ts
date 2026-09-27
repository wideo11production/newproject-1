// Prometheus client - real metrics fetching
//
// YE FILE SEPARATE KYUN HAI: Next.js ke route files me sirf HTTP methods
// (GET/POST) export ho sakte hain. Helper functions wahan rakhne se ye error
// aata tha:
//   "Route does not match the required types of a Next.js Route"
// Isliye helpers yahan hain aur route.ts sirf GET export karta hai.
//
// Hinglish: route file me sirf GET allowed hai, helpers alag file me

export const PROMETHEUS_URL =
  process.env.PROMETHEUS_URL ?? 'http://prometheus:9090';

// MinIO bucket ka naam (SSOT se) - exporter isko label me use karta hai
const MINIO_VIDEO_BUCKET = process.env.MINIO_VIDEO_BUCKET ?? 'video';

/**
 * promQuery - Prometheus se ek query chalata hai
 * Error ho to { value: null, error } return karta hai (throw nahi karta),
 * taaki dashboard ek metric fail hone par crash na ho.
 */
export async function promQuery(
  query: string
): Promise<{ value: number | null; error?: string }> {
  try {
    const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    // Timeout - hang na ho
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { value: null, error: `Prometheus returned ${res.status}` };
    }

    const json = await res.json();

    // Prometheus response shape: data.result[0].value = [timestamp, "value"]
    if (json.status !== 'success' || !json.data?.result?.length) {
      return { value: null, error: 'no data' };
    }

    const value = parseFloat(json.data.result[0].value[1]);
    return { value: isNaN(value) ? null : value };
  } catch (err) {
    return {
      value: null,
      error: err instanceof Error ? err.message : 'query failed',
    };
  }
}

/**
 * getPrometheusMetrics - saare real metrics ek saath laata hai
 *
 * HEADS UP: Data egress abhi bhi SEEDED hai (MinIO se direct nahi, kyunki
 * MinIO Prometheus expose nahi karta). Ye honestly 'seeded' mark hota hai
 * taaki pata chale ki ye real nahi hai - pehle ki tarah FAKE dikhake real
 * jaisa behave nahi karega.
 */
export async function getPrometheusMetrics() {
  // ---- Container health (REAL) ----
  const upResult = await promQuery('sum(up)');

  // ---- CPU (REAL, container-level cores) ----
  // NOTE: cAdvisor container metrics add karne se PEHLE ye query "no data"
  // deti thi (kyunki container metrics sirf cAdvisor se aati hain).
  // mode!="idle" zaroori hai - bina iske total CPU usage galat aata hai
  // (idle time bhi count ho jata hai).
  const cpuCores = await promQuery(
    'sum(rate(container_cpu_usage_seconds_total{mode!="idle"}[2m]))'
  );

  // ---- Memory (REAL) ----
  // working_set bytes = actual RAM use (cache exclude karke)
  const memBytes = await promQuery(
    'sum(container_memory_working_set_bytes)'
  );

  // ---- Network received (REAL - egress ka proxy) ----
  // NOTE: cAdvisor ke network metrics me "container" label NAHI hota - wo
  // per-interface hote hain. Pehle humne {container!=""} filter lagaya tha
  // jiski wajah se ye "no data" return kar raha tha. Filter hatane par
  // real value aa rahi hai.
  const netRxBytes = await promQuery('sum(container_network_receive_bytes_total)');

  // ---- MinIO storage (REAL - custom exporter se) ----
  //
  // NOTE: ye pehle "seeded" (placeholder) tha. Ab REAL hai kyunki humne
  // services/minio-exporter banaya jo MinIO Admin API se actual bucket
  // size aur object count padhta hai aur Prometheus expose karta hai.
  // Official MinIO image blocked hone ki wajah se native metrics path kaam
  // nahi kar raha tha, isliye custom exporter zaroori thi.
  const bucketSize = await promQuery('sum(minio_bucket_size_bytes)');
  const bucketObjects = await promQuery('sum(minio_bucket_objects_total)');
  const videoBucketSize = await promQuery('minio_bucket_size_bytes{bucket="video"}');
  const scrapeError = await promQuery('max(minio_exporter_scrape_error)');

  return {
    containersUp: upResult.value,
    containersUpError: upResult.error,

    // CPU: cores use ho rahe hain (zyada honest than a made-up percentage)
    cpuCores: cpuCores.value,
    cpuCoresError: cpuCores.error,

    memoryGB: memBytes.value !== null ? memBytes.value / (1024 ** 3) : null,
    memoryError: memBytes.error,

    networkRxGB: netRxBytes.value !== null ? netRxBytes.value / (1024 ** 3) : null,
    networkRxError: netRxBytes.error,

    // ---- Data egress / storage (REAL - MinIO exporter) ----
    dataEgress: {
      // Total storage used (bytes) - REAL
      totalBytes: bucketSize.value,
      // Object count - REAL
      objectCount: bucketObjects.value,
      // Video bucket specifically (HLS chunks yahan hote hain)
      videoBucketBytes: videoBucketSize.value,
      // Bucket name
      bucket: MINIO_VIDEO_BUCKET,
      // Source ab "live" hai - custom exporter se real data
      source: 'live' as const,
      // 1 = last scrape failed, 0 = ok
      scrapeError: scrapeError.value,
      scrapeErrorDetail: scrapeError.error,
    },

    prometheusUrl: PROMETHEUS_URL,
    fetchedAt: new Date().toISOString(),
  };
}
