'use client';

import { useState } from 'react';

export default function AdminMetricsPage() {
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
          <h3 className="text-lg font-semibold text-gray-100">User Management</h3>
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
            <span>Total Users:</span>
            <span className="text-green-400 font-mono">12,450</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Active Today:</span>
            <span className="text-green-400 font-mono">3,200</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>New Signups:</span>
            <span className="text-green-400 font-mono">125</span>
          </div>
        </div>
      </div>
      <div className="bg-gray-900 bg-opacity-50 backdrop-blur-sm p-6 rounded-lg border border-gray-800">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-semibold text-gray-100">Content Stats</h3>
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
            <span>Videos Uploaded:</span>
            <span className="text-green-400 font-mono">450K</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Hours Processed:</span>
            <span className="text-green-400 font-mono">1.2M</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Storage Used:</span>
            <span className="text-green-400 font-mono">12 TB</span>
          </div>
        </div>
      </div>
    </div>
  );
}