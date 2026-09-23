"use client"

import { useSyncExternalStore } from "react"
import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react"
import { useTheme, type Theme } from "@/components/theme-provider"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

function themeLabel(theme?: Theme): string {
  return THEMES.find((t) => t.value === theme)?.label ?? "System"
}

const emptySubscribe = () => () => {}

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  // false during SSR + hydration, true after the client commits. next-themes
  // reads localStorage synchronously during the first client render, so `theme`
  // can differ from the server-rendered "system" default and cause a hydration
  // mismatch. Delay theme-dependent output until after hydration.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )
  const activeTheme = mounted ? (theme ?? "system") : "system"
  const isSystem = activeTheme === "system"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Theme: ${themeLabel(activeTheme)}`}
          />
        }
      >
        {isSystem ? (
          <Monitor className="size-4" />
        ) : resolvedTheme === "dark" ? (
          <Moon className="size-4" />
        ) : (
          <Sun className="size-4" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEMES.map(({ value, label, icon: OptionIcon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            aria-current={theme === value}
          >
            <OptionIcon className="size-4" />
            {label}
            {theme === value && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}