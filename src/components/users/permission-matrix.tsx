"use client"

import { useMemo, useState } from "react"
import {
  BellRing,
  CalendarClock,
  ChartColumn,
  ClipboardCheck,
  Dumbbell,
  FileText,
  LayoutDashboard,
  ListChecks,
  QrCode,
  Search,
  Settings2,
  ShieldCheck,
  Tag,
  Target,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react"

import {
  PERMISSION_MATRIX,
  type Permission,
  type PermissionMatrixEntry,
} from "@/lib/permissions"
import {
  actionPermissionsOf,
  permissionDescription,
  setModulePermission,
  summarizePermissions,
  toggleModuleAccessIn,
  togglePermissionIn,
  viewPermissionOf,
} from "@/lib/permission-ui"
import { cn } from "@/lib/utils"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"

/**
 * The permission editor — a responsive module-card layout.
 *
 * Each CRM module renders as its own card showing ONLY the permissions that
 * actually belong to it (the catalog is PERMISSION_MATRIX — the single source
 * of truth; no columns are invented). "Module access" is the module's `:view`
 * base and behaves specially: turning actions on forces it on, turning it off
 * clears the module's other actions (the same rule the backend expects).
 *
 * Responsive: cards wrap in a css grid (1 column on phones, 2 on tablets,
 * 3 on wide screens). The page/dialog never scrolls sideways — there is no
 * fixed-width permission table and no global column grid.
 */

const FILTERS = [
  { key: "all", label: "All" },
  { key: "enabled", label: "Enabled" },
  { key: "custom", label: "Custom" },
] as const

type FilterKey = (typeof FILTERS)[number]["key"]

const MODULE_ICONS: Record<string, LucideIcon> = {
  Dashboard: LayoutDashboard,
  Members: Users,
  Memberships: FileText,
  Plans: Tag,
  Payments: Wallet,
  Attendance: ClipboardCheck,
  "QR Check-in": QrCode,
  Leads: Target,
  Trainers: Dumbbell,
  Appointments: CalendarClock,
  Tasks: ListChecks,
  Reports: ChartColumn,
  Notifications: BellRing,
  Settings: Settings2,
  "Users & Access": ShieldCheck,
}

type PermissionMatrixProps = {
  /** Full permission-key -> granted map (all catalog keys present). */
  value: Record<string, boolean>
  onChange: (next: Record<string, boolean>) => void
  /**
   * Subset of permission keys the ACTOR is allowed to turn on. Anything the
   * actor already holds may be revoked; anything currently off that the actor
   * does not hold is locked (the server enforces the same rule).
   */
  grantable: Set<string>
  /** Role-default keys for the user being edited/created (baseline display). */
  roleDefaults?: Set<string>
  disabled?: boolean
  /** Show the "X permissions · Y modules · Z custom changes" summary bar. */
  showSummary?: boolean
  className?: string
}

export function PermissionMatrix({
  value,
  onChange,
  grantable,
  roleDefaults,
  disabled,
  showSummary = true,
  className,
}: PermissionMatrixProps) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<FilterKey>("all")

  const modules = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PERMISSION_MATRIX.filter((entry) => {
      if (q) {
        const searchable = [
          entry.module,
          ...entry.permissions.flatMap((p) => [p.action, p.permission]),
        ]
          .join(" ")
          .toLowerCase()
        if (!searchable.includes(q)) return false
      }
      if (filter === "enabled") {
        if (!entry.permissions.some((p) => value[p.permission])) return false
      }
      if (filter === "custom") {
        if (
          !entry.permissions.some(
            (p) => Boolean(value[p.permission]) !== Boolean(roleDefaults?.has(p.permission))
          )
        ) {
          return false
        }
      }
      return true
    })
  }, [query, filter, value, roleDefaults])

  const summary = useMemo(
    () => summarizePermissions(value, roleDefaults),
    [value, roleDefaults]
  )

  function togglePermission(entry: PermissionMatrixEntry, permission: Permission) {
    onChange(togglePermissionIn(value, permission, entry))
  }

  function toggleModuleAccess(entry: PermissionMatrixEntry) {
    onChange(toggleModuleAccessIn(value, entry))
  }

  function applyModule(entry: PermissionMatrixEntry, enabled: boolean) {
    onChange(setModulePermission(value, entry, enabled, grantable))
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search permissions…"
            className="h-9 pl-8 text-sm"
            aria-label="Search permissions"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1 self-start rounded-lg bg-muted p-0.5 sm:self-auto">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filter === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {showSummary && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span>
            <span className="font-medium tabular-nums">{summary.enabled}</span> permissions enabled
          </span>
          <span>
            <span className="font-medium tabular-nums">{summary.modules}</span> modules
          </span>
          <button
            type="button"
            onClick={() => setFilter("custom")}
            title="Show only modules with custom changes"
            className={cn(
              "text-muted-foreground transition-colors hover:text-foreground",
              filter === "custom" && "font-medium text-foreground"
            )}
          >
            <span className="font-medium tabular-nums">{summary.changes}</span> custom changes
          </button>
        </div>
      )}

      {modules.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          No permissions match
          {query ? <span className="font-medium"> “{query}”</span> : " the current filter"}.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((entry) => {
            const Icon = MODULE_ICONS[entry.module]
            const viewKey = viewPermissionOf(entry)
            const total = entry.permissions.length
            const granted = entry.permissions.filter((p) => value[p.permission]).length
            return (
              <div
                key={entry.module}
                className="flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
              >
                <div className="flex items-start justify-between gap-2 border-b border-foreground/5 p-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-primary" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{entry.module}</p>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {granted}/{total}
                        </span>
                      </div>
                      {entry.description && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {entry.description}
                        </p>
                      )}
                    </div>
                  </div>
                  {total > 1 && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => applyModule(entry, true)}
                        disabled={disabled}
                        className="rounded border border-foreground/10 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => applyModule(entry, false)}
                        disabled={disabled}
                        className="rounded border border-foreground/10 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                <div className="divide-y divide-foreground/5">
                  {viewKey && (
                    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Module access</p>
                        <p className="text-xs text-muted-foreground">
                          {value[viewKey]
                            ? permissionDescription(viewKey, "View")
                            : "Turn on module access to allow this user to use this module."}
                        </p>
                      </div>
                      <Switch
                        checked={Boolean(value[viewKey])}
                        onCheckedChange={() => toggleModuleAccess(entry)}
                        disabled={disabled || (!value[viewKey] && !grantable.has(viewKey))}
                        aria-label={`${entry.module} module access`}
                        title={
                          !value[viewKey] && !grantable.has(viewKey)
                            ? "You can only grant permissions you hold yourself"
                            : undefined
                        }
                      />
                    </div>
                  )}

                  {actionPermissionsOf(entry).map(({ permission, action, sensitive }) => {
                    const checked = Boolean(value[permission])
                    const isDefault = Boolean(roleDefaults?.has(permission))
                    const changed = roleDefaults ? checked !== isDefault : false
                    const lockInactive = !checked && !grantable.has(permission)
                    return (
                      <div key={permission} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => togglePermission(entry, permission)}
                            disabled={disabled || lockInactive}
                            aria-label={`${entry.module} ${action}`}
                            title={
                              lockInactive
                                ? "You can only grant permissions you hold yourself"
                                : `${entry.module} — ${action}`
                            }
                            className="mt-0.5"
                          />
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                              {action}
                              {changed ? (
                                <span className="rounded-full bg-foreground/10 px-1.5 text-[10px] font-medium text-foreground/70">
                                  Custom
                                </span>
                              ) : (
                                <span
                                  title="Role default — comes from this user's role"
                                  className="size-1.5 shrink-0 rounded-full bg-primary/60"
                                />
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {permissionDescription(permission, action)}
                            </p>
                          </div>
                        </div>
                        {sensitive && (
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px] font-medium text-amber-600 dark:text-amber-500"
                          >
                            Sensitive
                          </Badge>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="space-y-1 px-0.5 pt-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-primary/60" />
            Role default — comes from this user&apos;s role
          </span>
          <span className="flex items-center gap-1">
            <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/70">
              Custom
            </span>
            changed for this user
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          View is the base of every module — turning on an action turns module access on, and
          turning module access off clears the module&apos;s other actions. Changes apply after
          saving.
        </p>
      </div>
    </div>
  )
}