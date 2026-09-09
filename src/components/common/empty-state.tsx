import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

type EmptyStateProps = {
  icon: LucideIcon
  title: string
  description?: string
  actionLabel?: string
  actionHref?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-3 text-sm font-medium">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {actionLabel && actionHref && (
        <Button variant="outline" render={<a href={actionHref} />} className="mt-4">
          {actionLabel}
        </Button>
      )}
    </div>
  )
}