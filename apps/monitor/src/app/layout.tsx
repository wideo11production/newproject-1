import { GlobalActivityTracker } from '@wideo11/ui/activity-tracker';
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

  // Simulating K8s metrics and system data collection from backend API
  // Hinglish: Backend se aane wala simulated data, ye sirf server side logging ke liye hai
  const rawMonitorData = {
    clusterName: "wideo11-k8s-cluster-1",
    cpuUsage: Math.random() * 80 + 20,
    memoryUsage: Math.random() * 70 + 30,
    diskUsage: Math.random() * 60 + 40,
    activeNodes: Math.floor(Math.random() * 10 + 5),
    responseTime: Math.random() * 200 + 50,
    uptime: "99.8%",
    alertsCount: Math.floor(Math.random() * 5),
    videoEncodes: Math.floor(Math.random() * 20 + 5),
    telemetryEvents: Math.floor(Math.random() * 1000 + 500),
    lastUpdated: new Date().toISOString(),
  };

  // Stringify complex data on the server so it never crosses the RSC boundary as a live object
  // Hinglish: Complex data ko server side par stringify karte hain taaki RSC boundary
  // par "Only plain objects" serialization error na aaye
  const stringifiedMonitorData = JSON.stringify(rawMonitorData);

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
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* Main dashboard area: @metrics parallel slot */}
      <main className="flex-1 overflow-auto">{metrics}</main>
      {/* Side panel area: @telemetry parallel slot */}
      <aside className="w-96 shrink-0 overflow-auto border-l border-gray-800">
        {telemetry}
      </aside>
      {/* children ko render karte hain taaki default slot bhi available rahe */}
      {children}
      {/* Server side data log - debugging ke liye, UI me render nahi hota */}
      <script
        // Hinglish: Ye sirf server side telemetry log hai, client ko data nahi jaata
        dangerouslySetInnerHTML={{
          __html: `console.log("Monitor telemetry snapshot: ${stringifiedMonitorData.replace(/</g, "\\u003c")}")`,
        }}
      />
    </div>
      </body>
    </html>
  );
}
