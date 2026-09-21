import { useState, Suspense } from 'react';
import { Play, Pause, RefreshCw, Search, BarChart3, Table as TableIcon, Code, Download, Share2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@wideo11/ui/card';
import { Button } from '@wideo11/ui/button';
import { Input } from '@wideo11/ui/input';
import { Badge } from '@wideo11/ui/badge';
import { Skeleton } from '@wideo11/ui/skeleton';
import { ScrollArea } from '@wideo11/ui/scroll-area';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@wideo11/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@wideo11/ui/tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';

const LazyQueryEditor = dynamic(() => import('@/components/explore/query-editor'), {
  loading: () => <Skeleton className="h-64 w-full bg-gray-700/50" />,
  ssr: false,
});

const LazyResultsTable = dynamic(() => import('@/components/explore/results-table'), {
  loading: () => <Skeleton className="h-48 w-full bg-gray-700/50" />,
  ssr: false,
});

export const metadata = {
  title: 'Explore - Wideo11 Monitor',
  description: 'Explore Prometheus metrics and queries',
};

export default function ExplorePage() {
  const [query, setQuery] = useState('rate(http_requests_total[5m])');
  const [timeRange, setTimeRange] = useState('last_1h');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const queryClient = useQueryClient();

  const { data: prometheusData, refetch, isFetching } = useQuery({
    queryKey: ['explore-query', query, timeRange],
    queryFn: () => queryPrometheus(query, timeRange),
    enabled: false,
  });

  const handleQuery = async () => {
    setIsRunning(true);
    try {
      const result = await refetch();
      setResults(result.data);
    } catch (error) {
      console.error('Query failed:', error);
    } finally {
      setIsRunning(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      handleQuery();
    }
  };

  return (
    <div className="h-[calc(100vh-73px)] flex flex-col bg-[hsl(222.2_84%_6.1%)]">
      <div className="border-b border-[hsl(217.2_32.6%_17.5%)] p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-white">Explore</h1>
          <div className="flex items-center space-x-2">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-32 bg-[hsl(223_47%_11.2%)] border-[hsl(217.2_32.6%_17.5%)] text-gray-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-700">
                <SelectItem value="5m">Last 5 minutes</SelectItem>
                <SelectItem value="15m">Last 15 minutes</SelectItem>
                <SelectItem value="1h">Last 1 hour</SelectItem>
                <SelectItem value="6h">Last 6 hours</SelectItem>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
              </SelectContent>
            </Select>
            <Button 
              variant="outline"
              size="sm"
              className="border-gray-700 text-gray-300 hover:text-white"
              onClick={handleQuery}
              disabled={isFetching || !query}
            >
              {isRunning ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
              Run Query
            </Button>
            <kbd className="px-2 py-1 bg-gray-800 rounded text-xs text-gray-500">
              Ctrl+Enter
            </kbd>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm text-gray-400">PromQL Query</Label>
          <div 
            className="relative"
            onKeyDown={handleKeyPress}
          >
            <Suspense fallback={<Skeleton className="h-24 w-full bg-gray-700/50" />}>
              <LazyQueryEditor
                query={query}
                onChange={setQuery}
                onExecute={handleQuery}
                disabled={isFetching || isRunning}
              />
            </Suspense>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <Suspense fallback={<ResultsSkeleton />}>
          <LazyResultsTable 
            data={results || prometheusData} 
            isLoading={isFetching || isRunning} 
          />
        </Suspense>
      </div>
    </div>
  );
}

async function queryPrometheus(query: string, timeRange: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/v1/query?query=${encodeURIComponent(query)}&range=${timeRange}`, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Failed to query Prometheus');
  }

  return response.json();
}

function ResultsSkeleton() {
  return (
    <Card className="bg-[hsl(223_47%_11.2%)] border-[hsl(217.2_32.6%_17.5%)]">
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
