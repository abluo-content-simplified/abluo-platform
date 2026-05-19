"use client"

import { useState, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { Search, X, ExternalLink, CornerDownLeft } from "lucide-react"
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTitle,
} from "@/components/ui/dialog"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "@/lib/utils"

type SearchFilter = "all" | "clients" | "projects" | "content" | "leads"

interface CommandSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const filterIcons: Record<SearchFilter, string> = {
  all: "All",
  clients: "Clients",
  projects: "Projects",
  content: "Content",
  leads: "Leads",
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
  const t = useTranslations()
  const [query, setQuery] = useState("")
  const [selectedFilter, setSelectedFilter] = useState<SearchFilter>("all")
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
    } else {
      // Reset state when closing
      setQuery("")
      setSelectedFilter("all")
    }
  }, [open])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        onOpenChange(true)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onOpenChange])

  const filters: SearchFilter[] = ["all", "clients", "projects", "content", "leads"]

  const getPlaceholder = () => {
    if (selectedFilter === "all") {
      return t("commandSearch.placeholder")
    }
    return t(`commandSearch.searchFilter`, { filter: t(`commandSearch.filters.${selectedFilter}`) })
  }

  const clearQuery = () => {
    setQuery("")
    inputRef.current?.focus()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-sm" />
        <DialogPrimitive.Popup
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-background shadow-xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          <DialogTitle className="sr-only">{t("commandSearch.title")}</DialogTitle>
        
        {/* Search input area */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="size-5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={getPlaceholder()}
            className="flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {query && (
            <button
              onClick={clearQuery}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("commandSearch.clear")}
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 border-b border-border px-4 py-2">
          {filters.map((filter) => (
            <button
              key={filter}
              onClick={() => setSelectedFilter(filter)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                selectedFilter === filter
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {t(`commandSearch.filters.${filter}`)}
            </button>
          ))}
        </div>

        {/* Results area - placeholder for now */}
        <div className="min-h-[200px] p-4">
          <p className="text-center text-sm text-muted-foreground">
            {query
              ? t("commandSearch.noResults")
              : t("commandSearch.startTyping")}
          </p>
        </div>

        {/* Footer with actions */}
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <kbd className="flex size-5 items-center justify-center rounded border border-border bg-background font-mono text-[10px]">
                <CornerDownLeft className="size-3" />
              </kbd>
              <span>{t("commandSearch.actions.open")}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <kbd className="flex size-5 items-center justify-center rounded border border-border bg-background font-mono text-[10px]">
                <ExternalLink className="size-3" />
              </kbd>
              <span>{t("commandSearch.actions.openNewTab")}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <kbd className="flex h-5 items-center justify-center rounded border border-border bg-background px-1 font-mono text-[10px]">
                ↑↓
              </kbd>
              <span>{t("commandSearch.actions.navigate")}</span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
              ⌘K
            </kbd>
          </div>
        </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
