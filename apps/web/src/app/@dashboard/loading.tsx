import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';

function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md ${className ?? ''}`} />;
}

export default function Loading() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-4">
        <h2 className="text-sm font-medium text-gray-400">System Health</h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="bg-gray-900/50 border-gray-700">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24 bg-gray-700/50" />
                  <Skeleton className="h-5 w-12 bg-gray-700/50" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-gray-900/50 border-gray-700">
          <CardHeader>
            <Skeleton className="h-4 w-32 bg-gray-700/50" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-full bg-gray-700/50" />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-900/50 border-gray-700">
          <CardHeader>
            <Skeleton className="h-4 w-32 bg-gray-700/50" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full bg-gray-700/50" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
