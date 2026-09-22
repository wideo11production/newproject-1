export default function MetricsPage() {
  return (
    <div className="space-y-4">
      <div className="bg-gray-700 p-4 rounded">
        <h3 className="font-semibold">System Metrics</h3>
        <div className="mt-2 space-y-2">
          <div className="flex justify-between">
            <span>CPU Usage:</span>
            <span className="text-green-400">45%</span>
          </div>
          <div className="flex justify-between">
            <span>Memory Usage:</span>
            <span className="text-green-400">60%</span>
          </div>
          <div className="flex justify-between">
            <span>Disk I/O:</span>
            <span className="text-green-400">120 MB/s</span>
          </div>
        </div>
      </div>
      <div className="bg-gray-700 p-4 rounded">
        <h3 className="font-semibold">Video Processing Stats</h3>
        <div className="mt-2 space-y-2">
          <div className="flex justify-between">
            <span>Active Encodes:</span>
            <span className="text-green-400">12</span>
          </div>
          <div className="flex justify-between">
            <span>Queue Depth:</span>
            <span className="text-green-400">3</span>
          </div>
          <div className="flex justify-between">
            <span>Avg. Encode Time:</span>
            <span className="text-green-400">4.2s</span>
          </div>
        </div>
      </div>
    </div>
  );
}