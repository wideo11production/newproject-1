"use client"
import { useState, useEffect, Suspense, createContext, useContext } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';
import { Button } from '@wideo11/ui/button';
const Badge = ({ children, className = '' }: { children: any; className?: string; variant?: string }) => (
  <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${className}`}>
    {children}
  </span>
);
// Keep this page self-contained when the optional UI select package is not installed.
type SelectContextValue = {
  value?: string;
  onValueChange?: (value: string) => void;
};
const SelectContext = createContext<SelectContextValue>({});
const Select = ({ value, onValueChange, children }: SelectContextValue & { children: React.ReactNode }) => (
  <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
);
const SelectTrigger = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => {
  const { value, onValueChange } = useContext(SelectContext);
  return (
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)} className={`h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm ${className}`}>
      {children}
    </select>
  );
};
const SelectValue = () => null;
const SelectContent = ({ children }: { children: React.ReactNode }) => <>{children}</>;
const SelectItem = ({ value, children }: { value: string; children: React.ReactNode }) => (
  <option value={value}>{children}</option>
);
const SelectSeparator = () => null;

interface DashboardPanel {
  id: string;
  type: string;
  title: string;
  data: any;
  isLoading: boolean;
  gridPos?: { x: number; y: number; w: number; h: number };
  targets?: Array<Record<string, unknown>>;
  options?: Record<string, unknown>;
}

interface DashboardState {
  id: string;
  title: string;
  panels: DashboardPanel[];
  timeRange: string;
  refreshInterval: string;
}

import { Tooltip, TooltipTrigger, TooltipContent, Skeleton, ScrollArea, Progress, Switch, Checkbox, RadioGroup, RadioGroupItem, Separator } from '@wideo11/ui';
type ToastProps = {
  children: React.ReactNode;
  variant?: 'default' | 'destructive';
};

const ToastProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
const ToastViewport = () => null;
const Toast = ({ children, variant = 'default' }: ToastProps) => (
  <div className={`fixed bottom-4 right-4 z-50 w-80 rounded-md border p-4 shadow-lg ${variant === 'destructive' ? 'border-red-500 bg-red-950 text-red-100' : 'border-gray-700 bg-gray-900 text-gray-100'}`}>
    {children}
  </div>
);
const ToastTitle = ({ children }: { children: React.ReactNode }) => (
  <div className="font-semibold">{children}</div>
);
const ToastDescription = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-1 text-sm opacity-90">{children}</div>
);
import { LayoutGrid, Plus, Save, Share2, Settings, Bell, Activity, BarChart3, PieChart, Table as TableIcon, Maximize2, RefreshCw, Clock, Filter, Search, AlertCircle, CheckCircle, XCircle } from 'lucide-react';

type MetricCardProps = {
  title: string;
  value: React.ReactNode;
  change: number;
  icon: React.ComponentType<{ className?: string }>;
};

const MetricCard = ({ title, value, change, icon: Icon }: MetricCardProps) => (
  <Card className="bg-gray-900 border-gray-800">
    <CardHeader className="flex flex-row items-center justify-between pb-2">
      <CardTitle className="text-sm font-medium text-gray-200">{title}</CardTitle>
      <Icon className="h-4 w-4 text-gray-400" />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold text-white">{value}</div>
      <p className={`text-xs ${change > 0 ? 'text-green-400' : change < 0 ? 'text-red-400' : 'text-gray-400'}`}>
        {change > 0 ? '+' : ''}{change}% from last period
      </p>
    </CardContent>
  </Card>
);

const TimeSeriesPanel = ({
  data,
  isLoading,
}: {
  data: { value: number; timestamp?: number }[];
  isLoading: boolean;
}) => {
  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Skeleton className="h-full w-full bg-gray-700" />
      </div>
    );
  }
  
  const values = data.map(d => d.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  
  return (
    <div className="h-full w-full relative">
      <svg width="100%" height="100%" className="text-blue-400">
        <polyline
          fill="none"
          strokeWidth={2}
          className="stroke-blue-400 fill-blue-400/10"
          points={data.map((d, i) => 
            `${(i / (data.length - 1)) * 100},${100 - ((d.value - min) / range) * 100}`
          ).join(' ')}
        />
      </svg>
    </div>
  );
};

const StatPanel = ({
  data,
  isLoading,
}: {
  data: { value: number; label: string; change: number };
  isLoading: boolean;
}) => {
  if (isLoading) return <Skeleton className="h-full w-full bg-gray-700" />;
  
  return (
    <div className="h-full flex flex-col items-center justify-center text-center">
      <div className="text-4xl font-bold text-white">{data.value}</div>
      <p className="text-sm text-gray-400 mt-2">{data.label}</p>
      <Badge variant={data.change > 0 ? 'default' : 'secondary'} className="mt-2">
        {data.change > 0 ? '++' : data.change < 0 ? '--' : '='} {Math.abs(data.change)}%
      </Badge>
    </div>
  );
};

const TablePanel = ({
  data,
  isLoading,
}: {
  data: { name: string; value: number; status: string }[];
  isLoading: boolean;
}) => {
  if (isLoading) return <Skeleton className="h-full w-full bg-gray-700" />;
  
  return (
    <ScrollArea className="h-full">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left p-2 text-gray-300">Name</th>
            <th className="text-right p-2 text-gray-300">Value</th>
            <th className="text-right p-2 text-gray-300">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.map(row => (
            <tr key={row.name} className="border-t border-gray-800">
              <td className="p-2 text-gray-200">{row.name}</td>
              <td className="text-right p-2 text-gray-300">{row.value}</td>
              <td className="text-right p-2">
                <Badge variant={row.status === 'healthy' ? 'default' : 'secondary'}>
                  {row.status}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
};

const LogsPanel = ({
  data,
  isLoading,
}: {
  data: { timestamp: string; level: string; message: string }[];
  isLoading: boolean;
}) => {
  if (isLoading) return <Skeleton className="h-full w-full bg-gray-700" />;
  
  return (
    <ScrollArea className="h-full font-mono text-xs">
      <div className="space-y-1 p-2">
        {data.map((log, i) => (
          <div key={i} className={`flex items-center space-x-2 ${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : 'text-gray-300'}`}>
            <span className="text-gray-500">{log.timestamp}</span>
            <Badge variant="outline" className={`text-xs ${log.level === 'error' ? 'border-red-400 text-red-400' : log.level === 'warn' ? 'border-yellow-400 text-yellow-400' : 'border-gray-600 text-gray-400'}`}>
              {log.level}
            </Badge>
            <span>{log.message}</span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
};

const AlertListPanel = ({
  data,
  isLoading,
}: {
  data: {
    state: string;
    startsAt: string;
    labels?: { alertname?: string; alertName?: string };
    annotations?: { summary?: string; message?: string };
  }[];
  isLoading: boolean;
}) => {
  if (isLoading) return <Skeleton className="h-full w-full bg-gray-700" />;
  
  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 p-2">
        {data.map((alert, i) => (
          <div key={i} className={`flex items-start space-x-3 p-2 rounded border ${alert.state === 'firing' ? 'border-red-500/30 bg-red-500/10' : 'border-green-500/30 bg-green-500/10'}`}>
            <div className="flex-shrink-0 mt-0.5">
              {alert.state === 'firing' ? <AlertCircle className="h-5 w-5 text-red-400" /> : <CheckCircle className="h-5 w-5 text-green-400" />}
            </div>
            <div className="flex-1">
              <div className="font-medium text-white">{alert.labels?.alertname || alert.labels?.alertName || 'Alert'}</div>
              <div className="text-sm text-gray-300 mt-1">{alert.annotations?.summary || alert.annotations?.message || ''}</div>
              <div className="flex items-center mt-2 space-x-4 text-xs text-gray-400">
                <span>Status: {alert.state}</span>
                <span>Starts: {alert.startsAt}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
};

const PanelRenderer = ({ panelType, data, isLoading }: { panelType: string; data: any; isLoading: boolean }) => {
  switch (panelType) {
    case 'timeseries':
    case 'graph':
      return <TimeSeriesPanel data={data} isLoading={isLoading} />;
    case 'stat':
      return <StatPanel data={data} isLoading={isLoading} />;
    case 'table':
      return <TablePanel data={data} isLoading={isLoading} />;
    case 'logs':
      return <LogsPanel data={data} isLoading={isLoading} />;
    case 'alerts':
      return <AlertListPanel data={data} isLoading={isLoading} />;
    case 'bar':
    case 'bargauge':
      return (
        <div className="h-full flex items-end justify-around p-4">
          {Array.isArray(data) ? data.map((bar, i) => (
            <div key={i} className="flex flex-col items-center">
              <div className="w-12 bg-blue-500 rounded-t" style={{ height: `${(bar.value / 100) * 100}%` }}></div>
              <span className="text-xs text-gray-400 mt-1">{bar.name}</span>
            </div>
          )) : <Skeleton className="h-full w-full bg-gray-700" />}
        </div>
      );
    case 'pie':
    case 'piechart':
      return (
        <div className="h-full flex items-center justify-center">
          {Array.isArray(data) ? (
            <svg width="200" height="200" viewBox="0 0 100 100">
              {data.reduce((acc, slice, i) => {
                const total = data.reduce((sum, s) => sum + s.value, 0);
                const startAngle = (acc.angle / total) * 360;
                const endAngle = ((acc.angle + slice.value) / total) * 360;
                const x1 = 50 + 40 * Math.cos((startAngle - 90) * Math.PI / 180);
                const y1 = 50 + 40 * Math.sin((startAngle - 90) * Math.PI / 180);
                const x2 = 50 + 40 * Math.cos((endAngle - 90) * Math.PI / 180);
                const y2 = 50 + 40 * Math.sin((endAngle - 90) * Math.PI / 180);
                const largeArc = endAngle - startAngle > 180 ? 1 : 0;
                return {
                  angle: acc.angle + slice.value,
                  paths: [...acc.paths, (
                    <path key={i} d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`} fill={slice.color || '#3b82f6'} />
                  )]
                };
              }, { angle: 0, paths: [] }).paths}
            </svg>
          ) : <Skeleton className="h-full w-full bg-gray-700" />}
        </div>
      );
    default:
      return (
        <div className="h-full flex items-center justify-center text-gray-400">
          <p>Unknown panel type: {panelType}</p>
        </div>
      );
  }
};

