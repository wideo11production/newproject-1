'use client';

import { lazy, Suspense, useEffect, useState } from 'react';

const DashboardSidebar = lazy(() => import('./components/sidebars/DashboardSidebar'));
const SubscriptionsSidebar = lazy(() => import('./components/sidebars/SubscriptionsSidebar'));
const InvoicesSidebar = lazy(() => import('./components/sidebars/InvoicesSidebar'));
const PaymentsSidebar = lazy(() => import('./components/sidebars/PaymentsSidebar'));

import {
  getEarningsStatus,
  getInvoices,
  calculateSisterShare,
  calculateWithdrawable,
  type EarningsStatus,
  type Invoice,
} from '@/lib/billing-api';

export default function BillingDashboard() {
  const [earnings, setEarnings] = useState<EarningsStatus | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [earningsData, invoicesData] = await Promise.all([
          getEarningsStatus(),
          getInvoices(),
        ]);
        if (!cancelled) {
          setEarnings(earningsData);
          setInvoices(invoicesData);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load billing data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const earningsInr = earnings?.may_earn ? 0 : 0; // Earnings come from accrual, not this endpoint
  const sisterShare = calculateSisterShare(earningsInr);
  const withdrawable = calculateWithdrawable(earningsInr);

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Billing Dashboard</h1>
            <p className="text-muted-foreground">
              Overview of your billing metrics and recent activity
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-md">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="bg-card p-4 rounded-md">
            <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
            <p className="text-2xl font-bold">
              {loading ? '–' : `₹${earningsInr.toLocaleString()}`}
            </p>
          </div>
          <div className="bg-card p-4 rounded-md">
            <p className="text-sm font-medium text-muted-foreground">Sister Share (5%)</p>
            <p className="text-2xl font-bold text-amber-600">
              {loading ? '–' : `₹${sisterShare.toLocaleString()}`}
            </p>
          </div>
          <div className="bg-card p-4 rounded-md">
            <p className="text-sm font-medium text-muted-foreground">₹2000 Buffer</p>
            <p className="text-2xl font-bold">
              {loading ? '–' : '₹2,000'}
            </p>
          </div>
          <div className="bg-card p-4 rounded-md">
            <p className="text-sm font-medium text-muted-foreground">Withdrawable</p>
            <p className="text-2xl font-bold text-emerald-600">
              {loading ? '–' : `₹${withdrawable.toLocaleString()}`}
            </p>
          </div>
        </div>

        {!loading && earnings && (
          <div className="bg-card p-4 rounded-md">
            <h3 className="text-sm font-semibold text-foreground mb-3">Earnings Status</h3>
            <div className="flex items-center gap-3">
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                earnings.may_earn
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : 'bg-amber-500/10 text-amber-600'
              }`}>
                {earnings.may_earn ? 'Earning' : 'Paused'}
              </span>
              <span className="text-sm text-muted-foreground">{earnings.reason}</span>
            </div>
            {earnings.message && (
              <p className="text-xs text-muted-foreground mt-1">{earnings.message}</p>
            )}
            {earnings.note && (
              <p className="text-xs text-muted-foreground mt-1">{earnings.note}</p>
            )}
          </div>
        )}

        <div className="bg-card p-4 rounded-md">
          <h3 className="text-sm font-semibold text-foreground mb-3">Recent Invoices</h3>
          {loading || invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loading ? 'Loading invoices...' : 'No invoices found.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {invoices.slice(0, 5).map((inv) => (
                <li key={inv.id} className="flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium">{inv.number}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      ₹{inv.amount.toLocaleString()} {inv.currency}
                    </p>
                    <p className="text-xs">
                      {inv.status === 'paid'
                        ? 'Paid'
                        : inv.status === 'pending'
                        ? 'Pending'
                        : 'Unpaid'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <aside className="w-80 bg-card/50 overflow-y-auto flex-shrink-0 hidden lg:flex lg:flex-col">
        <Suspense fallback={<Loading />}>
          <DashboardSidebar />
        </Suspense>
      </aside>
      <div className="w-80 bg-card/50 overflow-y-auto flex-shrink-0 hidden lg:flex lg:flex-col">
        <Suspense fallback={<Loading />}>
          <SubscriptionsSidebar />
        </Suspense>
      </div>
      <div className="w-80 bg-card/50 overflow-y-auto flex-shrink-0 hidden lg:flex lg:flex-col">
        <Suspense fallback={<Loading />}>
          <InvoicesSidebar />
        </Suspense>
      </div>
      <div className="w-80 bg-card/50 overflow-y-auto flex-shrink-0 hidden lg:flex lg:flex-col">
        <Suspense fallback={<Loading />}>
          <PaymentsSidebar />
        </Suspense>
      </div>
    </>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center h-full space-x-2 text-muted-foreground">
      <div className="animate-spin rounded-full h-6 w-6"></div>
      <span>Loading...</span>
    </div>
  );
}
