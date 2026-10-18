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
    <div className="flex h-screen bg-[#0d0d0d] text-[#ffffff] antialiased overflow-hidden">
      <div className="flex h-screen bg-[#0d0d0d] text-[#ffffff]">
        
        {/* Sidebar Section */}
        <aside className="w-64 bg-[#161616] p-4 flex flex-col justify-between">
          <div>
            <h2 className="text-xl font-bold mb-6 text-[#ff6500] tracking-wider">Wideo11 Admin</h2>
            <nav className="space-y-2">
              <button 
                onClick={() => setActiveTab('metrics')}
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150 border-0 ${activeTab === 'metrics' ? 'bg-[#ff6500] text-[#0d0d0d]' : 'hover:bg-[#1e1e1e] text-[#ffffff]'}`}
              >
                <LayoutDashboard className="h-2.5 w-2.5" />
                <span>System Metrics</span>
              </button>
              <button 
                onClick={() => setActiveTab('telemetry')}
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150 border-0 ${activeTab === 'telemetry' ? 'bg-[#ff6500] text-[#0d0d0d]' : 'hover:bg-[#1e1e1e] text-[#ffffff]'}`}
              >
                <Activity className="h-2.5 w-2.5" />
                <span>User Telemetry</span>
              </button>
              <button 
                onClick={() => setActiveTab('controllers')}
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150 border-0 ${activeTab === 'controllers' ? 'bg-[#ff6500] text-[#0d0d0d]' : 'hover:bg-[#1e1e1e] text-[#ffffff]'}`}
              >
                <Settings className="h-2.5 w-2.5" />
                <span>Configuration Controllers</span>
              </button>
            </nav>
          </div>
          
          {/* System Status Tracker */}
          <div className="text-[10px] text-[#8b949e] pt-2">
            System Instance Node: Active
          </div>
        </aside>

        {/* Main Dashboard Space Container */}
        <div className="flex-1 flex flex-col overflow-hidden">
          
          {/* Top Tabs Grid System */}
          <header className="h-12 bg-[#161616] flex items-center px-6 justify-between">
            <div className="flex space-x-1">
              <button 
                onClick={() => setActiveTab('metrics')}
                className={`px-4 h-12-2 text-xs font-semibold uppercase tracking-wider transition-all duration-150 border-0 ${activeTab === 'metrics' ? 'border-b-2 border-[#ff6500] text-[#ff6500]' : 'text-[#8b949e] hover:text-[#ffffff]'}`}
              >
                Metrics View
              </button>
              <button 
                onClick={() => setActiveTab('telemetry')}
                className={`px-4 h-12-2 text-xs font-semibold uppercase tracking-wider transition-all duration-150 border-0 ${activeTab === 'telemetry' ? 'border-b-2 border-[#ff6500] text-[#ff6500]' : 'text-[#8b949e] hover:text-[#ffffff]'}`}
              >
                Live Telemetry
              </button>
              <button 
                onClick={() => setActiveTab('controllers')}
                className={`px-4 h-12-2 text-xs font-semibold uppercase tracking-wider transition-all duration-150 border-0 ${activeTab === 'controllers' ? 'border-b-2 border-[#ff6500] text-[#ff6500]' : 'text-[#8b949e] hover:text-[#ffffff]'}`}
              >
                System Controls
              </button>
            </div>
            <div className="text-xs font-mono text-green-400 bg-[#0d0d0d] px-2 py-1 rounded-md border-0">
              Live Sync
            </div>
          </header>

          {/* Main Segment Content Panel View */}
          <main className="flex-1 p-6 overflow-auto bg-[#0d0d0d]">
            
            {/* Dynamic View rendering depending on active configuration tabs */}
            {activeTab === 'metrics' && (
              <div className="bg-[#161616] rounded-md p-4 border-0 animate-fadeIn">
                <h3 className="text-lg font-semibold mb-2 text-[#ff6500]">System Overview Dashboard</h3>
                <div className="min-h-64 bg-[#1e1e1e] border-0 rounded-md p-2">{metrics}</div>
              </div>
            )}

            {activeTab === 'telemetry' && (
              <div className="bg-[#161616] rounded-md p-4 border-0 animate-fadeIn">
                <h3 className="text-lg font-semibold mb-2 text-[#ff6500]">Real-Time User Activity Ledger</h3>
                <div className="min-h-64 bg-[#1e1e1e] border-0 rounded-md p-2">{telemetry}</div>
              </div>
            )}

            {activeTab === 'controllers' && (
              <div className="bg-[#161616] rounded-md p-4 border-0 animate-fadeIn">
                <h3 className="text-lg font-semibold mb-2 text-[#ff6500]">Global Variable Allocations</h3>
                <div className="min-h-64 bg-[#1e1e1e] border-0 rounded-md p-2">{controllers}</div>
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
