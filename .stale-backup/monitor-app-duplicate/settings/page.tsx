"use client";
import { useState } from 'react';
import { Settings, Clock, RefreshCw, Link2, Edit3, Globe, Save } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@wideo11/ui/card';
import { Button } from '@wideo11/ui/button';
import { Input } from '@wideo11/ui/input';
import { Label } from '@wideo11/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@wideo11/ui/select';
import { Switch } from '@wideo11/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@wideo11/ui/tabs';
import { Badge } from '@wideo11/ui/badge';

export default function SettingsPage() {
  const [timezone, setTimezone] = useState('UTC');
  const [autoRefresh, setAutoRefresh] = useState('5s');
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [annotations, setAnnotations] = useState([
    { id: 1, name: 'Deployments', datasource: 'Prometheus', enabled: true },
    { id: 2, name: 'Manual Events', datasource: 'Internal', enabled: true },
  ]);
  const [links, setLinks] = useState([
    { id: 1, title: 'Grafana Docs', url: 'https://grafana.com/docs/' },
    { id: 2, title: 'Prometheus Docs', url: 'https://prometheus.io/docs/' },
  ]);

  const timezones = [
    { value: 'UTC', label: 'UTC' },
    { value: 'America/New_York', label: 'America/New_York' },
    { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
    { value: 'Europe/London', label: 'Europe/London' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
    { value: 'Asia/Kolkata', label: 'Asia/Kolkata' },
    { value: 'Asia/Shanghai', label: 'Asia/Shanghai' },
  ];

  const refreshIntervals = ['5s', '10s', '30s', '1m', '5m', '15m', '30m', '1h', 'Off'];

  return (
    <div className="h-[calc(100vh-73px)] overflow-auto bg-[hsl(222.2_84%_6.1%)]">
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-sm text-gray-400 mt-1">Configure dashboard behavior and system settings</p>
        </div>

        <Tabs defaultValue="general" className="w-full">
          <TabsList className="bg-gray-800/50 border-gray-700 mb-6">
            <TabsTrigger value="general" className="data-[state=active]:bg-gray-700">General</TabsTrigger>
            <TabsTrigger value="annotations" className="data-[state=active]:bg-gray-700">Annotations</TabsTrigger>
            <TabsTrigger value="links" className="data-[state=active]:bg-gray-700">Links</TabsTrigger>
            <TabsTrigger value="keyboard" className="data-[state=active]:bg-gray-700">Keyboard Shortcuts</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <div className="space-y-6">
              <Card className="bg-gray-900/50 border-gray-800">
                <CardHeader>
                  <CardTitle className="text-lg text-white flex items-center">
                    <Clock className="h-5 w-5 mr-2 text-blue-400" />
                    Time Settings
                  </CardTitle>
                  <CardDescription>Configure timezone and time range defaults</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="timezone" className="text-gray-300">Timezone</Label>
                    <Select value={timezone} onValueChange={setTimezone}>
                      <SelectTrigger className="bg-gray-800/50 border-gray-700 text-gray-300 mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-gray-800 border-gray-700">
                        {timezones.map(tz => (
                          <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="auto-refresh" className="text-gray-300">Auto-refresh</Label>
                      <p className="text-xs text-gray-500 mt-1">Automatically refresh dashboard data</p>
                    </div>
                    <Switch 
                      id="auto-refresh-enabled" 
                      checked={autoRefreshEnabled} 
                      onCheckedChange={setAutoRefreshEnabled}
                    />
                  </div>

                  {autoRefreshEnabled && (
                    <div>
                      <Label htmlFor="refresh-interval" className="text-gray-300">Refresh Interval</Label>
                      <Select value={autoRefresh} onValueChange={setAutoRefresh}>
                        <SelectTrigger className="bg-gray-800/50 border-gray-700 text-gray-300 mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-800 border-gray-700">
                          {refreshIntervals.map(iv => (
                            <SelectItem key={iv} value={iv}>{iv}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-gray-900/50 border-gray-800">
                <CardHeader>
                  <CardTitle className="text-lg text-white flex items-center">
                    <Globe className="h-5 w-5 mr-2 text-purple-400" />
                    Display Settings
                  </CardTitle>
                  <CardDescription>Customize the dashboard appearance</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="dark-mode" className="text-gray-300">Dark Mode</Label>
                    <Switch id="dark-mode" defaultChecked />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="theme" className="text-gray-300">Grafana-style Theme</Label>
                    <Switch id="theme" defaultChecked />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="animations" className="text-gray-300">Animations</Label>
                    <Switch id="animations" defaultChecked />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="mt-6 flex justify-end">
              <Button className="bg-blue-600 hover:bg-blue-500">
                <Save className="h-4 w-4 mr-2" /> Save Settings
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="annotations">
            <Card className="bg-gray-900/50 border-gray-800">
              <CardHeader>
                <CardTitle className="text-lg text-white">Annotation Sources</CardTitle>
                <CardDescription>Configure annotation queries for dashboards</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {annotations.map((annotation) => (
                    <div key={annotation.id} className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg border border-gray-700">
                      <div className="flex items-center space-x-3">
                        <div className={`w-2 h-2 rounded-full ${annotation.enabled ? 'bg-green-400' : 'bg-gray-500'}`} />
                        <div>
                          <p className="text-sm font-medium text-gray-300">{annotation.name}</p>
                          <p className="text-xs text-gray-500">Data source: {annotation.datasource}</p>
                        </div>
                      </div>
                      <Badge variant={annotation.enabled ? 'default' : 'secondary'}>
                        {annotation.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                  ))}
                </div>

                <Button variant="outline" className="mt-4 border-gray-700 text-gray-300 hover:text-white">
                  <Edit3 className="h-4 w-4 mr-1" /> Add Annotation
                </Button>
              </CardContent>
            </Card>

            <div className="mt-6 flex justify-end">
              <Button className="bg-blue-600 hover:bg-blue-500">
                <Save className="h-4 w-4 mr-2" /> Save Annotations
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="links">
            <Card className="bg-gray-900/50 border-gray-800">
              <CardHeader>
                <CardTitle className="text-lg text-white">Dashboard Links</CardTitle>
                <CardDescription>External links to display on dashboards</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {links.map((link) => (
                    <div key={link.id} className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg border border-gray-700">
                      <div className="flex items-center space-x-3">
                        <Link2 className="h-4 w-4 text-gray-500" />
                        <div>
                          <p className="text-sm font-medium text-gray-300">{link.title}</p>
                          <p className="text-xs text-gray-500 break-all">{link.url}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 space-y-3">
                  <Input
                    placeholder="Link title"
                    className="bg-gray-800/50 border-gray-700 text-gray-300"
                  />
                  <Input
                    placeholder="https://example.com"
                    className="bg-gray-800/50 border-gray-700 text-gray-300"
                  />
                  <Button variant="outline" className="border-gray-700 text-gray-300 hover:text-white">
                    Add Link
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="mt-6 flex justify-end">
              <Button className="bg-blue-600 hover:bg-blue-500">
                <Save className="h-4 w-4 mr-2" /> Save Links
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="keyboard">
            <Card className="bg-gray-900/50 border-gray-800">
              <CardHeader>
                <CardTitle className="text-lg text-white">Keyboard Shortcuts</CardTitle>
                <CardDescription>Grafana-like keyboard shortcuts for quick access</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <ShortcutItem keys="Ctrl + N" description="New dashboard" />
                  <ShortcutItem keys="Ctrl + S" description="Save dashboard" />
                  <ShortcutItem keys="Ctrl + E" description="Edit dashboard" />
                  <ShortcutItem keys="Ctrl + P" description="Add panel" />
                  <ShortcutItem keys="Ctrl + F" description="Fullscreen panel" />
                  <ShortcutItem keys="/" description="Search" />
                  <ShortcutItem keys="Ctrl + G" description="Toggle sidebar" />
                  <ShortcutItem keys="Escape" description="Reset/Collapse" />
                  <ShortcutItem keys="Ctrl + Shift + K" description="Command palette" />
                  <ShortcutItem keys="Ctrl + Shift + P" description="Panel edit mode" />
                  <ShortcutItem keys="Alt + F" description="Toggle time picker" />
                  <ShortcutItem keys="t" description="Toggle theme (dark/light)" />
                </div>

                <Button variant="outline" className="mt-4 border-gray-700 text-gray-300 hover:text-white">
                  Customize Shortcuts
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ShortcutItem({ keys, description }: { keys: string; description: string }) {
  return (
    <div className="flex items-center justify-between p-2 bg-gray-800/30 rounded border border-gray-700">
      <span className="text-sm text-gray-300">{description}</span>
      <Badge variant="outline" className="font-mono text-xs border-gray-700 text-gray-400">
        {keys}
      </Badge>
    </div>
  );
}
