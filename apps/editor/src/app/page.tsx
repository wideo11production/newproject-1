import './globals.css';
import type { Metadata } from 'next';
import { config } from '@wideo11/config';

export const metadata: Metadata = {
  title: 'Video Editor',
  description: 'Wideo11 Video Editor',
};

export default function EditorPage() {
  // Log config for verification (server side)
  console.log("Config loaded:", { appUrl: config.NEXT_PUBLIC_APP_URL, buffer: config.MINIMUM_MAINTENANCE_BUFFER_INR, sisterShare: config.SISTER_SHARE_PERCENTAGE });
  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
        <h1 className="text-xl font-bold text-blue-400">Wideo11 Video Editor</h1>
        <div className="flex items-center space-x-4">
          <button className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm">
            Export
          </button>
          <button className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">
            Settings
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <div className="flex h-full">
          {/* Sidebar - Tools */}
          <aside className="w-64 bg-gray-800 border-r border-gray-700 p-4 overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4 text-green-400">Tools</h2>
            <div className="space-y-3">
              <button className="w-full flex items-center space-x-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-left">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012-2v8a2 2 0 01-2 2h-3l-4 4z"></path></svg>
                <span>Cut</span>
              </button>
              <button className="w-full flex items-center items-center space-x-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-left">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                <span>Split</span>
              </button>
              <button className="w-full flex items-center space-x-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-left">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h2m2-4h6a2 2 0 002 2v2a2 2 0 00-2 2h-2m-2-4V5a2 2 0 012-2h2a2 2 0 012 2v2h2a2 2 0 01-2-2z"></path></svg>
                <span>Crop</span>
              </button>
              <button className="w-full flex items-center space-x-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-left">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 4h2a2 2 0 012 2v2h-2V6l-2-2H8l-2 2v2h-2a2 2 0 01-2-2V6h2z"></path></svg>
                <span>Rotate</span>
              </button>
            </div>
          </aside>

          {/* Canvas Area - Video Preview */}
          <section className="flex-1 relative bg-gray-700 overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center text-gray-500">
              <canvas id="videoCanvas" className="w-full h-full bg-gray-800"></canvas>
              <div className="text-center">
                <p className="mb-2">Video Preview</p>
                <p className="text-xs">No video loaded</p>
              </div>
            </div>
          </section>

          {/* Properties Panel */}
          <aside className="w-64 bg-gray-800 border-l border-gray-700 p-4 overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4 text-blue-400">Properties</h2>
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">Clip Properties</h3>
                <div className="space-y-2">
                  <div className="flex items-center">
                    <span className="w-32">Name:</span>
                    <input type="text" className="flex-1 border rounded px-2 py-1 bg-gray-600 text-white" placeholder="Enter clip name" />
                  </div>
                  <div className="flex items-center">
                    <span className="w-32">Duration:</span>
                    <span className="flex-1 text-right">00:00:00</span>
                  </div>
                </div>
              </div>
              <div>
                <h3 className="font-semibold mb-2">Transform</h3>
                <div className="space-y-2">
                  <div className="flex items-center">
                    <span className="w-32">Position X:</span>
                    <input type="number" className="flex-1 border rounded px-2 py-1 bg-gray-600 text-white" placeholder="0" />
                  </div>
                  <div className="flex items-center">
                    <span className="w-32">Position Y:</span>
                    <input type="number" className="flex-1 border rounded px-2 py-1 bg-gray-600 text-white" placeholder="0" />
                  </div>
                  <div className="flex items-center">
                    <span className="w-32">Scale:</span>
                    <input type="number" className="flex-1 border rounded px-2 py-1 bg-gray-600 text-white" placeholder="100" />
                    <span className="ml-1">%</span>
                  </div>
                  <div className="flex items-center">
                    <span className="w-32">Rotation:</span>
                    <input type="number" className="flex-1 border rounded px-2 py-1 bg-gray-600 text-white" placeholder="0" />
                    <span className="ml-1">°</span>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Timeline */}
      <footer className="bg-gray-800 border-t border-gray-700 p-4">
        <h2 className="text-lg font-semibold mb-2 text-green-400">Timeline</h2>
        <div className="relative h-12 bg-gray-700 rounded overflow-hidden">
          {/* Timeline Ruler */}
          <div className="absolute inset-0 flex items-center pointer-events-none">
            <div className="w-px bg-gray-600 left-1/2 transform -translate-x-1/2"></div>
            {/* More ruler marks can be added here */}
          </div>
          {/* Tracks */}
          <div className="absolute inset-0 flex flex-col">
            {/* Video Track */}
            <div className="flex-1 relative bg-gray-700">
              <div className="absolute left-0 top-0 h-full w-20 bg-gray-600">
                <div className="flex items-center justify-center h-5 text-xs text-gray-400">
                  V1
                </div>
              </div>
              <div className="absolute left-20 right-0 top-0 h-full bg-gray-600/50">
                {/* Clip placeholder */}
                <div className="absolute left-0 top-0 h-full w-24 bg-blue-500/50 rounded"></div>
              </div>
            </div>
            {/* Audio Track 1 */}
            <div className="h-6 relative bg-gray-700">
              <div className="absolute left-0 top-0 h-full w-20 bg-gray-600">
                <div className="flex items-center justify-center h-5 text-xs text-gray-400">
                  A1
                </div>
              </div>
              <div className="absolute left-20 right-0 top-0 h-full bg-gray-600/50">
                {/* Audio clip placeholder */}
                <div className="absolute left-0 top-0 h-full w-24 bg-green-500/50 rounded"></div>
              </div>
            </div>
            {/* Audio Track 2 */}
            <div className="h-6 relative bg-gray-700">
              <div className="absolute left-0 top-0 h-full w-20 bg-gray-600">
                <div className="flex items-center justify-center h-5 text-xs text-gray-400">
                  A2
                </div>
              </div>
              <div className="absolute left-20 right-0 top-0 h-full bg-gray-600/50">
                {/* Audio clip placeholder */}
                <div className="absolute left-0 top-0 h-full w-24 bg-green-500/50 rounded"></div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}