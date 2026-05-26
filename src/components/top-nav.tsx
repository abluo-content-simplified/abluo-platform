"use client"

import * as React from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import {
  Search,
  Bell,
  Building2,
  FolderKanban,
  Plus,
  PanelLeftOpen,
  PanelLeftClose,
  CornerDownLeft,
  ExternalLink,
  ArrowUpDown,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EntitySwitcher } from "@/components/ui/entity-switcher"

interface TopNavProps {
  className?: string
}

// Mock data for customers and projects
const mockCustomers = [
  { id: "1", name: "Acme Corp", projectCount: 3 },
  { id: "2", name: "Globex Inc", projectCount: 1 },
  { id: "3", name: "Initech", projectCount: 2 },
]

const mockProjects = [
  { id: "1", name: "Website Redesign", customerId: "1" },
  { id: "2", name: "Mobile App", customerId: "1" },
  { id: "3", name: "Marketing Campaign", customerId: "1" },
  { id: "4", name: "Brand Identity", customerId: "2" },
  { id: "5", name: "Product Launch", customerId: "3" },
  { id: "6", name: "Annual Report", customerId: "3" },
]

// Search filter types
type SearchFilter = "all" | "clients" | "projects" | "content" | "leads"

// Detect OS for keyboard shortcut display
function useKeyboardShortcut() {
  const [isMac, setIsMac] = React.useState(true)

  React.useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf("MAC") >= 0)
  }, [])

  return { isMac, shortcut: isMac ? "⌘K" : "Ctrl+K" }
}

