import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@wideo11/ui/avatar';
import { Skeleton } from '@wideo11/ui/skeleton';

export default function ChannelGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {channels.map((channel) => (
        <Card key={channel.id} className="bg-gray-900/50 border-gray-800 overflow-hidden group">
          <CardContent className="p-4">
            <div className="flex items-center space-x-3 mb-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={channel.avatar} alt={channel.name} />
                <AvatarFallback>{channel.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <h3 className="font-medium text-ink">{channel.name}</h3>
                <p className="text-xs text-gray-500">{channel.subscribers}</p>
              </div>
            </div>
            <p className="text-sm text-gray-400 line-clamp-2">{channel.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const channels = [
  {
    id: '1',
    name: 'DevOps Weekly',
    avatar: 'https://via.placeholder.com/40/333/fff?text=DW',
    subscribers: '1.2M subscribers',
    description: 'Weekly deep dives into DevOps practices, tools, and methodologies.',
  },
  {
    id: '2',
    name: 'React Mastery',
    avatar: 'https://via.placeholder.com/40/333/fff?text=RM',
    subscribers: '3.4M subscribers',
    description: 'Learn advanced React patterns, hooks, and performance optimization.',
  },
  {
    id: '3',
    name: 'Go Labs',
    avatar: 'https://via.placeholder.com/40/333/fff?text=GL',
    subscribers: '560K subscribers',
    description: 'Exploring Go language features, concurrency, and best practices.',
  },
  {
    id: '4',
    name: 'K8s Academy',
    avatar: 'https://via.placeholder.com/40/333/fff?text=KA',
    subscribers: '890K subscribers',
    description: 'Kubernetes tutorials, from basics to advanced concepts.',
  },
  {
    id: '5',
    name: 'VideoDev',
    avatar: 'https://via.placeholder.com/40/333/fff?text=VD',
    subscribers: '340K subscribers',
    description: 'Video platform engineering, streaming protocols, and infrastructure.',
  },
  {
    id: '6',
    name: 'Docker Official',
    avatar: 'https://via.placeholder.com/40/333/fff?text=DO',
    subscribers: '2.1M subscribers',
    description: 'Official Docker content, tutorials, and container best practices.',
  },
  {
    id: '7',
    name: 'Database School',
    avatar: 'https://via.placeholder.com/40/333/fff?text=DS',
    subscribers: '780K subscribers',
    description: 'Database design, performance tuning, and migration strategies.',
  },
  {
    id: '8',
    name: 'Redis Labs',
    avatar: 'https://via.placeholder.com/40/333/fff?text=RL',
    subscribers: '650K subscribers',
    description: 'Redis tutorials, use cases, and performance optimization tips.',
  },
  {
    id: '9',
    name: 'Grafana',
    avatar: 'https://via.placeholder.com/40/333/fff?text=GF',
    subscribers: '420K subscribers',
    description: 'Observability, monitoring, and dashboard creation tutorials.',
  },
];
