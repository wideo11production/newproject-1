import "./globals.css";
import type { Metadata } from "next";
import { config } from "@wideo11/config";
import React from "react";

export const metadata: Metadata = {
  title: "Monitor Dashboard",
  description: "Monitoring dashboard for Wideo11",
};

// Server Component: Simulates backend K8s metrics collection and data preparation
export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Log config for verification (server side) - Hinglish: Config log karne ke liye kiya, server side se check kiya
  console.log("Config loaded:", {
    appUrl: config.NEXT_PUBLIC_APP_URL,
    buffer: config.MINIMUM_MAINTENANCE_BUFFER_INR,
    sisterShare: config.SISTER_SHARE_PERCENTAGE,
  });

  // Simulating K8s metrics and system data collection from backend API
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

  // Stringify complex data before passing to Client Components (Hinglish: Server Component se complex data ko stringified karo taaki serialization error na aaye)
  const stringifiedMonitorData = JSON.stringify(rawMonitorData);

  // Clone children and add monitorDataString prop to enable safe client-side data processing
  const enhancedChildren = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      return React.cloneElement(child, { monitorDataString: stringifiedMonitorData });
    }
    return child;
  });

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {enhancedChildren}
    </div>
  );
}