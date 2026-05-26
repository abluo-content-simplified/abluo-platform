"use client"

import * as React from "react"
import Link from "next/link"
import { Check, ChevronsUpDown, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface EntityItem {
  id: string
  name: string
}

export interface EntityAction {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  href?: string
}

interface EntitySwitcherProps<T extends EntityItem> {
  /** Icon displayed next to the entity name */
  icon: React.ReactNode
  /** Currently selected entity */
  selected: T | null
  /** All available entities */
  items: T[]
  /** Called when user selects a different entity */
  onSelect: (item: T) => void
  /** URL pattern for the entity link - {id} will be replaced with entity id */
  linkPattern: string
  /** Placeholder for search input */
  searchPlaceholder: string
  /** Actions shown at bottom of dropdown */
  actions: EntityAction[]
  /** Maximum width for the name text */
  maxWidth?: string
  /** Fallback text when no entity selected */
  fallbackText?: string
}

export function EntitySwitcher<T extends EntityItem>({
  icon,
  selected,
  items,
  onSelect,
  linkPattern,
  searchPlaceholder,
  actions,
  maxWidth = "120px",
  fallbackText = "Select...",
}: EntitySwitcherProps<T>) {
  const [searchQuery, setSearchQuery] = React.useState("")

  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const href = selected ? linkPattern.replace("{id}", selected.id) : "#"

  return (
    <div className="flex items-center">
      {/* Clickable icon + name - navigates to entity page */}
      <Link
        href={href}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors",
          "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <span className="shrink-0 text-sidebar-foreground/60">{icon}</span>
        <span className={cn("min-w-0 truncate font-medium")} style={{ maxWidth }}>
          {selected?.name || fallbackText}
        </span>
      </Link>

      {/* Dropdown trigger - separate chevron */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex size-6 items-center justify-center rounded-md transition-colors",
            "text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            "focus-visible:ring-2 focus-visible:ring-sidebar-ring outline-none"
          )}
        >
          <ChevronsUpDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner side="bottom" align="start" sideOffset={8}>
            <DropdownMenuContent className="w-[240px]">
              {/* Search */}
              <div className="flex items-center gap-2 px-2 py-2">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <DropdownMenuSeparator />

              {/* Item list */}
              {filteredItems.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  onClick={() => onSelect(item)}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="min-w-0 truncate">{item.name}</span>
                  {item.id === selected?.id && <Check className="size-4 shrink-0" />}
                </DropdownMenuItem>
              ))}

              <DropdownMenuSeparator />

              {/* Actions */}
              {actions.map((action, index) => (
                <DropdownMenuItem
                  key={index}
                  onClick={action.onClick}
                  asChild={!!action.href}
                >
                  {action.href ? (
                    <Link href={action.href} className="flex items-center gap-2">
                      <span className="shrink-0">{action.icon}</span>
                      <span className="min-w-0 truncate">{action.label}</span>
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="shrink-0">{action.icon}</span>
                      <span className="min-w-0 truncate">{action.label}</span>
                    </div>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenu>
    </div>
  )
}
