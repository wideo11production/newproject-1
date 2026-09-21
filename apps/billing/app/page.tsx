'use client';

import { lazy, Suspense } from 'react';

const DashboardSidebar = lazy(() => import('./components/sidebars/DashboardSidebar'));
const SubscriptionsSidebar = lazy(() => import('./components/sidebars/SubscriptionsSidebar'));
const InvoicesSidebar = lazy(() => import('./components/sidebars/InvoicesSidebar'));
const PaymentsSidebar = lazy(() => import('./components/sidebars/PaymentsSidebar'));

export default function BillingDashboard() {
  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Billing Dashboard</h1>
            <p className="text-muted-foreground">Overview of your billing metrics and recent activity</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="bg-card border-border p-4 rounded-lg">
            <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
            <p className="text-2xl font-bold">$127,432</p>
          </div>
        </div>
      </div>
      <aside className="w-80 border-l border-border bg-card/50 overflow-y-auto flex-shrink-0 hidden lg:flex lg:flex-col">
        <Suspense fallback={<Loading />}>
          <DashboardSidebar />
        </Suspense>
      </aside>
      <div className="w-80 border-l border-border bg-card/50 overflow-y-auto flex-shrink-0 hidden lg:flex lg:flex-col">
        <Suspense fallback={<Loading />}>
          <SubscriptionsSidebar />
        </Suspense>
      </div>
      <div className="w-80 border-l border-border bg-card/50 overflow-y-auto flex-shrink-0 hidden lg:flex lg:flex-col">
        <Suspense fallback={<Loading />}>
          <InvoicesSidebar />
        </Suspense>
      </div>
      <div className="w-80 border-l border-border bg-card/50 overflow-y-auto flex-shrink-0 hidden lg:flex lg:flex-col">
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
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      <span>Loading...</span>
    </div>
  );
}
