export default function AdminControllersPage() {
  return (
    <div className="space-y-4">
      <div className="bg-gray-700 p-4 rounded">
        <h3 className="font-semibold">Feature Flags</h3 Toggles</h3>
        <div className="mt-4 space-y-3">
          <div className="flex items-center">
            <span className="w-32">New Editor:</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked />
              <div className="w-11 h-6 bg-gray-200 peer-check:bg-green-600 rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:bg-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:w-5 after:h-5 after:rounded-full after:transition-all"></div>
            </label>
          </div>
          <div className="flex items-center">
            <span className="w-32">AI Recommendations:</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked />
              <div className="w-11 h-6 bg-gray-200 peer-check:bg-green-600 rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:bg-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:w-5 after:h-5 after:rounded-full after:transition-all"></div>
            </label>
          </div>
          <div className="flex items-center">
            <span className="w-32">Live Collaboration:</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-check:bg-green-600 rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:bg-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:w-5 after:h-5 after:rounded-full after:transition-all"></div>
            </label>
          </div>
          <button className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded mt-4">
            Save Settings
          </button>
        </div>
      </div>
      <div className="bg-gray-700 p-4 rounded">
        <h3 className="font-semibold">System Logs</h3>
        <div className="mt-2 space-y-2">
          <div className="flex justify-between">
            <span>Log Level:</span>
            <select className="border rounded px-2 py-1 bg-gray-600 text-white w-full">
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info" selected>Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>
          <div className="flex items-start space-y-2">
            <span className="block font-mono text-sm text-green-400">
              [INFO] 12:30:45 User #12345 logged in
            </span>
            <span className="block font-mono text-sm text-green-400">
              [WARN] 12:30:44 High memory usage detected
            </span>
            <span className="block font-mono text-sm text-green-400">
              [INFO] 12:30:43 Backup completed successfully
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}