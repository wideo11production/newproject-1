'use client';

import { Target, TrendingUp, AlertCircle, CheckCircle, Calendar, DollarSign, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { Progress } from '@wideo11/ui/progress';
import { ScrollArea } from '@wideo11/ui/scroll-area';

interface DailyTarget {
  date: string;
  target: number;
  actual: number;
  creator: string;
  status: 'met' | 'exceeded' | 'missed';
}

const dailyTargets: DailyTarget[] = [
  { date: '2024-01-15', target: 500, actual: 620, creator: 'Alex Creator', status: 'exceeded' },
  { date: '2024-01-14', target: 500, actual: 500, creator: 'Sarah Videos', status: 'met' },
  { date: '2024-01-13', target: 500, actual: 380, creator: 'Mike Tutorials', status: 'missed' },
  { date: '2024-01-12', target: 500, actual: 750, creator: 'Emma Edits', status: 'exceeded' },
  { date: '2024-01-11', target: 500, actual: 450, creator: 'Chris Clips', status: 'missed' },
  { date: '2024-01-10', target: 500, actual: 500, creator: 'Lisa Vlogs', status: 'met' },
  { date: '2024-01-09', target: 500, actual: 890, creator: 'Alex Creator', status: 'exceeded' },
  { date: '2024-01-08', target: 500, actual: 420, creator: 'Mike Tutorials', status: 'missed' },
  { date: '2024-01-07', target: 500, actual: 560, creator: 'Sarah Videos', status: 'exceeded' },
  { date: '2024-01-06', target: 500, actual: 500, creator: 'Chris Clips', status: 'met' },
  { date: '2024-01-05', target: 500, actual: 680, creator: 'Emma Edits', status: 'exceeded' },
  { date: '2024-01-04', target: 500, actual: 390, creator: 'Lisa Vlogs', status: 'missed' },
  { date: '2024-01-03', target: 500, actual: 500, creator: 'Alex Creator', status: 'met' },
  { date: '2024-01-02', target: 500, actual: 470, creator: 'Mike Tutorials', status: 'missed' },
  { date: '2024-01-01', target: 500, actual: 530, creator: 'Sarah Videos', status: 'exceeded' },
];

const DAILY_TARGET = 500;

function getStatusConfig(status: DailyTarget['status']) {
  const config = {
    met: { label: 'Target Met', icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20', border: 'border-green-500/30' },
    exceeded: { label: 'Exceeded', icon: TrendingUp, color: 'text-blue-400', bg: 'bg-blue-500/20', border: 'border-blue-500/30' },
    missed: { label: 'Missed', icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/30' },
  };
  return config[status];
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function TargetLedger() {
  const totalDays = dailyTargets.length;
  const metDays = dailyTargets.filter(d => d.status !== 'missed').length;
  const totalEarned = dailyTargets.reduce((sum, d) => sum + d.actual, 0);
  const avgDaily = Math.round(totalEarned / totalDays);
  const successRate = Math.round((metDays / totalDays) * 100);

  return (
    <Card className="analytics-panel h-full">
      <CardHeader className="analytics-panel-header">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Target className="h-5 w-5" />
          Target Ledger - ₹500/Day
        </CardTitle>
      </CardHeader>
      <CardContent className="analytics-panel-content">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-card border-border p-4 text-center">
            <Target className="h-8 w-8 mx-auto text-primary mb-2" />
            <div className="text-2xl font-bold text-foreground">₹{avgDaily.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Avg Daily Earning</div>
          </Card>
          <Card className="bg-card border-border p-4 text-center">
            <TrendingUp className="h-8 w-8 mx-auto text-green-400 mb-2" />
            <div className="text-2xl font-bold text-foreground">{successRate}%</div>
            <div className="text-xs text-muted-foreground">Success Rate</div>
          </Card>
          <Card className="bg-card border-border p-4 text-center">
            <DollarSign className="h-8 w-8 mx-auto text-yellow-400 mb-2" />
            <div className="text-2xl font-bold text-foreground">₹{totalEarned.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Total Earned</div>
          </Card>
          <Card className="bg-card border-border p-4 text-center">
            <Calendar className="h-8 w-8 mx-auto text-purple-400 mb-2" />
            <div className="text-2xl font-bold text-foreground">{metDays}/{totalDays}</div>
            <div className="text-xs text-muted-foreground">Days Target Met</div>
          </Card>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-muted-foreground">Progress to Monthly Goal (₹15,000)</h4>
            <span className="text-sm font-semibold text-primary">
              {Math.round((totalEarned / 15000) * 100)}%
            </span>
          </div>
          <Progress value={Math.min((totalEarned / 15000) * 100, 100)} className="h-3" />
        </div>

        <ScrollArea className="h-[300px]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 px-2">Date</th>
                <th className="pb-2 px-2">Creator</th>
                <th className="pb-2 px-2 text-right">Target</th>
                <th className="pb-2 px-2 text-right">Actual</th>
                <th className="pb-2 px-2 text-right">Diff</th>
                <th className="pb-2 px-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {dailyTargets.map((row) => {
                const diff = row.actual - row.target;
                const statusConfig = getStatusConfig(row.status);
                const StatusIcon = statusConfig.icon;
                return (
                  <tr key={row.date} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2 px-2 text-foreground">{formatDate(row.date)}</td>
                    <td className="py-2 px-2 text-foreground">{row.creator}</td>
                    <td className="py-2 px-2 text-right text-muted-foreground">₹{row.target.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right font-medium text-foreground">₹{row.actual.toLocaleString()}</td>
                    <td className={`py-2 px-2 text-right font-semibold ${diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {diff >= 0 ? '+' : ''}₹{Math.abs(diff).toLocaleString()}
                    </td>
                    <td className="py-2 px-2">
                      <Badge variant="outline" className={`${statusConfig.bg} ${statusConfig.color} ${statusConfig.border} text-xs flex items-center gap-1`}>
                        <StatusIcon className="h-3 w-3" />
                        {statusConfig.label}
                      </Badge>
                    </td>
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