import { Play } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { Skeleton } from '@wideo11/ui/skeleton';
import Image from 'next/image';

export default function VideoGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {videos.map((video) => (
        <Card key={video.id} className="bg-gray-900/50-800 overflow-hidden group">
          <div className="relative aspect-video bg-gray-800">
            <Image
              src={video.thumbnail}
              alt={video.title}
              fill
              className="object-cover group-hover:scale-105 transition-transform"
            />
            <div className="absolute bottom-1 right-1 bg-black/70 text-ink text-xs px-1 rounded">
              {video.duration}
            </div>
          </div>
          <CardContent className="p-3">
            <div className="flex space-x-2">
              <div className="w-8 h-8 rounded-full bg-gray-800 flex-shrink-0" />
              <div className="flex-1">
                <CardTitle className="text-sm font-medium text-gray-200 line-clamp-2">
                  {video.title}
                </CardTitle>
              </div>
            </div>
            <CardDescription className="mt-1 text-xs text-gray-500">
              {video.channel} • {video.views} views
            </CardDescription>
            {video.tags && (
              <div className="flex flex-wrap gap-1 mt-2">
                {video.tags.map(tag => (
                  <Badge key={tag} variant="outline" className="border-gray-700 text-gray-400 text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const videos = [
  {
    id: 'v1',
    title: 'Building Wideo11: Architecture Deep Dive',
    channel: 'Wideo11',
    views: '12.3K',
    duration: '24:15',
    thumbnail: 'https://via.placeholder.com/300x169/333/fff?text=Video+1',
    tags: ['Architecture', 'Backend'],
  },
  {
    id: 'v2',
    title: 'Next.js 14 App Router Patterns',
    channel: 'React Mastery',
    views: '45.2K',
    duration: '32:18',
    thumbnail: 'https://via.placeholder.com/300x169/333/fff?text=Video+2',
    tags: ['React', 'Frontend', 'Tutorial'],
  },
  {
    id: 'v3',
    title: 'Custom Grafana Dashboard Implementation',
    channel: 'DevOps Weekly',
    views: '8.7K',
    duration: '38:42',
    thumbnail: 'https://via.placeholder.com/300x169/333/fff?text=Video+3',
    tags: ['Observability', 'Grafana', 'Monitoring'],
  },
  {
    id: 'v4',
    title: 'Go Microservices Best Practices',
    channel: 'Go Labs',
    views: '32.1K',
    duration: '28:05',
    thumbnail: 'https://via.placeholder.com/300x169/333/fff?text=Video+4',
    tags: ['Go', 'Backend', 'Microservices'],
  },
  {
    id: 'v5',
    title: 'Real-time Video Streaming with HLS',
    channel: 'VideoDev',
    views: '15.4K',
    duration: '42:33',
    thumbnail: 'https://via.placeholder.com/300x169/333/fff?text=Video+5',
    tags: ['Video', 'Streaming', 'HLS'],
  },
  {
    id: 'v6',
    title: 'Kubernetes Observability with Prometheus',
    channel: 'K8s Academy',
    views: '67.8K',
    duration: '51:12',
    thumbnail: 'https://via.placeholder.com/300x169/333/fff?text=Video+6',
    tags: ['Kubernetes', 'Prometheus', 'Monitoring'],
  },
  {
    id: 'v7',
    title: 'PostgreSQL Partitioning Strategies',
    channel: 'Database School',
    views: '9.2K',
    duration: '35:47',
    thumbnail: 'https://via.placeholder.com/300x169/333/fff?text=Video+7',
    tags: ['Database', 'PostgreSQL', 'Performance'],
  },
  {
    id: 'v8',
    title: 'Docker Compose for Developers',
    channel: 'Docker Official',
    views: '123K',
    duration: '22:38',
    thumbnail: 'https://via.placeholder.com/300x169/333/fff?text=Video+8',
    tags: ['Docker', 'DevOps', 'Beginner'],
  },
];
