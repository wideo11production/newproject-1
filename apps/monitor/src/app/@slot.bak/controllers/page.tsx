"use client";

export const dynamic = 'force-dynamic';

export default function ControllersPage() {
  return (
    <div className="space-y-4">
      <div className="bg-gray-700 p-4 rounded">
        <h3 className="font-semibold">System Controls</h3>
        <div className="mt-4 space-y-3">
          <div className="flex items-center">
            <span className="w-32">Encoding Priority:</span>
            <select className="border rounded px-2 py-1 bg-gray-600 text-white w-full">
              <option value="low">Low</option>
              <option value="normal" selected>Normal</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="flex items-center">
            <span className="w-32">Video Bitrate:</span>
            <input type="number" className="border rounded px-2 py-1 bg-gray-600 text-white w-full" value="5000" />
            <span className="ml-2">kbps</span>
          </div>
          <div className="flex items-center">
            <span className="w-32">Max Concurrent:</span>
            <input type="number" className="border rounded px-2 py-1 bg-gray-600 text-white w-full" value="10" />
          </div>
          <button className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded">
            Apply Settings
          </button>
        </div>
      </div>
      <div className="bg-gray-700 p-4 rounded">
        <h3 className="font-semibold">Pipeline Status</h3>
        <div className="mt-2 space-y-2">
          <div className="flex justify-between">
            <span>Ingestion:</span>
            <span className="text-green-400">Healthy</span>
          </div>
          <div className="flex justify-between">
            <span>Processing:</span>
            <span className="text-green-400">Healthy</span>
          </div>
          <div className="flex justify-between">
            <span>Output:</span>
            <span className="text-green-400">Healthy</span>
          </div>
        </div>
      </div>
    </div>
  );
}