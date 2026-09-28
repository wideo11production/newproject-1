import { Suspense } from 'react';
import { Play } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@wideo11/ui/card';
import { Skeleton } from '@wideo11/ui/skeleton';
import Image from 'next/image';

export default function TrendingVideos() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {trendingVideos.map((video) => (
        <Card key={video.id} className="bg-gray-900/50 border-gray-800 overflow-hidden group">
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
            <CardTitle className="text-sm font-medium text-gray-200 line-clamp-2">
              {video.title}
            </CardTitle>
            <CardDescription className="mt-1 text-xs text-gray-500">
              {video.channel}
            </CardDescription>
            <div className="flex items-center text-xs text-gray-500 mt-2">
              <Play className="h-3 w-3 mr-1" />
              {video.views} views
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const trendingVideos = [
  {
    id: '1',
    title: 'Building a Custom Observability Platform',
    channel: 'DevOps Weekly',
    views: '125K',
    duration: '12:34',
    thumbnail: 'https://via.placeholder.com/300x200/333/fff?text=Video+1',
  },
  {
    id: '2',
    title: 'Advanced React Patterns in 2026',
    channel: 'React Mastery',
    views: '842K',
    duration: '24:15',
    thumbnail: 'https://via.placeholder.com/300x200/333/fff?text=Video+2',
  },
  {
    id: '3',
    title: 'Go Microservices Architecture',
    channel: 'Go Labs',
    views: '56K',
    duration: '35:22',
    thumbnail: 'https://via.placeholder.com/300x200/333/fff?text=Video+3',
  },
  {
    id: '4',
    title: 'Kubernetes Observability Deep Dive',
    channel: 'K8s Academy',
    views: '234K',
    duration: '48:17',
    thumbnail: 'https://via.placeholder.com/300x200/333/fff?text=Video+4',
  },
  {
    id: '5',
    title: 'Building Video Streaming Platforms',
    channel: 'VideoDev',
    views: '78K',
    duration: '41:05',
    thumbnail: 'https://via.placeholder.com/300x200/333/fff?text=Video+5',
  },
  {
    id: '6',
    title: 'Docker in Production: Best Practices',
    channel: 'Docker Official',
    views: '567K',
    duration: '18:43',
    thumbnail: 'https://via.placeholder.com/300x200/333/fff?text=Video+6',
  },
  {
    id: '7',
    title: 'PostgreSQL Performance Tuning',
    channel: 'Database School',
    views: '45K',
    duration: '27:55',
    thumbnail: 'https://via.placeholder.com/300x200/333/fff?text=Video+7',
  },
  {
    id: '8',
    title: 'Redis for Real-time Applications',
    channel: 'Redis Labs',
    views: '132K',
    duration: '22:18',
    thumbnail: 'https://via.placeholder.com/300x200/333/fff?text=Video+8',
  },
];
