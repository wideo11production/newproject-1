// Billing API client - connects to billing-service (port 8082)
// Uses NEXT_PUBLIC_API_URL from environment, falls back to localhost:8082
const BILLING_API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8082';

async function billingFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BILLING_API}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface EarningsStatus {
  status: string;
  may_earn: boolean;
  reason: string;
  message: string;
  ads_serving: boolean;
  earning_since: string | null;
  note: string;
}

export interface Invoice {
  id: string;
  number: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

export async function getEarningsStatus(): Promise<EarningsStatus | null> {
  try {
    return await billingFetch('/me/earnings-status');
  } catch {
    return null;
  }
}

export async function getInvoices(): Promise<Invoice[]> {
  try {
    return await billingFetch('/invoices/user/me');
  } catch {
    return [];
  }
}

export function calculateSisterShare(amount: number): number {
  // 5% sister share on creator earnings
  return Math.round(amount * 0.05 * 100) / 100;
}

export function calculateWithdrawable(earnings: number, bufferInr: number = 2000): number {
  // Withdrawable = earnings - sister share - ₹2000 buffer (must exceed buffer)
  const sisterShare = calculateSisterShare(earnings);
  const afterSisterShare = earnings - sisterShare;
  return afterSisterShare > bufferInr ? afterSisterShare - bufferInr : 0;
}
