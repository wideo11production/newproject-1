'use client';

import { useState } from 'react';

export default function AdminTelemetryPage() {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    // Simulate an API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    setRefreshing(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 bg-opacity-50 backdrop-blur-sm p-6 rounded-lg border border-gray-800">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-semibold text-gray-100">API Performance</h3>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`px-3 py-1.5 text-sm font-medium transition-colors duration-200 ${
              refreshing
                ? 'bg-gray-600/50 cursor-not-allowed'
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div className="space-y-3">
          <div className="flex justify-between text-gray-400">
            <span>Request/sec:</span>
            <span className="text-green-400 font-mono">8.5K</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Avg. Response Time:</span>
            <span className="text-green-400 font-mono">45ms</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Error Rate:</span>
            <span className="text-green-400 font-mono">0.1%</span>
          </div>
        </div>
      </div>
      <div className="bg-gray-900 bg-opacity-50 backdrop-blur-sm p-6 rounded-lg border border-gray-800">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-semibold text-gray-100">Database Metrics</h3>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`px-3 py-1.5 text-sm font-medium transition-colors duration-200 ${
              refreshing
                ? 'bg-gray-600/50 cursor-not-allowed'
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div className="space-y-3">
          <div className="flex justify-between text-gray-400">
            <span>Queries/sec:</span>
            <span className="text-green-400 font-mono">12K</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Slow Queries:</span>
            <span className="text-green-400 font-mono">0.5%</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Connection Pool:</span>
            <span className="text-green-400 font-mono">78%</span>
          </div>
        </div>
      </div>
    </div>
  );
}