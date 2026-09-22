export default function AdminMetricsPage() {
  return (
    <div className="space-y-4">
      <div className="bg-gray-700 p-4 rounded">
        <h3 className="font-semibold">User Management</h3>
        <div className="mt-2 space-y-2">
          <div className="flex justify-between">
            <span>Total Users:</span>
            <span className="text-green-400">12,450</span>
          </div>
          <div className="flex justify-between">
            <span>Active Today:</span>
            <span className="text-green-400">3,200</span>
          </div>
          <div className="flex justify-between">
            <span>New Signups:</span>
            <span className="text-green-400">125</span>
          </div>
        </div>
      </div>
      <div className="bg-gray-700 p-4 rounded">
        <h3 className="font-semibold">Content Stats</h3>
        <div className="mt-2 space-y-2">
          <div className="flex justify-between">
            <span>Videos Uploaded:</span>
            <span className="text-green-400">450K</span>
          </div>
          <div className="flex justify-between">
            <span>Hours Processed:</span>
            <span className="text-green-400">1.2M</span>
          </div>
          <div className="flex justify-between">
            <span>Storage Used:</span>
            <span className="text-green-400">12 TB</span>
          </div>
        </div>
      </div>
    </div>
  );
}