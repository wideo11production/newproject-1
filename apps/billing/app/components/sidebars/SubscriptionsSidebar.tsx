'use client';

import { Card, CardHeader, CardTitle, CardContent, Badge, cn } from '@wideo11/ui';
import { Plus, Search, Filter, ChevronDown, CreditCard, Users, Calendar, AlertCircle } from 'lucide-react';

export default function SubscriptionsSidebar() {
  const subscriptionStats = [
    { label: 'Total Active', value: '2,847', icon: Users },
    { label: 'New This Month', value: '156', icon: Plus, trend: 'up' },
    { label: 'Cancelled', value: '23', icon: AlertCircle, trend: 'down' },
    { label: 'On Trial', value: '89', icon: Calendar },
  ];

  const plans = [
    { name: 'Starter', price: '$29/mo', subscribers: 1247, features: ['5 projects', '10GB storage', 'Basic support'] },
    { name: 'Pro', price: '$99/mo', subscribers: 983, features: ['Unlimited projects', '100GB storage', 'Priority support', 'API access'] },
    { name: 'Enterprise', price: '$499/mo', subscribers: 217, features: ['Everything in Pro', 'Unlimited storage', 'Dedicated support', 'SLA', 'Custom integrations'] },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Subscriptions</h2>
        <button className="btn btn-primary btn-sm">
          <Plus className="h-2.5 w-2.5 mr-1" />
          New
        </button>
      </div>

      <div className="grid gap-3 grid-cols-2">
        {subscriptionStats.map((stat) => (
          <Card key={stat.label} className="bg-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-lg font-bold">{stat.value}</p>
                </div>
                <stat.icon className="h-6 w-6 text-primary" />
              </div>
              {stat.trend && (
                <p className="text-xs mt-1">
                  <span className={cn('font-medium', stat.trend === 'up' ? 'text-green-500' : 'text-red-500')}>
                    {stat.trend === 'up' ? '↑' : '↓'} vs last month
                  </span>
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-base">Subscription Plans</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {plans.map((plan) => (
            <div key={plan.name} className="p-3 bg-muted/50 rounded-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{plan.name}</p>
                  <p className="text-sm text-muted-foreground">{plan.price} • {plan.subscribers.toLocaleString()} subscribers</p>
                </div>
                <Badge variant="outline">{plan.features.length} features</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-base">Expiring Soon</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                <AlertCircle className="h-2.5 w-2.5 text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-medium">TechStart Inc</p>
                <p className="text-xs text-muted-foreground">Pro Plan • Expires in 3 days</p>
              </div>
            </div>
            <Badge variant="secondary">Auto-renew</Badge>
          </div>
          <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertCircle className="h-2.5 w-2.5 text-red-500" />
              </div>
              <div>
                <p className="text-sm font-medium">DataFlow Labs</p>
                <p className="text-xs text-muted-foreground">Starter Plan • Expires in 1 day</p>
              </div>
            </div>
            <Badge variant="destructive">Trial ending</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
