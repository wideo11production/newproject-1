'use client';

import { MousePointer, MapPin, Globe, Zap, Search, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { ScrollArea } from '@wideo11/ui/scroll-area';

interface ClickEvent {
  id: string;
  timestamp: string;
  user: string;
  event: string;
  page: string;
  device: string;
  location: string;
  duration: number;
}

const events: ClickEvent[] = [
  { id: '1', timestamp: '2024-01-15 14:32:10', user: 'user_001', event: 'video_play', page: '/watch/abc123', device: 'Desktop', location: 'Mumbai, IN', duration: 245 },
  { id: '2', timestamp: '2024-01-15 14:31:45', user: 'user_002', event: 'cta_click', page: '/creator/dashboard', device: 'Mobile', location: 'Delhi, IN', duration: 12 },
  { id: '3', timestamp: '2024-01-15 14:30:22', user: 'user_003', event: 'share_click', page: '/watch/xyz789', device: 'Tablet', location: 'Bangalore, IN', duration: 8 },
  { id: '4', timestamp: '2024-01-15 14:29:10', user: 'user_004', event: 'video_pause', page: '/watch/def456', device: 'Desktop', location: 'Hyderabad, IN', duration: 180 },
  { id: '5', timestamp: '2024-01-15 14:28:33', user: 'user_005', event: 'fullscreen_toggle', page: '/watch/ghi789', device: 'Mobile', location: 'Chennai, IN', duration: 5 },
  { id: '6', timestamp: '2024-01-15 14:27:01', user: 'user_006', event: 'quality_change', page: '/watch/jkl012', device: 'Desktop', location: 'Pune, IN', duration: 3 },
  { id: '7', timestamp: '2024-01-15 14:25:44', user: 'user_007', event: 'subscribe_click', page: '/channel/creator123', device: 'Mobile', location: 'Kolkata, IN', duration: 2 },
  { id: '8', timestamp: '2024-01-15 14:24:18', user: 'user_008', event: 'comment_post', page: '/watch/mno345', device: 'Desktop', location: 'Ahmedabad, IN', duration: 45 },
];

const eventColors: Record<string, { bg: string; text: string; border: string }> = {
  video_play: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  cta_click: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
  share_click: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
  video_pause: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  fullscreen_toggle: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  quality_change: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
  subscribe_click: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
  comment_post: { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30' },
};

export function ClickstreamAnalytics() {
  return (
    <Card className="analytics-panel h-full">
      <CardHeader className="analytics-panel-header">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <MousePointer className="h-5 w-5" />
          Clickstream Analytics
        </CardTitle>
      </CardHeader>
      <CardContent className="analytics-panel-content">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-card border-border p-4 text-center">
            <Zap className="h-8 w-8 mx-auto text-blue-400 mb-2" />
            <div className="text-3xl font-bold text-foreground">12,450</div>
            <div className="text-xs text-muted-foreground">Total Events (1h)</div>
          </Card>
          <Card className="bg-card border-border p-4 text-center">
            <MousePointer className="h-8 w-8 mx-auto text-green-400 mb-2" />
            <div className="text-3xl font-bold text-foreground">3,210</div>
            <div className="text-xs text-muted-foreground">Unique Users</div>
          </Card>
          <Card className="bg-card border-border p-4 text-center">
            <Globe className="h-8 w-8 mx-auto text-purple-400 mb-2" />
            <div className="text-3xl font-bold text-foreground">47</div>
            <div className="text-xs text-muted-foreground">Countries</div>
          </Card>
          <Card className="bg-card border-border p-4 text-center">
            <Search className="h-8 w-8 mx-auto text-orange-400 mb-2" />
            <div className="text-3xl font-bold text-foreground">2m 34s</div>
            <div className="text-xs text-muted-foreground">Avg Session</div>
          </Card>
        </div>

        <ScrollArea className="h-[300px]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 px-2">Time</th>
                <th className="pb-2 px-2">User</th>
                <th className="pb-2 px-2">Event</th>
                <th className="pb-2 px-2">Page</th>
                <th className="pb-2 px-2">Device</th>
                <th className="pb-2 px-2">Location</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const colors = eventColors[event.event] || eventColors.video_play;
                return (
                  <tr key={event.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2 px-2 text-muted-foreground font-mono text-xs">{event.timestamp}</td>
                    <td className="py-2 px-2 text-foreground font-mono text-xs">{event.user}</td>
                    <td className="py-2 px-2">
                      <Badge variant="outline" className={`${colors.bg} ${colors.text} ${colors.border} text-xs`}>
                        {event.event}
                      </Badge>
                    </td>
                    <td className="py-2 px-2 text-muted-foreground truncate max-w-[150px]">{event.page}</td>
                    <td className="py-2 px-2 text-center text-muted-foreground text-xs">{event.device}</td>
                    <td className="py-2 px-2 text-muted-foreground text-xs">{event.location}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}