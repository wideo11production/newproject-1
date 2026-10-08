import { GlobalActivityTracker } from '@wideo11/ui/activity-tracker';
import { PresenceTracker } from '@wideo11/ui/presence-tracker';
import "./globals.css";
import type { Metadata } from "next";
import { config } from "@wideo11/config";
// Global font stack - Grafana-style system fonts (air-gapped, no network fetch)
import { FONT_SANS_CLASS, FONT_SANS_STACK } from "@wideo11/ui/font";
import React from "react";

export const metadata: Metadata = {
  title: "Monitor Dashboard",
  description: "Monitoring dashboard for Wideo11",
};

// Root layout: parallel route slots @metrics aur @telemetry ko props me declare
// karna zaroori hai. Next.js 14 generated LayoutProps type in slots ko enforce
// karta hai - agar slot props declare nahi kiye to type error aata hai.
// Slot declare nahi karne par Next unhe "not rendered" treat karta hai, isliye
// dono slots ko yahan render bhi karte hain.
// Hinglish: @metrics main dashboard hai, @telemetry side panel hai.
export default function Layout({
  children,
  metrics,
  telemetry,
}: {
  children: React.ReactNode;
  metrics: React.ReactNode;
  telemetry: React.ReactNode;
}) {
  // Log config for verification (server side)
  // Hinglish: Config log karne ke liye kiya, server side se check kiya
  console.log("Config loaded:", {
    appUrl: config.NEXT_PUBLIC_APP_URL,
    buffer: config.MINIMUM_MAINTENANCE_BUFFER_INR,
    sisterShare: config.SISTER_SHARE_PERCENTAGE,
  });

  // ---- REMOVED: the fake telemetry snapshot ----
  //
  // This used to build a fake snapshot and inline it into the page:
  //
  //   console.log("Monitor telemetry snapshot: {"clusterName":"wideo11-k8s-cluster-1",
  //    "cpuUsage":75.7,"memoryUsage":51.7,"uptime":"99.8%","alertsCount":4,...}")
  //
  // Three problems, all real:
  //
  //   1. FABRICATED DATA. Every number was `Math.random()`. `uptime: "99.8%"`
  //      was hardcoded. `activeNodes: 14` claimed fourteen Kubernetes nodes on
  //      a Docker Compose stack. This is the same class of invented metric
  //      that got removed from the telemetry panel earlier - it was just
  //      hidden in a console.log, so it looked harmless.
  //   2. IT BROKE THE PAGE. `JSON.stringify` output was interpolated into a
  //      JS string literal WITHOUT escaping quotes, so the JSON's own `"`
  //      characters closed the string early. Every page load threw:
  //          SyntaxError: missing ) after argument list
  //      A parse error in an inline script is fatal to that script, and it
  //      happened on the ROOT document, not a lazy chunk.
  //   3. `Math.random()` in a layout makes every render non-deterministic,
  //      which also defeats any future static rendering.

  // The real metrics come from Prometheus via the @metrics dashboard. There
  // is nothing to log here.

  return (
    // Root layout me <html> aur <body> zaroori hain - Next.js App Router isse
    // expect karta hai. Pehle yahan seedha <div> return hota tha, jisse global
    // font stack apply hi nahi ho sakta tha (koi <body> hi nahi tha).
    // Hinglish: html/body tags add kiye taaki font stack + activity tracking lag sake
    <html lang="en" suppressHydrationWarning>
      <body
        className={FONT_SANS_CLASS}
        style={{ fontFamily: FONT_SANS_STACK }}
        suppressContentEditableWarning
      >
        {/* Global activity capture (Awareness grid ka data source) */}
        <GlobalActivityTracker />
        {/* Presence heartbeat - feeds the superadmin Online Now panel. See the component's
            header: the server-side start/beat/end existed with zero callers, which is why
            every presence number read 0. */}
        <PresenceTracker />
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* Main dashboard area: @metrics parallel slot */}
      <main className="flex-1 overflow-auto">{metrics}</main>
      {/* Side panel area: @telemetry parallel slot */}
      <aside className="w-96 shrink-0 overflow-auto-800">
        {telemetry}
      </aside>
      {/* children ko render karte hain taaki default slot bhi available rahe */}
      {children}
    </div>
      </body>
    </html>
  );
}
