"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useServerInsertedHTML } from "next/navigation"

export type Theme = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

const STORAGE_KEY = "theme"

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

/**
 * The pre-hydration class toggle. Rendered as raw initial HTML via
 * `useServerInsertedHTML` — never as a React-managed <script> — so React 19
 * does not warn about script tags rendered on the client. It applies the
 * theme before first paint to avoid a flash of the wrong theme.
 */
function noFlashScript(storageKey: string): string {
  return `(function () {
  try {
    var theme = localStorage.getItem(${JSON.stringify(storageKey)}) || "system";
    var dark = theme === "dark" ||
      (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {}
})();`
}

/** Reads the persisted theme synchronously on the client ("system" elsewhere). */
function getInitialTheme(storageKey: string): Theme {
  if (typeof window === "undefined") return "system"
  try {
    const stored = window.localStorage.getItem(storageKey)
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored
    }
  } catch {
    // localStorage unavailable (private browsing) — fall through to "system".
  }
  return "system"
}

function prefersDarkScheme(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  )
}

function resolve(theme: Theme): ResolvedTheme {
  if (theme === "system") return prefersDarkScheme() ? "dark" : "light"
  return theme
}

function applyToDom(theme: Theme) {
  const resolved = resolve(theme)
  const root = document.documentElement
  root.classList.toggle("dark", resolved === "dark")
  root.style.colorScheme = resolved
}

/**
 * Minimal next-themes-compatible theme provider. Injects the no-flash script
 * through `useServerInsertedHTML` (outside the React tree), keeping SSR
 * behaviour without triggering React 19's client <script> warning.
 */
export function ThemeProvider({
  children,
  storageKey = STORAGE_KEY,
}: {
  children: React.ReactNode
  storageKey?: string
}) {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme(storageKey))
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolve(theme))

  useServerInsertedHTML(() => (
    <script dangerouslySetInnerHTML={{ __html: noFlashScript(storageKey) }} />
  ))

  const setTheme = useCallback(
    (next: Theme) => {
      if (typeof window === "undefined") return
      setThemeState(next)
      setResolvedTheme(resolve(next))
      try {
        window.localStorage.setItem(storageKey, next)
      } catch {
        // Ignore storage errors; the class is still applied in-memory.
      }
      applyToDom(next)
    },
    [storageKey]
  )

  // Keep the resolved theme in sync with system-preference or tab changes.
  useEffect(() => {
    const handler = () => {
      setResolvedTheme(resolve(theme))
      if (theme !== "system") return
      applyToDom(theme)
    }
    handler()
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    media.addEventListener("change", handler)
    return () => media.removeEventListener("change", handler)
  }, [theme])

  // Cross-tab sync: another tab changed the theme.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey || e.newValue == null) return
      const next = e.newValue as Theme
      if (next !== "light" && next !== "dark" && next !== "system") return
      setThemeState(next)
      setResolvedTheme(resolve(next))
      applyToDom(next)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [storageKey])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Reads the current theme; safe to call anywhere (defaults to system). */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    return { theme: "system", resolvedTheme: "light", setTheme: () => {} }
  }
  return ctx
}
