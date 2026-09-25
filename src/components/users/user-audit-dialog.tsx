"use client"

import { useEffect, useState } from "react"
import { History } from "lucide-react"

import { getStaffAuditLog, type AuditEntryDTO } from "@/lib/actions/users"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"

type UserAuditDialogProps = {
  staffId: string
  staffName: string
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function UserAuditDialog({
  staffId,
  staffName,
  trigger,
  open,
  onOpenChange,
}: UserAuditDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<AuditEntryDTO[]>([])

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const setOpen = (value: boolean) => (isControlled ? onOpenChange?.(value) : setInternalOpen(value))

  useEffect(() => {
    if (!isOpen) return
    getStaffAuditLog(staffId).then((rows) => {
      setEntries(rows)
      setLoading(false)
    })
  }, [isOpen, staffId])

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {isControlled ? null : (
        <DialogTrigger render={trigger ? undefined : <Button variant="ghost" size="sm" />}>
          {trigger ?? (
            <>
              <History className="size-3.5" /> Activity
            </>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Activity for {staffName}</DialogTitle>
          <DialogDescription>
            Recent account and security events (last 50).
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          {loading ? (
            <div className="space-y-3 p-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <div className="space-y-0">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start justify-between gap-3 border-b py-3 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium">{entry.action}</p>
                    {entry.entityType !== "User" && (
                      <p className="text-xs text-muted-foreground">
                        {entry.entityType}
                        {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}…` : ""}
                      </p>
                    )}
                  </div>
                  <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatTimestamp(entry.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}