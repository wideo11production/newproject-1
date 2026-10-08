"use client";
import { useState, useRef, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@wideo11/ui/card';
import { Button, buttonVariants } from '@wideo11/ui/button';
import { Badge } from '@wideo11/ui/badge';
import { Skeleton } from '@wideo11/ui';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@wideo11/ui/tooltip';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@wideo11/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@wideo11/ui/dropdown-menu';
import { Input } from '@wideo11/ui/input';
import { Label } from '@wideo11/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@wideo11/ui/select';
import { Switch } from '@wideo11/ui/switch';
import { ScrollArea } from '@wideo11/ui';
import { Separator } from '@wideo11/ui/separator';
import { 
  BarChart3, 
  Activity, 
  PieChart, 
  Table as TableIcon, 
  Layers, 
  Settings, 
  Trash2, 
  Copy,
  Maximize2,
  Grid,
  LayoutGrid,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';

interface DashboardEditorProps {
  dashboard: {
    id: string;
    title: string;
    panels: Panel[];
    timeRange: string;
    refreshInterval: string;
  };
  onSave: (dashboard: any) => void;
  onUpdate: (dashboard: any) => void;
}

interface Panel {
  id: string;
  type: string;
  title: string;
  gridPos: { x: number; y: number; w: number; h: number };
  targets?: Array<Record<string, unknown>>;
  options?: Record<string, unknown>;
  data?: unknown;
  isLoading?: boolean;
}

interface PanelType {
  type: string;
  name: string;
  icon: React.ElementType;
}

const panelTypes: PanelType[] = [
  { type: 'stat', name: 'Stat', icon: BarChart3 },
  { type: 'timeseries', name: 'Time Series', icon: Activity },
  { type: 'table', name: 'Table', icon: TableIcon },
  { type: 'bar', name: 'Bar Gauge', icon: BarChart3 },
  { type: 'pie', name: 'Pie Chart', icon: PieChart },
  { type: 'logs', name: 'Logs', icon: Layers },
  { type: 'alerts', name: 'Alert List', icon: Layers },
];

export default function DashboardEditor({ dashboard, onSave, onUpdate }: DashboardEditorProps) {
  const [panels, setPanels] = useState<Panel[]>(dashboard?.panels || []);
  const [draggedPanel, setDraggedPanel] = useState<PanelType | null>(null);
  const [selectedPanel, setSelectedPanel] = useState<Panel | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [showPanelPicker, setShowPanelPicker] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();

    const rect = gridRef.current?.getBoundingClientRect();
    if (rect && draggedPanel) {
      const x = Math.floor((e.clientX - rect.left) / 120);
      const y = Math.floor((e.clientY - rect.top) / 180);
      
      const newPanel: Panel = {
        id: `panel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: draggedPanel.type,
        title: `New ${draggedPanel.name} Panel`,
        gridPos: { x, y, w: Math.max(2, Math.floor(Math.random() * 3) + 2), h: 4 },
        options: {},
        data: [],
        isLoading: false,
      };

      setPanels(prev => [...prev, newPanel]);
    }

    setDraggedPanel(null);
  }, [draggedPanel]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleRemovePanel = (id: string) => {
    setPanels(prev => prev.filter(p => p.id !== id));
  };

  const handleEditPanel = (panel: Panel) => {
    setSelectedPanel(panel);
    setEditorOpen(true);
  };

  const handleSave = () => {
    onSave({
      ...dashboard,
      panels,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    // ---- TooltipProvider (REQUIRED) ----
    // Radix ka `<Tooltip>` bina apne `<TooltipProvider>` ancestor ke THROW
    // karta hai: "Tooltip must be used within TooltipProvider".
    //
    // Ye error tab aaya jab ye editor dashboard page pe render hua - kyunki
    // app root layout me koi TooltipProvider nahi tha (poore app me wo
    // component kabhi use hi nahi hua tha - yahan pehli baar use hua).
    //
    // FIX: poore editor ko TooltipProvider se wrap kar diya. Isse har Tooltip
    // ko context mil jaata hai.
    //
    // NOTE: Radix `delayDuration` 200ms rakha hai taaki hover karte hi tooltip
    // na phate - sirf deliberate hover pe dikhe. Ye UX polish hai.
    <TooltipProvider delayDuration={200}>
    <div className="h-full flex">
      {/* Panel Picker Sidebar (draggable from) */}
      <div className="w-64-800 p-4 overflow-y-auto custom-scrollbar">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Panel Types</h3>
        <div className="space-y-2">
          {panelTypes.map((pt) => {
            const Icon = pt.icon;
            return (
              <Tooltip key={pt.type}>
                <TooltipTrigger asChild>
                  <div
                    className="bg-gray-900/50 border-700 rounded-md p-3 cursor-grab active:cursor-grabbing hover:border-gray-600 transition-colors"
                    draggable
                    onDragStart={() => setDraggedPanel(pt)}
                    onDragEnd={() => setDraggedPanel(null)}
                  >
                    <div className="flex items-center space-x-2">
                      <Icon className="h-2.5 w-2.5 text-blue-400" />
                      <span className="text-sm text-gray-200">{pt.name}</span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-gray-800-700">
                  <p>Drag to add {pt.name} panel</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <Separator className="my-4 bg-gray-700" />

        <div className="space-y-2 mt-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Dashboard</h3>
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full text-gray-300 hover:text-ink hover:bg-gray-800"
            onClick={handleSave}
          >
            <Layers className="h-2.5 w-2.5 mr-2" /> Save Dashboard
          </Button>
        </div>
      </div>

      {/* Main Grid Area */}
      <div 
        className="flex-1 overflow-auto p-4"
        ref={gridRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {panels.length === 0 ? (
          <div 
            className="border-2-dashed-700 rounded-md p-8 text-center h-full flex items-center justify-center"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <div>
              <LayoutGrid className="h-12 w-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">
                Drag panel types from the sidebar to add them here
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(12,_minmax(0,1fr))] gap-2 auto-rows-[180px]">
            {panels.map((panel, index) => (
              <div 
                key={panel.id} 
                className="col-span-4 bg-gray-900/50 border-700 rounded-md shadow-lg cursor-move hover:shadow-xl transition-shadow"
                style={{ order: index }}
                draggable
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
                      <DropdownMenuContent align="end" className="bg-gray-800-700">
                        <DropdownMenuItem onClick={() => handleEditPanel(panel)}>
                          <Settings className="h-2.5 w-2.5 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleRemovePanel(panel.id)} className="text-red-400">
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

        {/* Panel Editor Dialog */}
        <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
          <DialogContent className="bg-gray-800-700 text-gray-100 max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Panel</DialogTitle>
              <DialogDescription>Update panel configuration and settings</DialogDescription>
            </DialogHeader>
            {selectedPanel && (
              <div className="space-y-4 py-4">
                <div>
                  <Label htmlFor="panel-title">Title</Label>
                  <Input
                    id="panel-title"
                    defaultValue={selectedPanel.title}
                    className="bg-gray-700-600 text-ink mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="panel-type">Visualization Type</Label>
                  <Select defaultValue={selectedPanel.type}>
                    <SelectTrigger className="bg-gray-700-600 text-ink mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800-700">
                      {panelTypes.map(pt => (
                        <SelectItem key={pt.type} value={pt.type}>{pt.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="panel-transparent">Transparent Background</Label>
                  <Switch id="panel-transparent" />
                </div>
                <div>
                  <Label htmlFor="panel-query">PromQL Query</Label>
                  <Input
                    id="panel-query"
                    placeholder="sum(rate(http_requests_total[5m]))"
                    className="bg-gray-700-600 text-ink mt-1 font-mono"
                  />
                </div>
              </div>
            )}
            <div className="flex justify-end space-x-2 pt-4-700">
              <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
              <Button onClick={() => setEditorOpen(false)}>Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
    </TooltipProvider>
  );
}

function renderPanelContent(panel: Panel) {
  if (panel.isLoading) {
    return <Skeleton className="h-full w-full bg-gray-700/50" />;
  }

  switch (panel.type) {
    case 'timeseries':
      return (
        <div className="h-full w-full flex items-end justify-between gap-0.5 p-2">
          {Array.from({ length: 30 }).map((_, i) => (
            <div 
              key={i} 
              className="bg-blue-400/80 hover:bg-blue-400 rounded-t transition-all flex-1"
              style={{ height: `${Math.random() * 70 + 30}%`, minHeight: '2px' }}
            />
          ))}
        </div>
      );
    case 'stat':
      return (
        <div className="h-full flex flex-col items-center justify-center text-center">
          <div className="text-3xl font-bold text-ink">
            {Math.floor(Math.random() * 10000).toLocaleString()}
          </div>
          <p className="text-sm text-gray-400 mt-2">{panel.title}</p>
          <Badge className="mt-2 bg-blue-500/20 text-blue-400-500/30">
            +{Math.floor(Math.random() * 20)}.{Math.floor(Math.random() * 10)}%
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
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-t-800">
                  <td className="p-2 text-gray-300">endpoint-{i + 1}</td>
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
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center flex-1">
              <div 
                className="w-full bg-blue-500/80 rounded-t transition-all hover:bg-blue-400"
                style={{ height: `${Math.random() * 80 + 20}%`, maxHeight: '100%' }}
              />
              <span className="text-xs text-gray-500 mt-1">{`item-${i + 1}`}</span>
            </div>
          ))}
        </div>
      );
    case 'pie':
      return (
        <div className="h-full flex items-center justify-center">
          <svg width="100" height="100" viewBox="0 0 100 100">
            {Array.from({ length: 4 }).map((_, i) => {
              const startAngle = (i / 4) * 360;
              const endAngle = ((i + 1) / 4) * 360;
              const x1 = 50 + 35 * Math.cos((startAngle - 90) * Math.PI / 180);
              const y1 = 50 + 35 * Math.sin((startAngle - 90) * Math.PI / 180);
              const x2 = 50 + 35 * Math.cos((endAngle - 90) * Math.PI / 180);
              const y2 = 50 + 35 * Math.sin((endAngle - 90) * Math.PI / 180);
              const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
              return (
                <path 
                  key={i}
                  d={`M 50 50 L ${x1} ${y1} A 35 35 0 0 1 ${x2} ${y2} Z`}
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
              const levels = ['INFO', 'WARN', 'ERROR'];
              const level = levels[i % 3];
              const colors = {
                INFO: 'text-blue-400',
                WARN: 'text-yellow-400',
                ERROR: 'text-red-400'
              };
              return (
                <div key={i} className={`flex items-center space-x-2 ${colors[level as keyof typeof colors]}`}>
                  <span className="text-gray-500">
                    {new Date(Date.now() - (i * 1000 * 30)).toISOString().slice(11, 19)}
                  </span>
                  <Badge variant="outline" className={`text-xs ${colors[level as keyof typeof colors]}-current`}>
                    {level}
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
              <div key={i} className="flex items-start space-x-3 p-2 rounded border-500/20 bg-red-500/5">
                <AlertCircle className="h-2.5 w-2.5 text-red-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-medium text-ink">
                    {['HighMemoryUsage', 'APIHighLatency', 'DiskSpaceLow'][i % 3]}
                  </div>
                  <p className="text-sm text-gray-300 mt-1">Alert condition has been firing</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Started: 2026-09-20T10:30:00Z
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      );
    default:
      return (
        <div className="h-full flex items-center justify-center text-gray-500">
          <p>Panel type: {panel.type}</p>
        </div>
      );
  }
}
