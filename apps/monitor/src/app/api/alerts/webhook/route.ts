// ============================================================================
// POST /api/alerts/webhook - Alertmanager webhook receiver
// ============================================================================
//
// YE ENDPOINT Alertmanager se alerts receive karta hai jab koi alert rule
// trigger hoti hai (e.g. TargetDown `up == 0`). Payload parse hota hai aur
// active error notification SuperAdmin Alerting Box UI mein append ho jaati hai.
//
// Alertmanager config (monitoring/alertmanager.yml) mein receiver set karna
// hoga:
//   receivers:
//     - name: 'webhook-receiver'
//       webhook_configs:
//         - url: 'http://monitor:3001/api/alerts/webhook'
//
// Hinglish: Alertmanager jab bhi koi alert fire karta hai, wo ye endpoint pe
// POST karta hai. Ye payload parse karke active alerts ki list mein add kar
// deta hai, jisse SuperAdmin Alerting Box UI mein real-time dikhai deta hai.
//
// PAYLOAD FORMAT (Alertmanager standard):
// {
//   "version": "1",
//   "groupKey": "...",
//   "status": "firing" | "resolved",
//   "receiver": "...",
//   "groupLabels": {...},
//   "commonLabels": {...},
//   "commonAnnotations": {...},
//   "externalURL": "http://alertmanager:9093",
//   "alerts": [
//     {
//       "status": "firing",
//       "labels": { alertname: "TargetDown", instance: "...", job: "...", severity: "warning" },
//       "annotations": { summary: "...", description: "..." },
//       "startsAt": "...",
//       "endsAt": "...",
//       "generatorURL": "..."
//     }
//   ]
// }
//
// ============================================================================

import { NextResponse } from 'next/server';

// In-memory alert store - production would use Redis/Postgres, but for the
// monitor dashboard this is sufficient and matches the existing pattern.
// Hinglish: In-memory store - production me Redis/Postgres use hoga, lekin
// monitor dashboard ke liye ye sufficient hai.
interface StoredAlert {
  id: string;
  alertname: string;
  instance: string;
  job: string;
  severity: 'critical' | 'warning' | 'info';
  state: 'firing' | 'resolved';
  summary: string;
  description?: string;
  startsAt: string;
  endsAt?: string;
  generatorURL?: string;
  receivedAt: string;
}

let alertStore: StoredAlert[] = [];
const MAX_ALERTS = 500;

/**
 * Generate a stable alert id from Alertmanager fingerprint fields.
 */
function alertId(a: {
  alertname: string;
  instance: string;
  startsAt: string;
}): string {
  return `${a.alertname}|${a.instance}|${a.startsAt}`;
}

/**
 * Parse an Alertmanager webhook payload into StoredAlert entries.
 *
 * Hinglish: Alertmanager payload ko parse karke StoredAlert entries mein
 * convert karo.
 */
function parseAlertmanagerPayload(body: any): StoredAlert[] {
  if (!body || !Array.isArray(body.alerts)) {
    return [];
  }

  const now = new Date().toISOString();

  return body.alerts.map((a: any) => {
    const labels = a.labels ?? {};
    const annotations = a.annotations ?? {};
    const id = alertId({
      alertname: labels.alertname ?? 'unknown',
      instance: labels.instance ?? 'unknown',
      startsAt: a.startsAt ?? now,
    });

    return {
      id,
      alertname: labels.alertname ?? 'unknown',
      instance: labels.instance ?? 'unknown',
      job: labels.job ?? 'unknown',
      severity: (labels.severity as 'critical' | 'warning' | 'info') ?? 'warning',
      state: a.status === 'resolved' ? 'resolved' : 'firing',
      summary: annotations.summary ?? labels.alertname ?? 'Alert',
      description: annotations.description,
      startsAt: a.startsAt ?? now,
      endsAt: a.endsAt,
      generatorURL: a.generatorURL,
      receivedAt: now,
    };
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const parsed = parseAlertmanagerPayload(body);

    if (parsed.length === 0) {
      return NextResponse.json(
        { error: 'no alerts in payload' },
        { status: 400 }
      );
    }

    // Merge into store: firing alerts added/updated, resolved alerts marked.
    const now = new Date().toISOString();
    for (const alert of parsed) {
      const existing = alertStore.find((a) => a.id === alert.id);

      if (existing) {
        // Update existing alert state
        existing.state = alert.state;
        existing.summary = alert.summary;
        existing.description = alert.description;
        existing.severity = alert.severity;
        if (alert.state === 'resolved') {
          existing.endsAt = alert.endsAt ?? now;
        }
        existing.receivedAt = now;
      } else {
        // New firing alert - prepend to store
        alertStore.unshift(alert);
      }
    }

    // Cap store size
    if (alertStore.length > MAX_ALERTS) {
      alertStore = alertStore.slice(0, MAX_ALERTS);
    }

    // Return the newly received alerts so the client can append them to UI
    return NextResponse.json(
      {
        received: parsed.length,
        alerts: parsed,
        total: alertStore.length,
      },
      {
        headers: { 'Cache-Control': 'no-store' },
        status: 200,
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'webhook parse failed',
      },
      { status: 400 }
    );
  }
}

/**
 * GET /api/alerts/webhook - return current active (firing) alerts.
 * Used by the Alerting Box UI to poll for live alerts.
 */
export async function GET() {
  const firing = alertStore.filter((a) => a.state === 'firing');
  return NextResponse.json(
    {
      alerts: firing,
      total: alertStore.length,
      firing: firing.length,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * DELETE /api/alerts/webhook/:id - acknowledge/resolve an alert.
 */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const idx = alertStore.findIndex((a) => a.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: 'alert not found' }, { status: 404 });
  }

  alertStore[idx].state = 'resolved';
  alertStore[idx].endsAt = new Date().toISOString();

  return NextResponse.json({ ok: true, id });
}