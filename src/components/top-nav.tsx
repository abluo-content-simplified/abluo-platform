"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  Search,
  Bell,
  Building2,
  FolderKanban,
  ChevronDown,
  Check,
  Plus,
  PanelLeftOpen,
  PanelLeftClose,
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

// Detect OS for keyboard shortcut display
function useKeyboardShortcut() {
  const [isMac, setIsMac] = React.useState(true)

  React.useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf("MAC") >= 0)
  }, [])

  return isMac ? "⌘K" : "Ctrl+K"
}

// Customer Switcher Component
function CustomerSwitcher() {
  const t = useTranslations("topNav")
  const [selectedCustomer, setSelectedCustomer] = React.useState(mockCustomers[0])
  const [searchQuery, setSearchQuery] = React.useState("")

  const filteredCustomers = mockCustomers.filter((customer) =>
    customer.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm outline-none transition-colors",
          "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          "focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        )}
      >
        <Building2 className="size-4 text-sidebar-foreground/60" />
        <span className="max-w-[120px] truncate font-medium">
          {selectedCustomer.name}
        </span>
        <ChevronDown className="size-3.5 text-sidebar-foreground/50" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner side="bottom" align="start" sideOffset={8}>
          <DropdownMenuContent className="w-[240px]">
            {/* Search */}
            <div className="flex items-center gap-2 px-2 py-2">
              <Search className="size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={t("findCustomer")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <DropdownMenuSeparator />

            {/* Customer list */}
            {filteredCustomers.map((customer) => (
              <DropdownMenuItem
                key={customer.id}
                onClick={() => setSelectedCustomer(customer)}
                className="flex items-center justify-between"
              >
                <span>{customer.name}</span>
                {customer.id === selectedCustomer.id && (
                  <Check className="size-4" />
                )}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />

            {/* Actions */}
            <DropdownMenuItem>
              <Building2 className="mr-2 size-4" />
              {t("allCustomers")}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Plus className="mr-2 size-4" />
              {t("addCustomer")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenu>
  )
}

// Project Switcher Component
function ProjectSwitcher({ customerId }: { customerId: string }) {
  const t = useTranslations("topNav")
  const customerProjects = mockProjects.filter((p) => p.customerId === customerId)
  const [selectedProject, setSelectedProject] = React.useState(customerProjects[0])
  const [searchQuery, setSearchQuery] = React.useState("")

  // Don't render if customer has no projects
  if (customerProjects.length === 0) return null

  const filteredProjects = customerProjects.filter((project) =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <>
      <span className="text-sidebar-foreground/30">/</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm outline-none transition-colors",
            "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            "focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          )}
        >
          <FolderKanban className="size-4 text-sidebar-foreground/60" />
          <span className="max-w-[140px] truncate font-medium">
            {selectedProject?.name || "Select Project"}
          </span>
          <ChevronDown className="size-3.5 text-sidebar-foreground/50" />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner side="bottom" align="start" sideOffset={8}>
            <DropdownMenuContent className="w-[240px]">
              {/* Search */}
              <div className="flex items-center gap-2 px-2 py-2">
                <Search className="size-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={t("findProject")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <DropdownMenuSeparator />

              {/* Project list */}
              {filteredProjects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => setSelectedProject(project)}
                  className="flex items-center justify-between"
                >
                  <span>{project.name}</span>
                  {project.id === selectedProject?.id && (
                    <Check className="size-4" />
                  )}
                </DropdownMenuItem>
              ))}

              <DropdownMenuSeparator />

              {/* Actions */}
              <DropdownMenuItem>
                <FolderKanban className="mr-2 size-4" />
                {t("allProjects")}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Plus className="mr-2 size-4" />
                {t("addProject")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenu>
    </>
  )
}

export function TopNav({ className }: TopNavProps) {
  const t = useTranslations("topNav")
  const { toggleSidebar, state, isMobile } = useSidebar()
  const keyboardShortcut = useKeyboardShortcut()

  // For demo, using first customer's ID
  const selectedCustomerId = mockCustomers[0].id

  return (
    <header
      className={cn(
        "flex h-14 items-center justify-between gap-4 rounded-lg bg-sidebar px-3 shadow-sm ring-1 ring-sidebar-border",
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
          className={cn(
            "flex items-center gap-2 rounded-full border border-sidebar-border/50 bg-sidebar-accent/30 px-3 py-1.5 transition-colors",
            "text-sidebar-foreground/50 hover:border-sidebar-border hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/70"
          )}
          onClick={() => {
            // TODO: Open command palette / search
          }}
        >
          <Search className="size-4" />
          <span className="text-sm">{t("searchPlaceholder")}</span>
          <kbd className="ml-2 rounded bg-sidebar-accent/80 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/50">
            {keyboardShortcut}
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
  )
}