const DraggablePanel = ({ panel, onRemove, onEdit, style }: {
  panel: any;
  onRemove: (id: any) => void;
  onEdit: (panel: any) => void;
  style?: CSSProperties;
}) => {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <Card
      style={style}
      className={`bg-gray-900 border-gray-700 mb-4 cursor-move transition-transform ${isDragging ? 'opacity-50 shadow-xl' : 'shadow-lg'}`}
      draggable
      onDragStart={(e) => {
        setIsDragging(true);
        e.dataTransfer.setData('application/json', JSON.stringify(panel));
      }}
      onDragEnd={() => setIsDragging(false)}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-200">
          {panel.title}
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-gray-400 hover:text-white"
            onClick={() => onEdit(panel)}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Settings className="h-4 w-4 mr-1" /> Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-red-400 hover:text-red-300"
            onClick={() => onRemove(panel.id)}
            onPointerDown={(e) => e.stopPropagation()}
          >
            Remove
          </Button>
        </div>
      </CardHeader>
      <CardContent className="h-[200px]">
        <Suspense fallback={<Skeleton className="h-full w-full bg-gray-700" />}>
          <PanelRenderer 
            panelType={panel.type} 
            data={panel.data || []} 
            isLoading={panel.isLoading || false} 
          />
        </Suspense>
      </CardContent>
    </Card>
  );
};

