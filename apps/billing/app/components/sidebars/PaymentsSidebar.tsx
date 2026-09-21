'use client';

import { Card, CardHeader, CardTitle, CardContent, Badge, cn } from '@wideo11/ui';
import { DollarSign, CreditCard, CheckCircle, AlertCircle, ArrowUp, ArrowDown, Repeat, Loader2, Plus } from 'lucide-react';

export default function PaymentsSidebar() {
  const paymentStats = [
    { label: 'Total Processed', value: '$1,234,567', icon: DollarSign },
    { label: 'This Month', value: '$89,432', icon: ArrowUp, trend: 'up' },
    { label: 'Success Rate', value: '98.7%', icon: CheckCircle, trend: 'up' },
    { label: 'Refunds', value: '$2,340', icon: Repeat, trend: 'down' },
  ];

  const recentPayments = [
    { id: 'PAY-20260122-001', customer: 'Acme Corporation', amount: '$1,200.00', method: 'Credit Card', status: 'completed', time: '5 min ago' },
    { id: 'PAY-20260122-002', customer: 'TechStart Inc', amount: '$297.00', method: 'Bank Transfer', status: 'completed', time: '12 min ago' },
    { id: 'PAY-20260122-003', customer: 'Global Solutions', amount: '$2,499.00', method: 'Credit Card', status: 'pending', time: '25 min ago' },
    { id: 'PAY-20260122-004', customer: 'DataFlow Labs', amount: '$99.00', method: 'PayPal', status: 'failed', time: '1 hour ago' },
    { id: 'PAY-20260122-005', customer: 'CloudNine Systems', amount: '$29.00', method: 'Credit Card', status: 'refunded', time: '3 hours ago' },
  ];

  const paymentMethods = [
    { name: 'Stripe', processed: 1567, amount: '$892,340', success: '99.2%' },
    { name: 'PayPal', processed: 423, amount: '$187,450', success: '97.8%' },
    { name: 'Bank Transfer', processed: 189, amount: '$154,777', success: '98.5%' },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Payments</h2>
        <button className="btn btn-primary btn-sm">
          <Plus className="h-4 w-4 mr-1" />
          Record
        </button>
      </div>

      <div className="grid gap-3 grid-cols-2">
        {paymentStats.map((stat) => (
          <Card key={stat.label} className="bg-card border-border">
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

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base">Payment Providers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {paymentMethods.map((provider) => (
            <div key={provider.name} className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                    <DollarSign className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{provider.name}</p>
                    <p className="text-xs text-muted-foreground">{provider.processed} transactions</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{provider.amount}</p>
                  <p className="text-xs text-green-500">{provider.success} success</p>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base">Recent Payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentPayments.map((payment) => (
            <div key={payment.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono text-primary">{payment.id}</p>
                <p className="text-xs text-muted-foreground truncate">{payment.customer} • {payment.method}</p>
              </div>
              <div className="flex items-center space-x-3 ml-4">
                <span className="text-sm font-mono font-medium">{payment.amount}</span>
                <Badge
                  variant={
                    payment.status === 'completed' ? 'default' :
                    payment.status === 'pending' ? 'secondary' :
                    payment.status === 'failed' ? 'destructive' : 'outline'
                  }
                  className="text-xs"
                >
                  {payment.status}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
