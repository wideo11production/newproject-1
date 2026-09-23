'use client';

import { useState } from 'react';

export default function AdminControllersPage() {
  const [newEditor, setNewEditor] = useState(true);
  const [aiRecommendations, setAiRecommendations] = useState(true);
  const [liveCollaboration, setLiveCollaboration] = useState(false);
  const [logLevel, setLogLevel] = useState('info');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    // Simulate saving to backend
    await new Promise(resolve => setTimeout(resolve, 1500));
    setSaving(false);
    // In a real app, you would show a success message
    alert('Settings saved successfully!');
  };

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 bg-opacity-50 backdrop-blur-sm p-6 rounded-lg border border-gray-800">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-semibold text-gray-100">Feature Flags</h3>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full mt-4 px-4 py-2 text-sm font-medium transition-colors duration-200 ${
              saving
                ? 'bg-gray-600/50 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
        <div className="space-y-4">
          <div className="flex items-center">
            <label htmlFor="new-editor" className="w-32">New Editor:</label>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                id="new-editor"
                type="checkbox"
                className="sr-only peer"
                checked={newEditor}
                onChange={(e) => setNewEditor(e.target.checked)}
              />
              <div className="w-11 h-6 bg-gray-200 peer-check:bg-green-600 rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:bg-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:w-5 after:h-5 after:rounded-full after:transition-all"></div>
            </label>
          </div>
          <div className="flex items-center">
            <label htmlFor="ai-recommendations" className="w-32">AI Recommendations:</label>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                id="ai-recommendations"
                type="checkbox"
                className="sr-only peer"
                checked={aiRecommendations}
                onChange={(e) => setAiRecommendations(e.target.checked)}
              />
              <div className="w-11 h-6 bg-gray-200 peer-check:bg-green-600 rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:bg-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:w-5 after:h-5 after:rounded-full after:transition-all"></div>
            </label>
          </div>
          <div className="flex items-center">
            <label htmlFor="live-collaboration" className="w-32">Live Collaboration:</label>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                id="live-collaboration"
                type="checkbox"
                className="sr-only peer"
                checked={liveCollaboration}
                onChange={(e) => setLiveCollaboration(e.target.checked)}
              />
              <div className="w-11 h-6 bg-gray-200 peer-check:bg-green-600 rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:bg-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:w-5 after:h-5 after:rounded-full after:transition-all"></div>
            </label>
          </div>
        </div>
      </div>
      <div className="bg-gray-900 bg-opacity-50 backdrop-blur-sm p-6 rounded-lg border border-gray-800">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-semibold text-gray-100">System Logs</h3>
          <button
            onClick={() => {
              // Simulate refreshing logs
              // In a real app, you would fetch new logs
              alert('Logs refreshed!');
            }}
            className="px-3 py-1.5 text-sm font-medium transition-colors duration-200 bg-gray-700 hover:bg-gray-600"
          >
            Refresh Logs
          </button>
        </div>
        <div className="space-y-3">
          <div className="flex justify-between">
            <label htmlFor="log-level">Log Level:</label>
            <select
              id="log-level"
              value={logLevel}
              onChange={(e) => setLogLevel(e.target.value)}
              className="border rounded px-2 py-1 bg-gray-800 text-gray-100 w-full"
            >
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info">Info</option>
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