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
 * promRangeQuery - Prometheus se RANGE query (time series) leta hai
 *
 * `promQuery` sirf ek instant value deta hai (abhi kya hai). Real dashboard
 * ke liye time series chahiye - yaani pichhle 1 ghante me CPU kaise badha,
 * memory kab spike hui. Ye wahi deta hai.
 *
 * ERROR HANDLING: throw karta hai, `promQuery` ki tarah nahi. Kyunki iska
 * caller (`/api/timeseries`) poora request fail kar sakta hai - ek panel ki
 * series na aane par baaki sab dikhni chahiye. Throwing se route handler
 * cleanly 502 de sakta hai with kaunsi query fail hui.
 *
 * PromQL BHANDAAR HAI isliye nahi fail hota: har query alag jaanchti hai
 * aur response me `error` field ke saath wapas aati hai. Isiliye empty
 * result ko "no data" maana jaata hai, error ko alag.
 */
export interface RangeSeries {
  /** Metric name / label combination, e.g. "auth_service" */
  label: string;
  /** [unixSeconds, value] pairs - ECharts isko seedha consume karta hai */
  points: Array<[number, number]>;
}

export async function promRangeQuery(
  query: string,
  opts?: { rangeSeconds?: number; step?: number }
): Promise<RangeSeries[]> {
  const rangeSeconds = opts?.rangeSeconds ?? 3600;
  // Step: 15s scrape interval par max ~240 points per hour. Zyada chhota step
  // CPU waste karta hai bina kuch naya dikhaye; zyada bada step spikes ko
  // miss kar deta hai.
  const step = opts?.step ?? 15;

  const end = Math.floor(Date.now() / 1000);
  const start = end - rangeSeconds;
  const url =
    `${PROMETHEUS_URL}/api/v1/query_range` +
    `?query=${encodeURIComponent(query)}` +
    `&start=${start}&end=${end}&step=${step}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Prometheus returned ${res.status}`);
    }

    const json = await res.json();
    if (json.status !== 'success') {
      throw new Error(json.error ?? 'Prometheus query failed');
    }

    return (json.data?.result ?? []).map((r: {
      metric: Record<string, string>;
      values: Array<[number, string]>;
    }) => {
      // Label priority: db/bucket/job sabse useful hain. Inme se pehla jo
      // maujood ho wo series ka naam ban jaata hai. Isse legend me
      // "auth_service" dikhta hai, "{__name__=\"pg_stat_...\"}" nahi.
      const m = r.metric ?? {};
      const label = m.datname ?? m.bucket ?? m.job ?? m.instance ?? m.__name__ ?? 'value';

      return {
        label,
        points: r.values
          .map(([ts, val]) => [ts, parseFloat(val)] as [number, number])
          .filter(([, v]) => !Number.isNaN(v)),
      };
    });
  } finally {
    clearTimeout(timeout);
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

  // ---- Provenance: real ya degraded? ----
  //
  // "live" ka matlab hai: har metric kisi NAHI value ke bajaye ek REAL
  // number hai. `promQuery` failure par `value: null` aur `error` bharta
  // hai, to `.value !== null` se pata chal jaata hai.
  //
  // Ye isliye zaroori hai kyunki dashboard pehle har haal me "Live from
  // Prometheus" likhta tha - chahe data aa raha ho ya sab null ho. Adhoora
  // data ko live bolna wahi jhooth hai jo pehle ki tarah "fake dikhake real
  // chhupana" tha, bas ulta.
  const queries = [
    upResult, cpuCores, memBytes, netRxBytes,
    bucketSize, bucketObjects, videoBucketSize, scrapeError,
  ];
  const allLive = queries.every((q) => q.value !== null);

  const payload = {
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

    // ---- Data provenance ----
    //
    // `prometheusUrl` ko browser ko BHEJNE ki zaroorat nahi hai. Wo ek
    // internal container hostname hai (`http://prometheus:9090`) jo browser
    // ke DNS se resolve hi nahi hota. Pehle dashboard usse header me render
    // karta tha, jisse user ko ek dead URL dikhta tha aur dashboard "broken"
    // lagta tha - jabki data bilkul theek aa raha tha.
    //
    // `dataSource` woh batata hai jo user ko actually chahiye: data REAL hai
    // ya seeded/placeholder. Koi bhi metric fail ho raha ho to wo bhi yahan
    // reflect hota hai, taaki "live" dikhate hue aadhi dashboard jhooth na
    // bolе.
    dataSource: allLive ? 'live' : 'degraded',

    // `prometheusUrl` is DELIBERATELY NOT IN THIS PAYLOAD.
    //
    // The comment immediately above used to say "sending this to the browser leaks
    // cluster topology" and then the next line sent it. That is the fourth time in
    // this repository a comment has documented a fix that the code below it never
    // received - and this one was live:
    //
    //     GET http://localhost:3001/api/metrics
    //     {"prometheusUrl":"http://prometheus:9090", "containersUp":9, ...}
    //
    // It is an internal container hostname. The browser cannot resolve it, so no
    // UI can use it, and sending it publishes the topology of the Docker network to
    // anyone who can reach the port.
    //
    // It goes to the LOG instead, which is where a server-side address belongs.
    // `dataSource` above is what the UI actually needs: is this data real or
    // degraded. `console.log` rather than a logger because this module has no
    // logger import, and adding one to log one string is not worth the churn.
    //
    // If you need the URL to debug a scrape, it is in `docker-compose.yml` under
    // `PROMETHEUS_URL` and in this file's `PROMETHEUS_URL` constant. It is a
    // constant, not runtime state.
    fetchedAt: new Date().toISOString(),
  };

  console.log(
    `[monitor] metrics scraped from ${PROMETHEUS_URL} at ${new Date().toISOString()}`,
  );
  return payload;
}
