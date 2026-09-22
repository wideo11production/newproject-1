import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Monitor Dashboard',
  description: 'Monitoring dashboard for Wideo11',
};

export default function Layout({
  children, // This will be the children from the layout (if any)
  metrics, // @slot/metrics
  telemetry, // @slot/telemetry
  controllers, // @slot/controllers
}: {
  children?: React.ReactNode;
  metrics: React.ReactNode;
  telemetry: React.ReactNode;
  controllers: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-800 border-r border-gray-700 p-4">
        <h2 className="text-xl font-bold mb-4 text-blue-400">Wideo11 Monitor</h2>
        <nav className="space-y-2">
          <a href="#" className="px-3 py-2 rounded text-sm font-medium hover:bg-gray-700">Metrics</a>
          <a href="#" className="px-3 py-2 rounded text-sm font-medium hover:bg-gray-700">Telemetry</a>
          <a href="#" className="px-3 py-2 rounded text-sm font-medium hover:bg-gray-700">Controllers</a>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 overflow-auto">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-lg font-semibold mb-2 text-green-400">Metrics Panel</h3>
            <div className="h-64">{metrics}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-lg font-semibold mb-2 text-blue-400">Telemetry Panel</h3>
            <div className="h-64">{telemetry}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-lg font-semibold mb-2 text-yellow-400">Controllers Panel</h3>
            <div className="h-64">{controllers}</div>
          </div>
        </div>
      </main>
    </div>
  );
}