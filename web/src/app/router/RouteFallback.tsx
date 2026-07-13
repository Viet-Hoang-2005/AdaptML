import { Skeleton } from '@/shared/ui/Skeleton';

export function RouteFallback() {
  return (
    <div className="flex min-h-screen bg-background p-4 md:p-6" role="status" aria-label="Loading page">
      <div className="hidden w-18 shrink-0 rounded-xl bg-surface md:block xl:w-64" />
      <div className="flex-1 space-y-5 px-0 md:px-6">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
