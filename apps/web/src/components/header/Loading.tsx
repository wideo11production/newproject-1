"use client"

import { Card, CardHeader, CardTitle, CardContent } from "@wideo11/ui/card";

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md ${className}`} />;
}

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="animate-pulse h-8 w-48 bg-gray-700/50 rounded-md" />
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <div className="h-4 w-24 bg-gray-700/50 rounded animate-pulse mb-2" />
            <div className="h-6 w-16 bg-gray-700/50 rounded animate-pulse" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
            <div className="aspect-video w-full bg-gray-700/50 animate-pulse" />
            <div className="p-3 space-y-2">
              <div className="h-4 w-full bg-gray-700/50 rounded animate-pulse" />
              <div className="h-3 w-2/3 bg-gray-700/50 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
