"use client";
import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@wideo11/ui/card';
import { Button, buttonVariants } from '@wideo11/ui/button';
import { Badge } from '@wideo11/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@wideo11/ui/tooltip';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@wideo11/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@wideo11/ui/dropdown-menu';
import { Input } from '@wideo11/ui/input';
import { Label } from '@wideo11/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@wideo11/ui/select';
import { Switch } from '@wideo11/ui/switch';
import { Skeleton } from '@wideo11/ui/skeleton';
import { Separator } from '@wideo11/ui/separator';
import { ScrollArea } from '@wideo11/ui/scroll-area';
import { 
  BarChart3, 
  Activity, 
  PieChart, 
  Table as TableIcon, 
  BarChart,
  Layers, 
  Settings, 
  Trash2, 
  Copy, 
  Maximize2,
  Minimize2,
  AlertCircle,
  CheckCircle2,
  XCircle
} from 'lucide-react';

interface GridItem {
  id: string;
  type: string;
  title: string;
  data?: unknown;
  isLoading?: boolean;
  gridPos: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

interface DashboardProps {
  dashboard: {
    id: string;
    title: string;
    panels: GridItem[];
    timeRange: string;
    refreshInterval: string;
  };
  onUpdate: (dashboard: any) => void;
}

const panelTypes = [
  { type: 'stat', name: 'Stat', icon: BarChart3 },
  { type: 'timeseries', name: 'Time Series', icon: Activity },
  { type: 'table', name: 'Table', icon: TableIcon },
  { type: 'bar', name: 'Bar Gauge', icon: BarChart },
  { type: 'pie', name: 'Pie Chart', icon: PieChart },
  { type: 'logs', name: 'Logs', icon: AlertCircle },
  { type: 'alerts', name: 'Alert List', icon: CheckCircle2 },
];

export default function DashboardEditor({ dashboard, onUpdate }: DashboardProps) {
  const [panels, setPanels] = useState<GridItem[]>(dashboard.panels || []);
  const [draggedItem, setDraggedItem] = useState<GridItem | null>(null);
  const [selectedPanel, setSelectedPanel] = useState<GridItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onUpdate({
      ...dashboard,
      panels,
    });
  }, [panels]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    
    if (draggedItem) {
      const rect = gridRef.current?.getBoundingClientRect();
      if (rect) {
        const x = Math.floor((e.clientX - rect.left) / 40);
        const y = Math.floor((e.clientY - rect.top) / 40);
        const newPanel = {
          ...draggedItem,
          id: `panel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          gridPos: { x, y, w: Math.max(2, Math.floor(Math.random() * 4) + 2), h: 4 },
        };
        setPanels(prev => [...prev, newPanel]);
      }
    }
    
    setDraggedItem(null);
  }, [draggedItem]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleRemovePanel = (id: string) => {
    setPanels(prev => prev.filter(p => p.id !== id));
  };

  const handleDuplicatePanel = (panel: GridItem) => {
    const newPanel = {
      ...panel,
      id: `panel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      gridPos: { ...panel.gridPos, x: panel.gridPos.x + 1, y: panel.gridPos.y + 1 },
    };
    setPanels(prev => [...prev, newPanel]);
  };

  const handlePanelDrop = (fromIndex: number, toIndex: number) => {
    const newPanels = [...panels];
    const [moved] = newPanels.splice(fromIndex, 1);
    newPanels.splice(toIndex, 0, moved);
    setPanels(newPanels);
  };

  const renderPanelContent = (panel: GridItem) => {
    if (panel.isLoading) {
      return <Skeleton className="h-full w-full bg-gray-700/50" />;
    }

    switch (panel.type) {
      case 'timeseries':
        return (
          <div className="h-full w-full flex items-end justify-between gap-0.5 p-2">
            {Array.from({ length: 20 }).map((_, i) => (
              <div 
                key={i} 
                className="w-1 bg-blue-400/60 hover:bg-blue-400 rounded-t transition-all"
                style={{ 
                  height: `${Math.random() * 80 + 20}%`,
                  minHeight: '2px'
                }}
              />
            ))}
          </div>
        );
      case 'stat':
        return (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="text-3xl font-bold text-white">
              {(panel.data as any)?.value || Math.floor(Math.random() * 10000)}
            </div>
            <p className="text-sm text-gray-400 mt-1">
              {(panel.data as any)?.label || panel.title}
            </p>
            <Badge className="mt-2 bg-blue-500/20 text-blue-400-500/30">
              +{(Math.random() * 20).toFixed(1)}%
            </Badge>
          </div>
        );
      case 'table':
        return (
          <ScrollArea className="h-full">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left p-2 text-gray-400">Name</th>
                  <th className="text-right p-2 text-gray-400">Value</th>
                  <th className="text-right p-2 text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t-800">
                    <td className="p-2 text-gray-300">item-{i + 1}</td>
                    <td className="text-right p-2 text-gray-400">{Math.floor(Math.random() * 1000)}</td>
                    <td className="text-right p-2">
                      <Badge variant={i % 3 === 0 ? 'default' : i % 3 === 1 ? 'secondary' : 'destructive'}>
                        {i % 3 === 0 ? 'OK' : i % 3 === 1 ? 'WARN' : 'ERROR'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        );
      case 'bar':
        return (
          <div className="h-full flex items-end justify-around gap-2 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center flex-1">
                <div 
                  className="w-full bg-blue-500/80 rounded-t transition-all hover:bg-blue-400"
                  style={{ height: `${Math.random() * 80 + 20}%`, maxHeight: '100%' }}
                />
                <span className="text-xs text-gray-500 mt-1">item-{i + 1}</span>
              </div>
            ))}
          </div>
        );
      case 'pie':
        return (
          <div className="h-full flex items-center justify-center">
            <svg width="120" height="120" viewBox="0 0 100 100">
              {Array.from({ length: 4 }).map((_, i) => {
                const startAngle = (i / 4) * 360;
                const endAngle = ((i + 1) / 4) * 360;
                const x1 = 50 + 40 * Math.cos((startAngle - 90) * Math.PI / 180);
                const y1 = 50 + 40 * Math.sin((startAngle - 90) * Math.PI / 180);
                const x2 = 50 + 40 * Math.cos((endAngle - 90) * Math.PI / 180);
                const y2 = 50 + 40 * Math.sin((endAngle - 90) * Math.PI / 180);
                const largeArc = 1;
                const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
                return (
                  <path 
                    key={i}
                    d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`}
                    fill={colors[i]}
                  />
                );
              })}
            </svg>
          </div>
        );
      case 'logs':
        return (
          <ScrollArea className="h-full font-mono text-xs">
            <div className="space-y-1 p-2">
              {Array.from({ length: 8 }).map((_, i) => {
                const levels = ['info', 'warn', 'error'] as const;
                const level = levels[i % 3];
                const colors = {
                  info: 'text-blue-400',
                  warn: 'text-yellow-400',
                  error: 'text-red-400'
                };
                return (
                  <div key={i} className={`flex items-center space-x-2 ${colors[level]}`}>
                    <span className="text-gray-500">
                      {new Date(Date.now() - (i * 1000 * 30)).toISOString().slice(11, 19)}
                    </span>
                    <Badge variant="outline" className={`text-xs ${colors[level]}-${colors[level].split('-')[1]}-400`}>
                      {level.toUpperCase()}
                    </Badge>
                    <span className="text-gray-300">
                      Log message #{i + 1} - {level} condition detected
                    </span>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        );
      case 'alerts':
        return (
          <ScrollArea className="h-full">
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="border-500/20 bg-red-500/5 rounded p-2">
                  <div className="flex items-center space-x-2">
                    <XCircle className="h-2.5 w-2.5 text-red-400" />
                    <span className="font-medium text-red-300">
                      {['HighMemoryUsage', 'APIHighLatency', 'DiskSpaceLow'][i]}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1 ml-6">
                    Alert condition has been firing for {(i + 1) * 2} minutes
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>
        );
      default:
        return (
          <div className="h-full flex items-center justify-center text-gray-500">
            <p>Unknown panel type: {panel.type}</p>
          </div>
        );
    }
  };

  return (
    <div 
      className="h-full p-4"
      ref={gridRef}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {panels.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <Layers className="h-12 w-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">
              Drag panel types from the sidebar to this area to add them to your dashboard
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(12,minmax(100px,1fr))] gap-2 auto-rows-[180px]">
          {panels.map((panel, index) => (
            <div
              key={panel.id}
              className="col-span-3 bg-[hsl(223_47%_11.2%)]-[hsl(217.2_32.6%_17.5%)] rounded-md shadow-lg cursor-move hover:shadow-xl transition-shadow"
              draggable
              onDragStart={(e) => {
                setDraggedItem(panel);
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-200 flex items-center justify-between">
                  {panel.title}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-50 hover:opacity-100">
                        <Settings className="h-2.5 w-2.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-[hsl(223_47%_11.2%)]-[hsl(217.2_32.6%_17.5%)]">
                      <DropdownMenuItem onClick={() => handleDuplicatePanel(panel)}>
                        <Copy className="h-2.5 w-2.5 mr-2" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        setSelectedPanel(panel);
                        setEditorOpen(true);
                      }}>
                        <Settings className="h-2.5 w-2.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-[hsl(217.2_32.6%_17.5%)]" />
                      <DropdownMenuItem 
                        onClick={() => handleRemovePanel(panel.id)}
                        className="text-red-400 focus:text-red-400"
                      >
                        <Trash2 className="h-2.5 w-2.5 mr-2" /> Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[calc(100%-48px)] pt-0">
                {renderPanelContent(panel)}
              </CardContent>
            </div>
          ))}
        </div>
      )}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="bg-[hsl(223_47%_11.2%)]-[hsl(217.2_32.6%_17.5%)] text-gray-100 max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Panel</DialogTitle>
            <DialogDescription>Update panel settings and configuration</DialogDescription>
          </DialogHeader>
          {selectedPanel && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="panel-title">Title</Label>
                <Input
                  id="panel-title"
                  defaultValue={selectedPanel.title}
                  className="bg-gray-800-700 text-white mt-1"
                />
              </div>
              <div>
                <Label htmlFor="panel-type">Visualization Type</Label>
                <Select defaultValue={selectedPanel.type}>
                  <SelectTrigger className="bg-gray-800-700 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[hsl(223_47%_11.2%)]-[hsl(217.2_32.6%_17.5%)]">
                    {panelTypes.map(pt => (
                      <SelectItem key={pt.type} value={pt.type}>{pt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="panel-transparent">Transparent Panel</Label>
                <Switch id="panel-transparent" />
              </div>
            </div>
          )}
          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => {
              setEditorOpen(false);
            }}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
