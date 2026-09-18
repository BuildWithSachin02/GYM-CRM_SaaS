import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="rounded-xl border p-4">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24" />
          ))}
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border p-5">
        <Skeleton className="h-4 w-56" />
        <div className="mt-4 grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-md" />
          ))}
        </div>
      </div>
      <div className="rounded-xl border p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-56 w-full" />
      </div>
    </div>
  )
}