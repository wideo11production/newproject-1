import { Card, CardContent } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

interface Alert {
  id: string;
  state: 'firing' | 'resolved';
  severity: 'critical' | 'warning' | 'info';
  labels: { alertname: string; instance: string };
  annotations: { summary: string; description?: string };
  startsAt: string;
  endsAt?: string;
}

interface AlertListProps {
  alerts: Alert[];
}

export default function AlertList({ alerts }: AlertListProps) {
  if (!alerts || alerts.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500">
        No active alerts
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <Card 
          key={alert.id} 
          className={`border ${
            alert.state === 'firing' 
              ? 'border-red-500/30 bg-red-500/5' 
              : 'border-green-500/30 bg-green-500/5'
          }`}
        >
          <CardContent className="p-3">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 mt-0.5">
                {alert.state === 'firing' ? (
                  <XCircle className="h-5 w-5 text-red-400" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-white">
                    {alert.labels?.alertname || 'Unknown Alert'}
                  </span>
                  <Badge variant={alert.severity === 'critical' ? 'destructive' : alert.severity === 'warning' ? 'default' : 'secondary'}>
                    {alert.severity}
                  </Badge>
                </div>
                {alert.annotations?.summary && (
                  <p className="text-sm text-gray-300">{alert.annotations.summary}</p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Started: {new Date(alert.startsAt).toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
