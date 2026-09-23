'use client';

import { DollarSign, TrendingUp, CreditCard, Coins, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@wideo11/ui/card';
import { ScrollArea } from '@wideo11/ui/scroll-area';

interface RevenueData {
  date: string;
  ads: number;
  subscriptions: number;
  sponsorships: number;
  merchandise: number;
  total: number;
}

const revenueData: RevenueData[] = [
  { date: 'Jan 1', ads: 1200, subscriptions: 800, sponsorships: 500, merchandise: 200, total: 2700 },
  { date: 'Jan 8', ads: 1350, subscriptions: 850, sponsorships: 600, merchandise: 250, total: 3050 },
  { date: 'Jan 15', ads: 1100, subscriptions: 900, sponsorships: 450, merchandise: 180, total: 2630 },
  { date: 'Jan 22', ads: 1400, subscriptions: 950, sponsorships: 700, merchandise: 300, total: 3350 },
  { date: 'Jan 29', ads: 1250, subscriptions: 880, sponsorships: 550, merchandise: 220, total: 2900 },
  { date: 'Feb 5', ads: 1500, subscriptions: 1000, sponsorships: 800, merchandise: 350, total: 3650 },
  { date: 'Feb 12', ads: 1300, subscriptions: 920, sponsorships: 650, merchandise: 280, total: 3150 },
  { date: 'Feb 19', ads: 1150, subscriptions: 870, sponsorships: 400, merchandise: 200, total: 2620 },
  { date: 'Feb 26', ads: 1450, subscriptions: 980, sponsorships: 750, merchandise: 320, total: 3500 },
  { date: 'Mar 5', ads: 1380, subscriptions: 950, sponsorships: 680, merchandise: 290, total: 3300 },
  { date: 'Mar 12', ads: 1520, subscriptions: 1020, sponsorships: 820, merchandise: 380, total: 3740 },
  { date: 'Mar 19', ads: 1280, subscriptions: 900, sponsorships: 600, merchandise: 260, total: 3040 },
];

const revenueSources = [
  { name: 'Ad Revenue', key: 'ads', color: 'text-blue-400', total: revenueData.reduce((sum, d) => sum + d.ads, 0) },
  { name: 'Subscriptions', key: 'subscriptions', color: 'text-green-400', total: revenueData.reduce((sum, d) => sum + d.subscriptions, 0) },
  { name: 'Sponsorships', key: 'sponsorships', color: 'text-purple-400', total: revenueData.reduce((sum, d) => sum + d.sponsorships, 0) },
  { name: 'Merchandise', key: 'merchandise', color: 'text-orange-400', total: revenueData.reduce((sum, d) => sum + d.merchandise, 0) },
];

export function RevenueTracker() {
  const grandTotal = revenueData.reduce((sum, d) => sum + d.total, 0);
  const avgDaily = Math.round(grandTotal / revenueData.length);

  return (
    <Card className="analytics-panel h-full">
      <CardHeader className="analytics-panel-header">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Revenue Tracker
        </CardTitle>
      </CardHeader>
      <CardContent className="analytics-panel-content">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Card className="bg-card border-border p-4 text-center">
            <DollarSign className="h-8 w-8 mx-auto text-yellow-400 mb-2" />
            <div className="text-2xl font-bold text-foreground">${grandTotal.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Total Revenue</div>
          </Card>
          <Card className="bg-card border-border p-4 text-center">
            <TrendingUp className="h-8 w-8 mx-auto text-green-400 mb-2" />
            <div className="text-2xl font-bold text-foreground">${avgDaily.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Avg Daily</div>
          </Card>
          <Card className="bg-card border-border p-4 text-center">
            <CreditCard className="h-8 w-8 mx-auto text-blue-400 mb-2" />
            <div className="text-2xl font-bold text-foreground">${revenueSources[0].total.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Ad Revenue</div>
          </Card>
          <Card className="bg-card border-border p-4 text-center">
            <Coins className="h-8 w-8 mx-auto text-purple-400 mb-2" />
            <div className="text-2xl font-bold text-foreground">${revenueSources[1].total.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Subscriptions</div>
          </Card>
          <Card className="bg-card border-border p-4 text-center">
            <BarChart3 className="h-8 w-8 mx-auto text-orange-400 mb-2" />
            <div className="text-2xl font-bold text-foreground">${revenueSources[2].total.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Sponsorships</div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Revenue by Source</h4>
            <div className="space-y-3">
              {revenueSources.map((source) => (
                <div key={source.key} className="flex items-center gap-3">
                  <span className={`w-3 h-3 rounded ${source.color}`}></span>
                  <span className="text-sm text-foreground flex-1">{source.name}</span>
                  <span className="text-sm font-semibold text-foreground">${source.total.toLocaleString()}</span>
                  <div className="w-32 h-2 bg-muted rounded overflow-hidden">
                    <div 
                      className="h-full bg-primary rounded" 
                      style={{ width: `${(source.total / grandTotal) * 100}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Daily Revenue Trend</h4>
            <ScrollArea className="h-[250px]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 px-2">Date</th>
                    <th className="pb-2 px-2 text-right">Ads</th>
                    <th className="pb-2 px-2 text-right">Subs</th>
                    <th className="pb-2 px-2 text-right">Sponsor</th>
                    <th className="pb-2 px-2 text-right">Merch</th>
                    <th className="pb-2 px-2 text-right font-bold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueData.map((row, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 px-2 text-foreground">{row.date}</td>
                      <td className="py-2 px-2 text-right text-blue-400">${row.ads.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right text-green-400">${row.subscriptions.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right text-purple-400">${row.sponsorships.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right text-orange-400">${row.merchandise.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right font-bold text-foreground">${row.total.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}