"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { Menu, Dumbbell } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { SidebarBrand } from "@/components/shell/sidebar-nav"
import { UserMenu } from "@/components/shell/topbar"
import { ThemeToggle } from "@/components/shell/theme-toggle"
import { navTitleForPath } from "@/lib/nav-items"
import type { SessionUser } from "@/lib/auth/auth"

type ShellProps = {
  user: SessionUser
  sidebarNav: React.ReactNode
  topbarActions: React.ReactNode
  branchSwitcher?: React.ReactNode
  children: React.ReactNode
}

export function Shell({ user, sidebarNav, topbarActions, branchSwitcher, children }: ShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const sidebar = (
    <>
      <SidebarBrand />
      {sidebarNav}
    </>
  )

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background print:relative print:h-auto print:overflow-visible">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r bg-muted/30 lg:flex lg:flex-col print:hidden">
        <SidebarBrand />
        {sidebarNav}
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden print:hidden"
              aria-label="Open menu"
            />
          }
        >
          <Menu className="size-4" />
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <div className="flex h-full flex-col">{sidebar}</div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col print:relative print:overflow-visible">
        {/* Topbar */}
        <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6 print:hidden">
          <div className="flex items-center gap-2">
            <span className="lg:hidden">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Dumbbell className="size-4" />
              </span>
            </span>
            <div className="flex items-center gap-2 text-sm">
              <span className="hidden text-muted-foreground sm:inline">
                {user.organization.name}
              </span>
              <span className="hidden text-muted-foreground sm:inline">/</span>
              {branchSwitcher && (
                <>
                  {branchSwitcher}
                  <span className="hidden text-muted-foreground sm:inline">/</span>
                </>
              )}
              <h1 className="font-semibold tracking-tight">{navTitleForPath(pathname)}</h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {topbarActions}
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 print:overflow-visible">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  )
}