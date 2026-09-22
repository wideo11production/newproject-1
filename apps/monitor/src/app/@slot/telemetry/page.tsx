export default function TelemetryPage() {
  return (
    <div className="space-y-4">
      <div className="bg-gray-700 p-4 rounded">
        <h3 className="font-semibold">Real-time Telemetry</h3>
        <div className="mt-2">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Events/sec:</span>
              <span className="text-green-400">1.2K</span>
            </div>
            <div className="flex justify-between">
              <span>Avg. Latency:</span>
              <span className="text-green-400">12ms</span>
            </div>
            <div className="flex justify-between">
              <span>Error Rate:</span>
              <span className="text-green-400">0.01%</span>
            </div>
          </div>
        </div>
      </div>
      <div className="bg-gray-700 p-4 rounded">
        <h3 className="font-semibold">User Activity</h3>
        <div className="mt-2 space-y-2">
          <div className="flex justify-between">
            <span>Active Users:</span>
            <span className="text-green-400">245</span>
          </div>
          <div className="flex justify-between">
            <span>Session Duration:</span>
            <span className="text-green-400">12.5m</span>
          </div>
          <div className="flex justify-between">
            <span>Feature Usage:</span>
            <span className="text-green-400">Editor: 45%, Dashboard: 30%</span>
          </div>
        </div>
      </div>
    </div>
  );
}