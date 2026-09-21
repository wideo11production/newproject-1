import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { Skeleton } from '@wideo11/ui/skeleton';
import { ScrollArea } from '@wideo11/ui/scroll-area';
import { BarChart3, TableIcon, Download, RefreshCw, Activity } from 'lucide-react';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@wideo11/ui/tabs';

interface ResultsTableProps {
  data: any;
  isLoading: boolean;
}

export default function ResultsTable({ data, isLoading }: ResultsTableProps) {
  if (isLoading) {
    return <ResultsSkeleton />;
  }

  if (!data) {
    return (
      <div className="text-center py-8 text-gray-500">
        <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-30" />
        <p>Enter a query and click "Run" to see results</p>
      </div>
    );
  }

  const { status, resultType, result } = data?.data || {};

  if (status !== 'success') {
    return (
      <div className="text-center py-8 text-red-400">
        <p>Error: {data?.errors?.[0]?.message || 'Unknown error'}</p>
      </div>
    );
  }

  return (
    <Tabs defaultValue="table" className="w-full">
      <TabsList className="bg-gray-800/50 border-gray-700 mb-4">
        <TabsTrigger value="table" className="data-[state=active]:bg-gray-700">
          <TableIcon className="h-4 w-4 mr-1" /> Table
        </TabsTrigger>
        <TabsTrigger value="chart" className="data-[state=active]:bg-gray-700">
          <BarChart3 className="h-4 w-4 mr-1" /> Chart
        </TabsTrigger>
        <TabsTrigger value="graph" className="data-[state=active]:bg-gray-700">
          <Activity className="h-4 w-4 mr-1" /> Graph
        </TabsTrigger>
      </TabsList>

      <TabsContent value="table">
        <Card className="bg-gray-900/50 border-gray-800">
          <CardContent className="p-0">
            <ScrollArea className="h-80">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left p-2 text-gray-400 font-medium">Metric</th>
                    <th className="text-right p-2 text-gray-400 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {resultType === 'vector' && Array.isArray(result) && result.map((r, i) => (
                    <tr key={i} className="border-b border-gray-800/50">
                      <td className="p-2">
                        <code className="text-blue-400">
                          {r.metric ? r.metric.__name__ || 'metric' : 'metric'}
                        </code>
                        {r.metric && Object.entries(r.metric).filter(([k]) => k !== '__name__').map(([k, v]) => (
                          <Badge key={k} variant="outline" className="ml-1 text-xs border-gray-700 text-gray-400">
                            {k}="{v}"
                          </Badge>
                        ))}
                      </td>
                      <td className="text-right p-2 text-gray-300 font-mono">
                        {r.value ? r.value[1] : r.value}
                      </td>
                    </tr>
                  ))}
                  {resultType === 'matrix' && Array.isArray(result) && result.map((r, i) => (
                    <tr key={i} className="border-b border-gray-800/50">
                      <td className="p-2">
                        <code className="text-blue-400">{r.metric?.__name__ || 'metric'}</code>
                      </td>
                      <td className="text-right p-2 text-gray-300 font-mono">
                        {r.values?.length ? `${r.values[0][1]} ... ${r.values[r.values.length - 1][1]}` : 'no data'}
                      </td>
                    </tr>
                  ))}
                  {resultType === 'scalar' && (
                    <tr className="border-b border-gray-800/50">
                      <td className="p-2"><code className="text-blue-400">scalar</code></td>
                      <td className="text-right p-2 text-gray-300 font-mono">
                        {result?.[1]}
                      </td>
                    </tr>
                  )}
                  {resultType === 'string' && (
                    <tr className="border-b border-gray-800/50">
                      <td className="p-2"><code className="text-blue-400">string</code></td>
                      <td className="text-right p-2 text-gray-300 font-mono">
                        {result?.[1]}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="chart">
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-300">
              Chart View ({resultType})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48 flex items-end justify-between gap-0.5 p-2">
              {Array.from({ length: 30 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-blue-500/60 hover:bg-blue-400 rounded-t transition-all flex-1"
                  style={{ height: `${Math.random() * 70 + 30}%`, minHeight: '2px' }}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="graph">
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-300">
              Graph View ({resultType})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-60">
              <div className="space-y-4 p-2">
                {resultType === 'matrix' && Array.isArray(result) && result.map((r, i) => (
                  <div key={i} className="space-y-1">
                    <div className="text-xs text-gray-400">
                      {r.metric?.__name__ || 'metric'}
                    </div>
                    <svg width="100%" height="40" className="text-blue-400/60">
                      <polyline
                        fill="none"
                        strokeWidth={2}
                        className="stroke-blue-400 fill-blue-400/10"
                        points={r.values?.map((v, i) => 
                          `${(i / (r.values.length - 1)) * 100},${10 - (parseFloat(v[1].split(' ')[0]) % 10)}`
                        ).join(' ')}
                      />
                    </svg>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function ResultsSkeleton() {
  return (
    <Card className="bg-gray-900/50 border-gray-800">
      <CardContent className="p-4">
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full bg-gray-700/50" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
