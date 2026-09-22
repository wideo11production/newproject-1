export default function AdminTelemetryPage() {
  return (
    <div className="space-y-4">
      <div className="bg-gray-700 p-4 rounded">
        <h3 className="font-semibold">API Performance</h3>
        <div className="mt-2 space-y-2">
          <div className="flex justify-between">
            <span>Request/sec:</span>
            <span className="text-green-400">8.5K</span>
          </div>
          <div className="flex justify-between">
            <span>Avg. Response Time:</span>
            <span className="text-green-400">45ms</span>
          </div>
          <div className="flex justify-between">
            <span>Error Rate:</span>
            <span className="text-green-400">0.1%</span>
          </div>
        </div>
      </div>
      <div className="bg-gray-700 p-4 rounded">
        <h3 className="font-semibold">Database Metrics</h3>
        <div className="mt-2 space-y-2">
          <div className="flex justify-between">
            <span>Queries/sec:</span>
            <span className="text-green-400">12K</span>
          </div>
          <div className="flex justify-between">
            <span>Slow Queries:</span>
            <span className="text-green-400">0.5%</span>
          </div>
          <div className="flex justify-between">
            <span>Connection Pool:</span>
            <span className="text-green-400">78%</span>
          </div>
        </div>
      </div>
    </div>
  );
}