const DashboardEditor = ({ dashboard, onSave, onUpdate }: {
  dashboard?: any;
  onSave: (dashboard: any) => void;
  onUpdate?: (...args: any[]) => void;
}) => {
  const [panels, setPanels] = useState(dashboard?.panels || []);
  const [timeRange, setTimeRange] = useState('last_1h');
  const [refreshInterval, setRefreshInterval] = useState('5s');
  const [selectedPanel, setSelectedPanel] = useState(null);
  const [showEditor, setShowEditor] = useState(false);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const panelData = JSON.parse(e.dataTransfer.getData('application/json'));
    const newPanel = {
      ...panelData,
      id: `panel-${Date.now()}`,
      title: panelData.title || `New ${panelData.type} Panel`,
    };
    setPanels([...panels, newPanel]);
  };

  const handleRemove = (id: string) => {
    setPanels(panels.filter((p: any) => p.id !== id));
  };

  const handleEdit = (panel: any) => {
    setSelectedPanel(panel);
    setShowEditor(true);
  };

  const handleSave = () => {
    const updatedDashboard = {
      ...dashboard,
      panels,
      timeRange,
      refreshInterval,
      updatedAt: new Date().toISOString()
    };
    onSave(updatedDashboard);
  };

  const panelTypes = [
    { type: 'stat', name: 'Stat', icon: BarChart3 },
    { type: 'timeseries', name: 'Time Series', icon: Activity },
    { type: 'table', name: 'Table', icon: TableIcon },
    { type: 'pie', name: 'Pie Chart', icon: PieChart },
    { type: 'bar', name: 'Bar Gauge', icon: BarChart3 },
    { type: 'logs', name: 'Logs', icon: AlertCircle },
    { type: 'alerts', name: 'Alert List', icon: Bell },
  ];

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 border-r border-gray-800 p-4 overflow-y-auto">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold mb-2 text-gray-200">Dashboard</h2>
            <Button 
              variant="outline"
              className="w-full border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
              onClick={handleSave}
            >
              <Save className="h-4 w-4 mr-2" /> Save
            </Button>
          </div>
          
          <div>
            <h3 className="text-sm font-medium mb-2 text-gray-400">Panel Types</h3>
            <div className="grid grid-cols-1 gap-2">
              {panelTypes.map(panelType => {
                const Icon = panelType.icon;
                return (
                  <div 
                    key={panelType.type}
                    className="bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg p-3 cursor-grab active:cursor-grabbing"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/json', JSON.stringify({
                        type: panelType.type,
                        title: panelType.name,
                        data: [],
                        isLoading: false
                      }));
                    }}
                  >
                    <div className="flex items-center space-x-2">
                      <Icon className="h-4 w-4 text-blue-400" />
                      <span className="text-sm text-gray-200">{panelType.name}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2 text-gray-400">Time Range</h3>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="bg-gray-800 border-gray-700 text-gray-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <div className="bg-gray-800 border-gray-700">
                  <SelectItem value="last_5m">Last 5 minutes</SelectItem>
                  <SelectItem value="last_15m">Last 15 minutes</SelectItem>
                  <SelectItem value="last_1h">Last 1 hour</SelectItem>
                  <SelectItem value="last_6h">Last 6 hours</SelectItem>
                  <SelectItem value="last_24h">Last 24 hours</SelectItem>
                  <SelectItem value="last_7d">Last 7 days</SelectItem>
                  <SelectItem value="last_30d">Last 30 days</SelectItem>
                </div>
              </SelectContent>
            </Select>
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2 text-gray-400">Refresh</h3>
            <Select value={refreshInterval} onValueChange={setRefreshInterval}>
              <SelectTrigger className="bg-gray-800 border-gray-700 text-gray-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <div className="bg-gray-800 border-gray-700">
                  <SelectItem value="5s">5s</SelectItem>
                  <SelectItem value="10s">10s</SelectItem>
                  <SelectItem value="30s">30s</SelectItem>
                  <SelectItem value="1m">1 minute</SelectItem>
                  <SelectItem value="5m">5 minutes</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </div>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div 
        className="flex-1 overflow-auto p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {panels.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <LayoutGrid className="h-12 w-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">Drag panels from the sidebar to add them to the dashboard</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-max">
            {panels.map((panel: any, index: number) => (
              <div key={panel.id} className="col-span-1">
                <DraggablePanel 
                  panel={panel} 
                  onRemove={handleRemove}
                  onEdit={handleEdit}
                  style={{ order: index }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const DashboardHeader = ({ dashboard, onSave, onShare, onDelete }: {
  dashboard?: { title?: string; panels?: unknown[] };
  onSave?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
}) => {
  return (
    <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <input 
          defaultValue={dashboard?.title || 'Untitled Dashboard'} 
          className="text-xl font-bold bg-transparent border-none focus:ring-0 text-white placeholder-gray-500"
        />
        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
          {dashboard?.panels?.length || 0} panels
        </Badge>
      </div>
      <div className="flex items-center space-x-2">
        <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white hover:bg-gray-800">
          <RefreshCw className="h-4 w-4 mr-1" /> Auto-refresh
        </Button>
        <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white hover:bg-gray-800">
          <Share2 className="h-4 w-4 mr-1" /> Share
        </Button>
        <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white hover:bg-gray-800">
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

const Monitor = () => {
  const [dashboard, setDashboard] = useState<DashboardState>({
    id: 'default',
    title: 'System Overview',
    panels: [
      {
        id: 'panel-1',
        type: 'stat',
        title: 'Total Requests',
        data: { value: 12543, label: 'requests/sec', change: 12.5 },
        isLoading: false
      },
      {
        id: 'panel-2',
        type: 'timeseries',
        title: 'CPU Usage',
        data: Array.from({ length: 30 }, (_, i) => ({ value: 50 + Math.sin(i / 3) * 20, timestamp: Date.now() - (29 - i) * 1000 })),
        isLoading: false
      },
      {
        id: 'panel-3',
        type: 'stat',
        title: 'Active Users',
        data: { value: 342, label: 'users', change: -2.1 },
        isLoading: false
      },
      {
        id: 'panel-4',
        type: 'alerts',
        title: 'Active Alerts',
        data: [
          { state: 'firing', labels: { alertname: 'HighMemoryUsage' }, annotations: { summary: 'Memory usage > 90%' }, startsAt: '2026-09-20T10:30:00Z' },
          { state: 'resolved', labels: { alertname: 'APIHighLatency' }, annotations: { summary: 'API latency > 1s' }, startsAt: '2026-09-20T09:15:00Z' },
        ],
        isLoading: false
      },
    ],
    timeRange: 'last_1h',
    refreshInterval: '5s'
  });

  const [toasts, setToasts] = useState<Array<{ id: number; title: string; description: string; variant: 'default' | 'destructive' }>>([]);

  const showToast = (title: string, description: string, variant: 'default' | 'destructive' = 'default') => {
    const id = Date.now();
    setToasts([...toasts, { id, title, description, variant }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const handleSave = async (updatedDashboard: any) => {
    setDashboard(updatedDashboard);
    try {
      const response = await fetch('/api/dashboards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedDashboard)
      });
      if (response.ok) {
        showToast('Success', 'Dashboard saved successfully', 'default');
      } else {
        showToast('Error', 'Failed to save dashboard', 'destructive');
      }
    } catch (error) {
      showToast('Error', 'Network error saving dashboard', 'destructive');
    }
  };

  const handleShare = () => {
    navigator.clipboard.writeText(`${window.location.origin}/dashboard/${dashboard.id}`);
    showToast('Success', 'Dashboard link copied to clipboard');
  };

  const handleDelete = () => {
    showToast('Info', 'Dashboard deleted', 'default');
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setDashboard(prev => {
        const updatedPanels = prev.panels.map(panel => ({
          ...panel,
          data: Array.isArray(panel.data)
            ? panel.data.map(d => ({ ...d, value: d.value + Math.random() * 5 - 2.5 }))
            : panel.data
        }));
        return { ...prev, panels: updatedPanels };
      });
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <ToastProvider>
      <div className="h-screen flex flex-col bg-gray-950">
        <DashboardHeader 
          dashboard={dashboard} 
          onSave={() => handleSave(dashboard)}
          onShare={handleShare}
          onDelete={handleDelete}
        />
        <main className="flex-1 overflow-hidden">
          <DashboardEditor
            dashboard={dashboard}
            onSave={handleSave}
            onUpdate={setDashboard}
          />
        </main>
        <ToastViewport />
        {toasts.map(toast => (
          <Toast key={toast.id} variant={toast.variant === 'destructive' ? 'destructive' : 'default'}>
            <ToastTitle>{toast.title}</ToastTitle>
            <ToastDescription>{toast.description}</ToastDescription>
          </Toast>
        ))}
      </div>
    </ToastProvider>
  );
};

export default Monitor;