// Search Overlay Component
function SearchOverlay({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations("search")
  const [query, setQuery] = React.useState("")
  const [filter, setFilter] = React.useState<SearchFilter>("all")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const tabsContainerRef = React.useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = React.useState({ left: 0, width: 0 })
  const { isMac, shortcut } = useKeyboardShortcut()

  const filters: { key: SearchFilter; label: string }[] = [
    { key: "all", label: t("all") },
    { key: "clients", label: t("clients") },
    { key: "projects", label: t("projects") },
    { key: "content", label: t("content") },
    { key: "leads", label: t("leads") },
  ]

  // Get dynamic placeholder based on filter
  const getPlaceholder = () => {
    switch (filter) {
      case "clients":
        return t("searchClients")
      case "projects":
        return t("searchProjects")
      case "content":
        return t("searchContent")
      case "leads":
        return t("searchLeads")
      default:
        return t("placeholder")
    }
  }

  // Update indicator position when filter changes
  React.useEffect(() => {
    if (tabsContainerRef.current) {
      const activeButton = tabsContainerRef.current.querySelector(
        `[data-filter="${filter}"]`
      ) as HTMLButtonElement
      if (activeButton) {
        const containerRect = tabsContainerRef.current.getBoundingClientRect()
        const buttonRect = activeButton.getBoundingClientRect()
        const buttonWidth = buttonRect.width * 0.85 // 15% narrower
        const buttonLeft = buttonRect.left - containerRect.left + (buttonRect.width * 0.075) // Center the narrower line
        setIndicatorStyle({ left: buttonLeft, width: buttonWidth })
      }
    }
  }, [filter, open])

  // Focus input when opened
  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // Handle keyboard shortcut
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        onOpenChange(!open)
      }
      if (e.key === "Escape" && open) {
        e.preventDefault()
        onOpenChange(false)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop with very subtle blur - content should remain visible */}
      <div
        className="absolute inset-0 bg-background/40 backdrop-blur-[2px]"
        onClick={() => onOpenChange(false)}
      />

      {/* Search Modal */}
      <div className="flex items-start justify-center pt-[15vh]">
        <div
          className={cn(
            "relative w-full max-w-2xl mx-4",
            "rounded-xl border border-border bg-background/80 backdrop-blur-sm shadow-2xl",
            "animate-in fade-in-0 zoom-in-95 duration-(--motion-normal)"
          )}
        >
          {/* Search Input */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <Search className="size-5 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              placeholder={getPlaceholder()}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Filter Tabs with underline indicator */}
          <div ref={tabsContainerRef} className="relative flex items-center gap-1 px-4 py-1.5">
            {filters.map((f) => (
              <button
                key={f.key}
                data-filter={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "relative px-3 py-1 text-sm transition-colors",
                  filter === f.key
                    ? "font-semibold text-foreground"
                    : "font-medium text-muted-foreground hover:text-foreground"
                )}
              >
                {f.label}
              </button>
            ))}
            {/* Animated underline indicator - 2px height, 85% width, 80% opacity */}
            <span
              className="absolute bottom-0 h-0.5 rounded-full bg-foreground/80 transition-all duration-(--motion-fast) ease-out"
              style={{
                left: indicatorStyle.left,
                width: indicatorStyle.width,
              }}
            />
            {/* Separator line below tabs */}
            <div className="absolute bottom-0 left-0 right-0 h-px bg-border" />
          </div>

          {/* Results Area */}
          <div className="min-h-[200px] flex items-center justify-center p-8">
            <p className="text-sm text-muted-foreground/60">
              {t("emptyState")}
            </p>
          </div>

          {/* Footer with keyboard shortcuts */}
          <div className="flex items-center justify-end border-t border-border px-4 py-2">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CornerDownLeft className="size-3" />
                {t("open")}
              </span>
              <span className="flex items-center gap-1">
                <ExternalLink className="size-3" />
                {t("openNewTab")}
              </span>
              <span className="flex items-center gap-1">
                <ArrowUpDown className="size-3" />
                {t("navigate")}
              </span>
              <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {shortcut}
              </kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Customer Switcher Component
function CustomerSwitcher() {
  const t = useTranslations("topNav")
  const [selectedCustomer, setSelectedCustomer] = React.useState(mockCustomers[0])

  return (
    <EntitySwitcher
      icon={<Building2 className="size-4" />}
      selected={selectedCustomer}
      items={mockCustomers}
      onSelect={setSelectedCustomer}
      linkPattern="/admin/clients/{id}"
      searchPlaceholder={t("findCustomer")}
      maxWidth="120px"
      actions={[
        {
          icon: <Building2 className="size-4" />,
          label: t("allCustomers"),
          href: "/admin/clients",
        },
        {
          icon: <Plus className="size-4" />,
          label: t("addCustomer"),
          href: "/admin/clients/new",
        },
      ]}
    />
  )
}

// Project Switcher Component
function ProjectSwitcher({ customerId }: { customerId: string }) {
  const t = useTranslations("topNav")
  const customerProjects = mockProjects.filter((p) => p.customerId === customerId)
  const [selectedProject, setSelectedProject] = React.useState(customerProjects[0])

  // Don't render if customer has no projects
  if (customerProjects.length === 0) return null

  return (
    <>
      <span className="text-sidebar-foreground/30">/</span>
      <EntitySwitcher
        icon={<FolderKanban className="size-4" />}
        selected={selectedProject}
        items={customerProjects}
        onSelect={setSelectedProject}
        linkPattern="/admin/projects/{id}"
        searchPlaceholder={t("findProject")}
        maxWidth="140px"
        fallbackText="Select Project"
        actions={[
          {
            icon: <FolderKanban className="size-4" />,
            label: t("allProjects"),
            href: "/admin/projects",
          },
          {
            icon: <Plus className="size-4" />,
            label: t("addProject"),
            href: "/admin/projects/new",
          },
        ]}
      />
    </>
  )
}

export function TopNav({ className }: TopNavProps) {
  const t = useTranslations("topNav")
  const { toggleSidebar, state, isMobile } = useSidebar()
  const { shortcut } = useKeyboardShortcut()
  const [searchOpen, setSearchOpen] = React.useState(false)

  // For demo, using first customer's ID
  const selectedCustomerId = mockCustomers[0].id

  return (
    <>
      <header
        className={cn(
          "flex h-14 items-center justify-between gap-4 rounded-lg bg-[var(--surface-topnav)] backdrop-blur-sm px-3 shadow-sm ring-1 ring-sidebar-border/50",
          className
        )}
      >
        {/* Left side - Sidebar toggle + Customer/Project switchers */}
        <div className="flex items-center gap-1">
          {/* Sidebar Toggle */}
          <button
            onClick={toggleSidebar}
            className={cn(
              "flex size-8 items-center justify-center rounded-md transition-colors",
              "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
            aria-label={t("toggleSidebar")}
          >
            {state === "collapsed" || isMobile ? (
              <PanelLeftOpen className="size-5" />
            ) : (
              <PanelLeftClose className="size-5" />
            )}
          </button>

          {/* Separator */}
          <div className="mx-1 h-5 w-px bg-sidebar-border" />

          {/* Customer Switcher */}
          <CustomerSwitcher />

          {/* Project Switcher (shows if customer has projects) */}
          <ProjectSwitcher customerId={selectedCustomerId} />
        </div>

        {/* Right side - Search + Actions */}
        <div className="flex items-center gap-2">
          {/* Search Pill */}
          <button
            onClick={() => setSearchOpen(true)}
            className={cn(
              "flex items-center gap-2 rounded-full border border-sidebar-border/50 bg-sidebar-accent/30 px-3 py-1.5 transition-colors",
              "text-sidebar-foreground/50 hover:border-sidebar-border hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/70"
            )}
          >
            <Search className="size-4" />
            <span className="text-sm">{t("searchPlaceholder")}</span>
            <kbd className="ml-2 rounded bg-sidebar-accent/80 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/50">
              {shortcut}
            </kbd>
          </button>

          {/* Notifications - Subtle circular button */}
          <button
            className={cn(
              "relative flex size-8 items-center justify-center rounded-full border border-transparent transition-colors",
              "text-sidebar-foreground/40 hover:border-sidebar-border/50 hover:text-sidebar-foreground/60"
            )}
            aria-label={t("notifications")}
          >
            <Bell className="size-4" />
            {/* Notification dot */}
            <span className="absolute -top-0.5 -right-0.5 flex size-2">
              <span className="absolute inline-flex size-full rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-destructive" />
            </span>
          </button>

          {/* Healthy Status - Subtle circular treatment */}
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full border border-transparent px-2 py-1 transition-colors",
              "text-sidebar-foreground/40 hover:border-sidebar-border/50"
            )}
          >
            <span className="inline-flex size-2 rounded-full bg-green-500" />
            <span className="text-xs font-medium text-sidebar-foreground/50">
              {t("healthy")}
            </span>
          </div>
        </div>
      </header>

      {/* Search Overlay */}
      <SearchOverlay open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  )
}
