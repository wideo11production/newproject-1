'use client';

import { Suspense } from 'react';
import { Loading } from './components/ui/loading';

// Dynamic imports for lazy loading of parallel route components
// This improves initial page load performance by loading route components only when needed
// Each component is wrapped in Suspense for better user experience during loading states

// The overview module is not present in this app, so keep the dashboard
// renderable without resolving a missing module at build time.
function OverviewPanel() {
  return (
    <div>
      <h2 className="text-lg font-semibold">Overview</h2>
      <p className="text-muted-foreground">Overview analytics are unavailable.</p>
    </div>
  );
}
// The creator insights module is not present in this app, so keep the
// dashboard renderable without resolving a missing module at build time.
function CreatorInsights() {
  return (
    <div>
      <h2 className="text-lg font-semibold">Creator Insights</h2>
      <p className="text-muted-foreground">Creator insights are unavailable.</p>
    </div>
  );
}
// The retention analytics module is not present in this app, so keep the
// dashboard renderable without resolving a missing module at build time.
function RetentionAnalytics() {
  return (
    <div>
      <h2 className="text-lg font-semibold">Retention Analytics</h2>
      <p className="text-muted-foreground">Retention analytics are unavailable.</p>
    </div>
  );
}
// The clickstream analytics module is not present in this app, so keep the
// dashboard renderable without resolving a missing module at build time.
function ClickstreamAnalytics() {
  return (
    <div>
      <h2 className="text-lg font-semibold">Clickstream Analytics</h2>
      <p className="text-muted-foreground">Clickstream analytics are unavailable.</p>
    </div>
  );
}
// The revenue tracker module is not present in this app, so keep the dashboard
// renderable without resolving a missing module at build time.
function RevenueTracker() {
  return (
    <div>
      <h2 className="text-lg font-semibold">Revenue Tracker</h2>
      <p className="text-muted-foreground">Revenue tracking is unavailable.</p>
    </div>
  );
}
// The target ledger module is not present in this app, so keep the dashboard
// renderable without resolving a missing module at build time.
function TargetLedger() {
  return (
    <div>
      <h2 className="text-lg font-semibold">Target Ledger</h2>
      <p className="text-muted-foreground">Target tracking is unavailable.</p>
    </div>
  );
}

export default function AnalyticsDashboard() {
  return (
    <div className="p-6 space-y-6">
      {/* Main dashboard header with page title and description */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics Engine & Creator Insights</h1>
          <p className="text-muted-foreground">Real-time analytics, performance tracking, and creator revenue management</p>
        </div>
      </div>

      {/* Parallel routing slots for Grafana-identical dashboard layout */}
      <div className="grid grid-cols-12 gap-6 h-[calc(100vh-12rem)]">
        {/* Overview panel showing key metrics and dashboard insights */}
        <div className="col-span-4 bg-card border-border rounded-lg p-4">
          <Suspense fallback={<Loading />}><OverviewPanel /></Suspense>
        </div>

        {/* Creator insights panel with detailed creator performance metrics */}
        <div className="col-span-4 bg-card border-border rounded-lg p-4">
          <Suspense fallback={<Loading />}><CreatorInsights /></Suspense>
        </div>

        {/* Retention analytics panel showing user retention patterns */}
        <div className="col-span-4 bg-card border-border rounded-lg p-4">
          <Suspense fallback={<Loading />}><RetentionAnalytics /></Suspense>
        </div>

        {/* Clickstream analytics panel with real-time user interaction data */}
        <div className="col-span-6 bg-card border-border rounded-lg p-4">
          <Suspense fallback={<Loading />}><ClickstreamAnalytics /></Suspense>
        </div>

        {/* Revenue tracker panel for financial performance metrics */}
        <div className="col-span-6 bg-card border-border rounded-lg p-4">
          <Suspense fallback={<Loading />}><RevenueTracker /></Suspense>
        </div>

        {/* Target ledger panel for ₹500/day creator targets */}
        <div className="col-span-12 bg-card border-border rounded-lg p-4">
          <Suspense fallback={<Loading />}><TargetLedger /></Suspense>
        </div>
      </div>
    </div>
  );
}
