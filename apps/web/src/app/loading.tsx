import { Skeleton } from '@wideo11/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';

export default function Loading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48 bg-gray-700/50" />
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="bg-gray-900/50 border-gray-800 overflow-hidden">
            <CardContent className="p-0">
              <Skeleton className="aspect-video w-full bg-gray-700/50" />
              <div className="p-3 space-y-2">
                <Skeleton className="h-4 w-full bg-gray-700/50" />
                <Skeleton className="h-3 w-2/3 bg-gray-700/50" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
