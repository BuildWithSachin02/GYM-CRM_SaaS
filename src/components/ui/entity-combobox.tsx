"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown, Search, X } from "lucide-react"

import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export type EntityOption = {
  id: string
  label: string
  sublabel?: string
}

type EntityComboboxProps = {
  value: string
  onValueChange: (value: string) => void
  options: readonly EntityOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  allowClear?: boolean
  className?: string
  id?: string
  disabled?: boolean
}

export function EntityCombobox({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  allowClear = false,
  className,
  id,
  disabled = false,
}: EntityComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const selected = options.find((o) => o.id === value) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel?.toLowerCase().includes(q) ?? false)
    )
  }, [options, query])

  function handleSelect(option: EntityOption) {
    onValueChange(option.id)
    setOpen(false)
    setQuery("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="default"
            id={id}
            disabled={disabled}
            className={cn(
              "h-8 w-full justify-between font-normal data-placeholder:text-muted-foreground",
              !selected && "text-muted-foreground",
              className
            )}
          />
        }
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        {value && allowClear ? (
          <span
            role="button"
            className="pointer-events-auto shrink-0 rounded-sm hover:text-foreground"
            onPointerDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              onValueChange("")
              setQuery("")
            }}
          >
            <X className="size-4 text-muted-foreground" />
          </span>
        ) : (
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        )}
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-56 p-0" align="start">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 pl-9"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="px-2.5 py-3 text-center text-sm text-muted-foreground">
              {emptyText}
            </p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => handleSelect(o)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                  o.id === value && "bg-muted font-medium"
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.sublabel && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {o.sublabel}
                    </span>
                  )}
                </span>
                {o.id === value && (
                  <Check className="size-4 shrink-0 text-primary" />
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}