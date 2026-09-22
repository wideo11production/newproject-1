import { useKnowledgeBot } from '@/hooks/useKnowledgeBot';
import { usePersonalizedFeed } from '@/hooks/usePersonalizedFeed';
import { useTelemetry } from '@/hooks/useTelemetry';

export default function AdminDashboard() {
  const { start: startTelemetry } = useTelemetry(1); // Assuming userId 1 for demo
  const { chatId, messages, sendMessage, loading } = useKnowledgeBot(1);
  const { feed, loading: feedLoading } = usePersonalizedFeed(1);

  // Start telemetry when component mounts
  useEffect(() => {
    startTelemetry();
  }, [startTelemetry]);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Admin Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border p-4 rounded">
          <h2 className="text-lg font-semibold mb-2">Knowledge Bot Chat</h2>
          <p>Chat ID: {chatId ?? 'None'}</p>
          {loading ? <p>Loading...</p> : null}
          <div className="mt-2 h-64 overflow-y-auto border p-2">
            {messages.map((msg) => (
              <div key={msg.id} className={`mb-2 ${msg.isBot ? 'text-blue-500' : 'text-gray-700'}`}>
                {msg.content}
              </div>
            ))}
          </div>
          <div className="mt-2 flex">
            <input
              type="text"
              className="flex-1 p-2 border rounded-l"
              placeholder="Type a message"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  sendMessage(e.currentTarget.value);
                  e.currentTarget.value = '';
                }
              }}
            />
            <button
              className="ml-2 px-4 py-2 bg-blue-500 text-white rounded-r"
              onClick={() => {
                const input = document.querySelector('input') as HTMLInputElement;
                if (input?.value.trim()) {
                  sendMessage(input.value);
                  input.value = '';
                }
              }}
              disabled={loading}
            >
              Send
            </button>
          </div>
        </div>

        <div className="border p-4 rounded">
          <h2 className="text-lg font-semibold mb-2">Personalized Feed</h2>
          {feedLoading ? <p>Loading feed...</p> : feed.length === 0 ? <p>No feed items</p> : (
            <ul className="space-y-2">
              {feed.map((item) => (
                <li key={item.id} className="p-2 border rounded">
                  <h3 className="font-medium">{item.title}</h3>
                  <p className="text-sm text-gray-600">{item.description}</p>
                  {item.thumbnailUrl && (
                    <img src={item.thumbnailUrl} alt={item.title} className="mt-2 w-32 h-20 object-cover rounded" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}