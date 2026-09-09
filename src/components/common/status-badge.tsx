import { cn } from "@/lib/utils"

import { Badge } from "@/components/ui/badge"
import { toneClasses, type BadgeTone } from "@/lib/status"

type StatusBadgeProps = {
  tone?: BadgeTone
  className?: string
  children: React.ReactNode
} & React.ComponentProps<typeof Badge>

export function StatusBadge({ tone = "muted", className, children, ...props }: StatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn(toneClasses[tone], className)} {...props}>
      {children}
    </Badge>
  )
}