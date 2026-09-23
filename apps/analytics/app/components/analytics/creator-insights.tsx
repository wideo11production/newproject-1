'use client';

import { Users, TrendingUp, Target, Award, Activity, DollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { ScrollArea } from '@wideo11/ui/scroll-area';

interface Creator {
  id: string;
  name: string;
  avatar: string;
  subscribers: number;
  views: number;
  revenue: number;
  growth: number;
  status: 'growing' | 'stable' | 'declining';
}

const creators: Creator[] = [
  { id: '1', name: 'Alex Creator', avatar: 'AC', subscribers: 125000, views: 2400000, revenue: 12500, growth: 15.2, status: 'growing' },
  { id: '2', name: 'Sarah Videos', avatar: 'SV', subscribers: 89000, views: 1800000, revenue: 8900, growth: 8.5, status: 'growing' },
  { id: '3', name: 'Mike Tutorials', avatar: 'MT', subscribers: 67000, views: 1200000, revenue: 6200, growth: -2.1, status: 'declining' },
  { id: '4', name: 'Emma Edits', avatar: 'EE', subscribers: 45000, views: 890000, revenue: 4100, growth: 12.8, status: 'growing' },
  { id: '5', name: 'Chris Clips', avatar: 'CC', subscribers: 32000, views: 560000, revenue: 2800, growth: 3.4, status: 'stable' },
  { id: '6', name: 'Lisa Vlogs', avatar: 'LV', subscribers: 28000, views: 450000, revenue: 2100, growth: -1.2, status: 'declining' },
];

function getStatusBadge(status: Creator['status']) {
  const config = {
    growing: { variant: 'default' as const, className: 'bg-green-500/20 text-green-400 border-green-500/30', label: 'Growing' },
    stable: { variant: 'secondary' as const, className: 'bg-blue-500/20 text-blue-400 border-blue-500/30', label: 'Stable' },
    declining: { variant: 'destructive' as const, className: 'bg-red-500/20 text-red-400 border-red-500/30', label: 'Declining' },
  };
  return config[status];
}

export function CreatorInsights() {
  return (
    <Card className="analytics-panel h-full">
      <CardHeader className="analytics-panel-header">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Users className="h-5 w-5" />
          Creator Insights
        </CardTitle>
      </CardHeader>
      <CardContent className="analytics-panel-content">
        <ScrollArea className="h-[400px]">
          <div className="space-y-3">
            {creators.map((creator) => {
              const statusConfig = getStatusBadge(creator.status);
              return (
                <div key={creator.id} className="flex items-center gap-4 p-3 bg-card border border-border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium text-sm">
                    {creator.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{creator.name}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {creator.subscribers.toLocaleString()} subs</span>
                      <span className="flex items-center gap-1"><Activity className="h-3 w-3" /> {creator.views.toLocaleString()} views</span>
                      <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> ${creator.revenue.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusConfig.variant} className={statusConfig.className}>
                      {statusConfig.label}
                    </Badge>
                    <span className={`text-sm font-semibold ${creator.growth >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {creator.growth >= 0 ? '+' : ''}{creator.growth}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}