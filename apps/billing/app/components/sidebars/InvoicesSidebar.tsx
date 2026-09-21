'use client';

import { Card, CardHeader, CardTitle, CardContent, Badge, cn } from '@wideo11/ui';
import { FileText, DollarSign, AlertCircle, CheckCircle, Clock, ArrowUp, ArrowDown } from 'lucide-react';

export default function InvoicesSidebar() {
  const invoiceStats = [
    { label: 'Total Pending', value: '$45,230', icon: Clock },
    { label: 'Paid This Month', value: '$89,120', icon: CheckCircle, trend: 'up' },
    { label: 'Overdue', value: '$12,450', icon: AlertCircle, trend: 'down' },
    { label: 'This Month', value: 47, icon: FileText },
  ];

  const recentInvoices = [
    { number: 'INV-20260122-001', customer: 'Acme Corporation', amount: '$1,200.00', dueDate: '2026-02-01', status: 'pending' },
    { number: 'INV-20260121-045', customer: 'TechStart Inc', amount: '$297.00', dueDate: '2026-02-15', status: 'paid' },
    { number: 'INV-20260120-012', customer: 'Global Solutions', amount: '$2,499.00', dueDate: '2026-01-25', status: 'overdue' },
    { number: 'INV-20260119-008', customer: 'DataFlow Labs', amount: '$99.00', dueDate: '2026-02-10', status: 'pending' },
    { number: 'INV-20260118-033', customer: 'CloudNine Systems', amount: '$29.00', dueDate: '2026-01-20', status: 'paid' },
  ];

  const statusColors = {
    pending: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30',
    paid: 'bg-green-500/20 text-green-500 border-green-500/30',
    overdue: 'bg-red-500/20 text-red-500 border-red-500/30',
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Invoices</h2>
        <div className="flex items-center space-x-2">
          <button className="btn btn-outline btn-sm">
            <ArrowDown className="h-4 w-4 mr-1" />
            Export
          </button>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2">
        {invoiceStats.map((stat) => (
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
          <CardTitle className="text-base">Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentInvoices.map((invoice) => (
            <div key={invoice.number} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono text-primary">{invoice.number}</p>
                <p className="text-xs text-muted-foreground truncate">{invoice.customer}</p>
              </div>
              <div className="flex items-center space-x-3 ml-4">
                <span className="text-sm font-mono font-medium">{invoice.amount}</span>
                <Badge
                  variant="outline"
                  className={statusColors[invoice.status as keyof typeof statusColors]}
                >
                  {invoice.status}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base">Aging Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between p-2 bg-muted/50 rounded">
            <span className="text-sm">Current (0-30 days)</span>
            <span className="text-sm font-medium text-green-500">$32,100</span>
          </div>
          <div className="flex justify-between p-2 bg-muted/50 rounded">
            <span className="text-sm">31-60 days</span>
            <span className="text-sm font-medium text-yellow-500">$8,450</span>
          </div>
          <div className="flex justify-between p-2 bg-muted/50 rounded">
            <span className="text-sm">61-90 days</span>
            <span className="text-sm font-medium text-orange-500">$3,200</span>
          </div>
          <div className="flex justify-between p-2 bg-muted/50 rounded">
            <span className="text-sm">90+ days</span>
            <span className="text-sm font-medium text-red-500">$1,480</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
