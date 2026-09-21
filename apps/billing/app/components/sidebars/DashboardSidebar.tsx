'use client';

import { Card, CardHeader, CardTitle, CardContent, Badge, cn } from '@wideo11/ui';
import { DollarSign, CreditCard, Users, TrendingUp, ArrowDown, Minus } from 'lucide-react';

export default function DashboardSidebar() {
  const quickStats = [
    { label: 'MRR', value: '$89,432', change: '+5.2%', icon: DollarSign, trend: 'up' },
    { label: 'ARR', value: '$1,073,184', change: '+5.2%', icon: DollarSign, trend: 'up' },
    { label: 'Avg Revenue/User', value: '$31.42', change: '+1.8%', icon: Users, trend: 'up' },
    { label: 'Churn Rate', value: '2.1%', change: '-0.3%', icon: ArrowDown, trend: 'down' },
  ];

  const topCustomers = [
    { name: 'Acme Corporation', plan: 'Enterprise', mrr: '$2,499', status: 'active' },
    { name: 'TechStart Inc', plan: 'Pro', mrr: '$297', status: 'active' },
    { name: 'Global Solutions', plan: 'Enterprise', mrr: '$1,999', status: 'active' },
    { name: 'DataFlow Labs', plan: 'Pro', mrr: '$198', status: 'trial' },
    { name: 'CloudNine Systems', plan: 'Starter', mrr: '$29', status: 'active' },
  ];

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold">Key Metrics</h2>
      <div className="grid gap-3 grid-cols-2">
        {quickStats.map((stat) => (
          <Card key={stat.label} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-lg font-bold">{stat.value}</p>
                </div>
                <stat.icon className="h-6 w-6 text-primary" />
              </div>
              <p className="text-xs mt-1">
                <span className={cn('font-medium', stat.trend === 'up' ? 'text-green-500' : 'text-red-500')}>
                  {stat.trend === 'up' ? '↑' : '↓'} {stat.change}
                </span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base">Top Customers by MRR</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {topCustomers.map((customer) => (
            <div key={customer.name} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-sm font-medium">{customer.name}</p>
                <p className="text-xs text-muted-foreground">{customer.plan}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{customer.mrr}</p>
                <Badge
                  variant={
                    customer.status === 'active' ? 'default' :
                    customer.status === 'trial' ? 'secondary' : 'outline'
                  }
                  className="text-xs"
                >
                  {customer.status}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base">Payment Methods</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                <CreditCard className="h-4 w-4 text-blue-500" />
              </div>
              <span className="text-sm font-medium">Credit Card</span>
            </div>
            <span className="text-sm text-muted-foreground">65%</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-green-500" />
              </div>
              <span className="text-sm font-medium">Bank Transfer</span>
            </div>
            <span className="text-sm text-muted-foreground">25%</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                <CreditCard className="h-4 w-4 text-purple-500" />
              </div>
              <span className="text-sm font-medium">PayPal</span>
            </div>
            <span className="text-sm text-muted-foreground">10%</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
