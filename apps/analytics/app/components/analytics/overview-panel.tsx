'use client';

import { BarChart3, TrendingUp, Users, DollarSign, Activity, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';

interface Metric {
  label: string;
  value: string;
  change: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  bgColor: string;
  borderColor: string;
}

const metrics: Metric[] = [
  { label: 'Total Views', value: '1.2M', change: '+12.5%', icon: Activity, iconColor: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/20' },
  { label: 'Active Creators', value: '3.4K', change: '+8.2%', icon: Users, iconColor: 'text-green-400', bgColor: 'bg-green-500/10', borderColor: 'border-green-500/20' },
  { label: 'Revenue', value: '$45.2K', change: '+15.3%', icon: DollarSign, iconColor: 'text-yellow-400', bgColor: 'bg-yellow-500/10', borderColor: 'border-yellow-500/20' },
  { label: 'Avg Watch Time', value: '4m 32s', change: '+2.1%', icon: Clock, iconColor: 'text-purple-400', bgColor: 'bg-purple-500/10', borderColor: 'border-purple-500/20' },
];

export function OverviewPanel() {
  return (
    <Card className="analytics-panel h-full">
      <CardHeader className="analytics-panel-header">
        <CardTitle className="text-lg font-semibold">Overview</CardTitle>
      </CardHeader>
      <CardContent className="analytics-panel-content space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {metrics.map((metric, index) => (
            <Card key={index} className={`bg-card border-border ${metric.bgColor} ${metric.borderColor} p-4`}>
              <div className="flex items-center justify-between mb-2">
                <metric.icon className={`h-5 w-5 ${metric.iconColor}`} />
                <Badge variant="outline" className="text-xs border-border">
                  {metric.change}
                </Badge>
              </div>
              <div className="text-2xl font-bold text-foreground">{metric.value}</div>
              <div className="text-xs text-muted-foreground">{metric.label}</div>
            </Card>
          ))}
        </div>
        <div className="border-t border-border pt-4">
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Top Performing Videos</h4>
          <div className="space-y-2">
            {[
              { title: 'How to Edit Like a Pro', views: '245K', creator: 'John Doe' },
              { title: 'Best Transitions 2024', views: '189K', creator: 'Jane Smith' },
              { title: 'Color Grading Basics', views: '156K', creator: 'Mike Wilson' },
            ].map((video, i) => (
              <div key={i} className="flex items-center justify-between p-2 bg-muted/50 rounded border border-border">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{video.title}</p>
                  <p className="text-xs text-muted-foreground">{video.creator}</p>
                </div>
                <span className="text-sm font-semibold text-primary ml-4">{video.views}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}