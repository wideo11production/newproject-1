"use client";

import { useState } from 'react';
import { 
  LayoutDashboard, 
  Activity, 
  Settings,
  Volume2,
  VolumeX,
  Maximize2
} from 'lucide-react';

interface AdminClientProps {
  metrics?: React.ReactNode;
  telemetry?: React.ReactNode;
  controllers?: React.ReactNode;
  children: React.ReactNode;
}

export function AdminClient({ metrics, telemetry, controllers, children }: AdminClientProps) {
  const [activeTab, setActiveTab] = useState<'metrics' | 'telemetry' | 'controllers'>('metrics');

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 antialiased overflow-hidden">
      <div className="flex h-screen bg-gray-900 text-gray-100">
        
        {/* Sidebar Section */}
        <aside className="w-64 bg-gray-800 border-r border-gray-700 p-4 flex flex-col justify-between">
          <div>
            <h2 className="text-xl font-bold mb-6 text-blue-400 tracking-wider">Wideo11 Admin</h2>
            <nav className="space-y-2">
              <button 
                onClick={() => setActiveTab('metrics')}
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded text-sm font-medium transition-colors ${activeTab === 'metrics' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}
              >
                <LayoutDashboard className="h-4 w-4" />
                <span>System Metrics</span>
              </button>
              <button 
                onClick={() => setActiveTab('telemetry')}
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded text-sm font-medium transition-colors ${activeTab === 'telemetry' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}
              >
                <Activity className="h-4 w-4" />
                <span>User Telemetry</span>
              </button>
              <button 
                onClick={() => setActiveTab('controllers')}
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded text-sm font-medium transition-colors ${activeTab === 'controllers' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}
              >
                <Settings className="h-4 w-4" />
                <span>Configuration Controllers</span>
              </button>
            </nav>
          </div>
          
          {/* System Status Tracker */}
          <div className="text-[10px] text-gray-500 border-t border-gray-700 pt-2">
            System Instance Node: Active
          </div>
        </aside>

        {/* Main Dashboard Space Container */}
        <div className="flex-1 flex flex-col overflow-hidden">
          
          {/* Top Tabs Grid System */}
          <header className="h-12 bg-gray-800 border-b border-gray-700 flex items-center px-6 justify-between">
            <div className="flex space-x-1">
              <button 
                onClick={() => setActiveTab('metrics')}
                className={`px-4 h-12 border-b-2 text-xs font-semibold uppercase tracking-wider transition-all ${activeTab === 'metrics' ? 'border-blue-500 text-blue-400 bg-gray-750' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
              >
                Metrics View
              </button>
              <button 
                onClick={() => setActiveTab('telemetry')}
                className={`px-4 h-12 border-b-2 text-xs font-semibold uppercase tracking-wider transition-all ${activeTab === 'telemetry' ? 'border-blue-500 text-blue-400 bg-gray-750' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
              >
                Live Telemetry
              </button>
              <button 
                onClick={() => setActiveTab('controllers')}
                className={`px-4 h-12 border-b-2 text-xs font-semibold uppercase tracking-wider transition-all ${activeTab === 'controllers' ? 'border-blue-500 text-blue-400 bg-gray-750' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
              >
                System Controls
              </button>
            </div>
            <div className="text-xs font-mono text-green-400 bg-slate-950 px-2 py-1 rounded">
              Live Sync
            </div>
          </header>

          {/* Main Segment Content Panel View */}
          <main className="flex-1 p-6 overflow-auto bg-gray-950">
            
            {/* Dynamic View rendering depending on active configuration tabs */}
            {activeTab === 'metrics' && (
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 animate-fadeIn">
                <h3 className="text-lg font-semibold mb-2 text-green-400">System Overview Dashboard</h3>
                <div className="min-h-64 bg-slate-900 border border-slate-700 rounded p-2">{metrics}</div>
              </div>
            )}

            {activeTab === 'telemetry' && (
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 animate-fadeIn">
                <h3 className="text-lg font-semibold mb-2 text-blue-400">Real-Time User Activity Ledger</h3>
                <div className="min-h-64 bg-slate-900 border border-slate-700 rounded p-2">{telemetry}</div>
              </div>
            )}

            {activeTab === 'controllers' && (
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 animate-fadeIn">
                <h3 className="text-lg font-semibold mb-2 text-yellow-400">Global Variable Allocations</h3>
                <div className="min-h-64 bg-slate-900 border border-slate-700 rounded p-2">{controllers}</div>
              </div>
            )}

            {/* Underlying parallel sub-routes initialization container rendering */}
            <div className="mt-4">
              {children}
            </div>
          </main>
          
        </div>
      </div>
    </div>
  );
}