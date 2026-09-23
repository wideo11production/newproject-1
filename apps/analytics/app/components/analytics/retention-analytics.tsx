'use client';

import { LineChart, BarChart3, Users, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@wideo11/ui/card';
import { ScrollArea } from '@wideo11/ui/scroll-area';

interface RetentionData {
  day: string;
  day1: number;
  day7: number;
  day30: number;
}

const retentionData: RetentionData[] = [
  { day: 'Jan 1', day1: 45, day7: 28, day30: 12 },
  { day: 'Jan 8', day1: 48, day7: 31, day30: 14 },
  { day: 'Jan 15', day1: 42, day7: 26, day30: 11 },
  { day: 'Jan 22', day1: 51, day7: 33, day30: 15 },
  { day: 'Jan 29', day1: 47, day7: 29, day30: 13 },
  { day: 'Feb 5', day1: 49, day7: 30, day30: 14 },
  { day: 'Feb 12', day1: 53, day7: 35, day30: 16 },
  { day: 'Feb 19', day1: 46, day7: 27, day30: 12 },
  { day: 'Feb 26', day1: 50, day7: 32, day30: 14 },
  { day: 'Mar 5', day1: 48, day7: 30, day30: 13 },
  { day: 'Mar 12', day1: 52, day7: 34, day30: 15 },
  { day: 'Mar 19', day1: 49, day7: 31, day30: 14 },
];

export function RetentionAnalytics() {
  const maxValue = Math.max(...retentionData.flatMap(d => [d.day1, d.day7, d.day30]));

  return (
    <Card className="analytics-panel h-full">
      <CardHeader className="analytics-panel-header">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <LineChart className="h-5 w-5" />
          Retention Analytics
        </CardTitle>
      </CardHeader>
      <CardContent className="analytics-panel-content">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card className="bg-card border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">Day 1 Retention</span>
            </div>
            <div className="text-2xl font-bold text-foreground">48.2%</div>
            <div className="text-xs text-green-400 flex items-center gap-1"><TrendingDown className="h-3 w-3" /> +2.1% vs last month</div>
          </Card>
          <Card className="bg-card border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-green-400" />
              <span className="text-xs text-muted-foreground">Day 7 Retention</span>
            </div>
            <div className="text-2xl font-bold text-foreground">31.5%</div>
            <div className="text-xs text-green-400 flex items-center gap-1"><TrendingDown className="h-3 w-3" /> +1.8% vs last month</div>
          </Card>
          <Card className="bg-card border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-purple-400" />
              <span className="text-xs text-muted-foreground">Day 30 Retention</span>
            </div>
            <div className="text-2xl font-bold text-foreground">13.8%</div>
            <div className="text-xs text-red-400 flex items-center gap-1"><TrendingDown className="h-3 w-3" /> -0.5% vs last month</div>
          </Card>
        </div>

        <ScrollArea className="h-[300px]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 px-2">Date</th>
                <th className="pb-2 px-2 text-right">Day 1</th>
                <th className="pb-2 px-2 text-right">Day 7</th>
                <th className="pb-2 px-2 text-right">Day 30</th>
              </tr>
            </thead>
            <tbody>
              {retentionData.map((row, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 px-2 text-foreground">{row.day}</td>
                  <td className="py-2 px-2 text-right text-blue-400 font-medium">{row.day1}%</td>
                  <td className="py-2 px-2 text-right text-green-400 font-medium">{row.day7}%</td>
                  <td className="py-2 px-2 text-right text-purple-400 font-medium">{row.day30}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}