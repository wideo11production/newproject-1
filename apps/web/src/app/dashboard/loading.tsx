import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';

function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

export default function Loading() {
  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
        <div className="flex items-center space-x-3">
          <Skeleton className="h-6 w-6 bg-gray-700/50" />
          <Skeleton className="h-5 w-32 bg-gray-700/50" />
        </div>
      </header>
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="bg-gray-900/50 border-gray-800">
            <CardHeader>
              <CardTitle>
                <Skeleton className="h-4 w-24 bg-gray-700/50" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-6 w-16 bg-gray-700/50" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex-1 overflow-hidden px-4 pb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="bg-gray-900/50 border-gray-800 animate-pulse">
              <CardHeader>
                <Skeleton className="h-4 w-3/4 bg-gray-700/50" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-40 w-full bg-gray-700/50" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
