"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  History,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Power,
  ShieldCheck,
} from "lucide-react"

import { setUserStatus } from "@/lib/actions/users"
import type { StaffUserDTO } from "@/lib/actions/users"
import { PERMISSION_MATRIX, type Permission } from "@/lib/permissions"
import { USER_ROLE } from "@/lib/status"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PageHeader } from "@/components/common/page-header"
import { StatusBadge } from "@/components/common/status-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { initials, formatDate } from "@/lib/format"

import { UserCreateDialog } from "@/components/users/user-create-dialog"
import { UserEditDialog } from "@/components/users/user-edit-dialog"
import { PermissionEditorDialog } from "@/components/users/permission-editor-dialog"
import { ChangeOwnPasswordDialog, ResetPasswordDialog } from "@/components/users/password-dialogs"
import { UserAuditDialog } from "@/components/users/user-audit-dialog"

const ACTION_ROLES = new Set(["OWNER", "ADMIN"]) as Set<string>

type UsersAccessPageProps = {
  staff: StaffUserDTO[]
  actor: { id: string; role: StaffUserDTO["role"]; permissions: string[] }
}

export function UsersAccessPage({ staff, actor }: UsersAccessPageProps) {
  const router = useRouter()
  const [toggleTarget, setToggleTarget] = useState<StaffUserDTO | null>(null)
  const [activeAction, setActiveAction] = useState<{
    kind: "edit" | "permissions" | "reset" | "audit"
    staff: StaffUserDTO
  } | null>(null)

  const ownersCount = staff.filter((s) => s.role === "OWNER" && s.status === "ACTIVE").length
  const deactivatedCount = staff.filter((s) => s.status === "DEACTIVATED").length

  const sorted = [...staff].sort((a, b) => rankOf(a.role) - rankOf(b.role))

  const closeAction = () => setActiveAction(null)

  function confirmToggle() {
    if (!toggleTarget) return
    const next: "ACTIVE" | "DEACTIVATED" =
      toggleTarget.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE"
    const target = toggleTarget
    setToggleTarget(null)
    runToggle(target.id, next)
  }

  async function runToggle(staffId: string, status: "ACTIVE" | "DEACTIVATED") {
    const res = await setUserStatus(staffId, status)
    if (res.success) {
      toast.success(status === "ACTIVE" ? "User activated" : "User deactivated")
      router.refresh()
    } else {
      toast.error(res.error ?? "Something went wrong")
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & Access"
        description="Manage staff accounts, roles, passwords and fine-grained permissions"
      />

      {/*
        Actor is always staff:manage-capable (the route is gated), but only the
        OWNER may create/promote OWNER accounts — the action enforces it too.
      */}
      <UserCreateDialog
        isOwner={actor.role === "OWNER"}
        actorPermissions={actor.permissions}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl tabular-nums">{staff.length}</CardTitle>
            <CardDescription>Total users</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl tabular-nums">{ownersCount}</CardTitle>
            <CardDescription>Active owners</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl tabular-nums">{deactivatedCount}</CardTitle>
            <CardDescription>Deactivated</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Team members</CardTitle>
            <CardDescription>
              Role defaults give everyone a baseline. Use Permissions to fine-tune any user.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((staffMember) => (
                <TableRow key={staffMember.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {initials(staffMember.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">
                            {staffMember.name}
                            {staffMember.id === actor.id && (
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                (you)
                              </span>
                            )}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {staffMember.username
                            ? `@${staffMember.username} · ${staffMember.email}`
                            : staffMember.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={USER_ROLE[staffMember.role].tone}>
                      {USER_ROLE[staffMember.role].label}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    {staffMember.status === "ACTIVE" ? (
                      <StatusBadge tone="success">Active</StatusBadge>
                    ) : (
                      <StatusBadge tone="destructive">Deactivated</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell>
                    <AccessChips permissions={staffMember.effectivePermissions} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(staffMember.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon-sm" aria-label="Row actions" />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-60">
                        <DropdownMenuItem onClick={() => setActiveAction({ kind: "edit", staff: staffMember })}>
                          <Pencil className="size-4" /> Edit profile
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setActiveAction({ kind: "permissions", staff: staffMember })}>
                          <ShieldCheck className="size-4" /> Permissions
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {staffMember.status === "ACTIVE" && (
                          <DropdownMenuItem onClick={() => setActiveAction({ kind: "reset", staff: staffMember })}>
                            <KeyRound className="size-4" /> Reset password
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setActiveAction({ kind: "audit", staff: staffMember })}>
                          <History className="size-4" /> Activity
                        </DropdownMenuItem>
                        {canToggle(staffMember, actor.id, actor.role) && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setToggleTarget(staffMember)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Power className="size-4" />
                              {staffMember.status === "ACTIVE" ? "Deactivate user" : "Activate user"}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>My security</CardTitle>
            <CardDescription>
              Changing your password signs out all other sessions immediately.
            </CardDescription>
          </div>
          <ChangeOwnPasswordDialog
            trigger={
              <Button variant="outline" size="sm">
                <KeyRound className="size-3.5" /> Change my password
              </Button>
            }
          />
        </CardHeader>
      </Card>

      {activeAction?.kind === "edit" && (
        <UserEditDialog
          key={activeAction.staff.id}
          staff={activeAction.staff}
          isOwnerActor={actor.role === "OWNER"}
          open
          onOpenChange={(open) => !open && closeAction()}
        />
      )}
      {activeAction?.kind === "permissions" && (
        <PermissionEditorDialog
          key={activeAction.staff.id}
          staff={activeAction.staff}
          actorPermissions={actor.permissions}
          open
          onOpenChange={(open) => !open && closeAction()}
        />
      )}
      {activeAction?.kind === "reset" && (
        <ResetPasswordDialog
          key={activeAction.staff.id}
          staffId={activeAction.staff.id}
          staffName={activeAction.staff.name}
          open
          onOpenChange={(open) => !open && closeAction()}
        />
      )}
      {activeAction?.kind === "audit" && (
        <UserAuditDialog
          key={activeAction.staff.id}
          staffId={activeAction.staff.id}
          staffName={activeAction.staff.name}
          open
          onOpenChange={(open) => !open && closeAction()}
        />
      )}

      <AlertDialog open={!!toggleTarget} onOpenChange={(open) => !open && setToggleTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleTarget?.status === "ACTIVE" ? "Deactivate user?" : "Activate user?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleTarget?.status === "ACTIVE"
                ? `${toggleTarget?.name} will be signed out immediately and blocked from logging in until reactivated.`
                : `${toggleTarget?.name} will regain access to the CRM.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={toggleTarget?.status === "ACTIVE" ? "destructive" : "default"}
              onClick={confirmToggle}
            >
              {toggleTarget?.status === "ACTIVE" ? "Deactivate" : "Activate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const MODULE_BY_PERMISSION = new Map(
  PERMISSION_MATRIX.flatMap((m) => m.permissions.map((p) => [p.permission, m.module]))
)

function AccessChips({ permissions }: { permissions: string[] }) {
  const modules = [
    ...new Set(permissions.map((p) => MODULE_BY_PERMISSION.get(p as Permission) ?? p)),
  ]
  if (modules.length === 0) return <span className="text-xs text-muted-foreground">None</span>
  const shown = modules.slice(0, 3)
  const rest = modules.length - shown.length
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      title={modules.join(", ")}
    >
      {shown.map((m) => (
        <Badge key={m} variant="secondary" className="text-[10px] font-medium">
          {m}
        </Badge>
      ))}
      {rest > 0 && (
        <span className="text-[10px] text-muted-foreground">+{rest} more</span>
      )}
    </div>
  )
}

function rankOf(role: StaffUserDTO["role"]): number {
  switch (role) {
    case "OWNER":
      return 0
    case "ADMIN":
      return 1
    case "RECEPTIONIST":
      return 2
    case "TRAINER":
      return 3
  }
}

function canToggle(
  staffMember: StaffUserDTO,
  actorId: string,
  actorRole: StaffUserDTO["role"]
): boolean {
  if (staffMember.id === actorId) return false
  // Deactivating an ACTIVE owner is a protected action — owners are managed
  // through Edit profile (role/status changes, still last-owner guarded).
  if (staffMember.role === "OWNER" && staffMember.status === "ACTIVE") return false
  return ACTION_ROLES.has(actorRole)
}