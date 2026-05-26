"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  Menu,
  X,
  ChevronDown,
  Check,
  Plus,
  LayoutDashboard,
  Users,
  FolderKanban,
  FileText,
  Settings,
  Building2,
  User,
  LogOut,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

// Mock data - same as top-nav
const mockCustomers = [
  { id: "1", name: "Acme Corp" },
  { id: "2", name: "Globex Inc" },
  { id: "3", name: "Initech" },
]

const mockProjects = [
  { id: "1", name: "Website Redesign", customerId: "1" },
  { id: "2", name: "Mobile App", customerId: "1" },
  { id: "3", name: "Marketing Campaign", customerId: "1" },
  { id: "4", name: "Brand Identity", customerId: "2" },
  { id: "5", name: "Product Launch", customerId: "3" },
  { id: "6", name: "Annual Report", customerId: "3" },
]

// Navigation items - same as admin-sidebar
const navigationItems = [
  { titleKey: "nav.dashboard", icon: LayoutDashboard, href: "/admin", badge: 3 },
  { titleKey: "nav.clients", icon: Users, href: "/admin/clients" },
  { titleKey: "nav.projects", icon: FolderKanban, href: "/admin/projects" },
  { titleKey: "nav.content", icon: FileText, href: "/admin/content" },
  { titleKey: "nav.settings", icon: Settings, href: "/admin/settings" },
]

type ExpandedSection = "none" | "user" | "company" | "project"

export function MobileNav() {
  const pathname = usePathname()
  const t = useTranslations()
  const [isOpen, setIsOpen] = React.useState(false)
  const [expandedSection, setExpandedSection] = React.useState<ExpandedSection>("none")
  const [selectedCompany, setSelectedCompany] = React.useState(mockCustomers[0])
  const [selectedProject, setSelectedProject] = React.useState(mockProjects[0])

  // Get projects for selected company
  const companyProjects = mockProjects.filter((p) => p.customerId === selectedCompany.id)

  // Reset expanded section when closing
  React.useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => setExpandedSection("none"), 250)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Close nav on route change
  React.useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  // Prevent body scroll when open
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [isOpen])

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin"
    return pathname.startsWith(href)
  }

  const toggleSection = (section: ExpandedSection) => {
    setExpandedSection((current) => (current === section ? "none" : section))
  }

  const handleCompanySelect = (company: typeof mockCustomers[0]) => {
    setSelectedCompany(company)
    // Reset project to first of new company
    const newProjects = mockProjects.filter((p) => p.customerId === company.id)
    if (newProjects.length > 0) {
      setSelectedProject(newProjects[0])
    }
    setExpandedSection("none")
  }

  const handleProjectSelect = (project: typeof mockProjects[0]) => {
    setSelectedProject(project)
    setExpandedSection("none")
  }

  return (
    <>
      {/* FAB Trigger - Mobile only */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex size-14 items-center justify-center rounded-full",
          "bg-[var(--brand)] text-[var(--brand-foreground)]",
          "shadow-lg shadow-black/20",
          "backdrop-blur-sm",
          "transition-transform duration-(--motion-normal) active:scale-95",
          "md:hidden"
        )}
        aria-label={isOpen ? "Close navigation" : "Open navigation"}
      >
        <div className="relative size-6">
          <Menu
            className={cn(
              "absolute inset-0 size-6 transition-all duration-(--motion-normal)",
              isOpen ? "rotate-180 opacity-0 scale-50" : "rotate-0 opacity-100 scale-100"
            )}
          />
          <X
            className={cn(
              "absolute inset-0 size-6 transition-all duration-(--motion-normal)",
              isOpen ? "rotate-0 opacity-100 scale-100" : "-rotate-180 opacity-0 scale-50"
            )}
          />
        </div>
      </button>

      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-(--motion-normal) md:hidden",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />

      {/* Navigation Panel */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-40 w-[90vw] max-w-[400px]",
          "bg-[var(--surface-sidebar)] backdrop-blur-md",
          "shadow-2xl",
          "transition-transform duration-(--motion-normal) ease-out",
          "md:hidden",
          "flex flex-col",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header - Logo & Version */}
        <div className="flex flex-col gap-1 px-6 pt-6 pb-3">
          <div className="flex items-center gap-2">
            <Image src="/logo.svg" alt="Abluo" width={28} height={28} className="size-7" />
            <Image
              src="/abluo.svg"
              alt="Abluo"
              width={80}
              height={20}
              className="h-5 w-auto dark:hidden"
            />
            <Image
              src="/abluo-inv.svg"
              alt="Abluo"
              width={80}
              height={20}
              className="hidden h-5 w-auto dark:block"
            />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            <div>Content Simplified</div>
            <div className="mt-0.5 opacity-60">Version 0.1.0</div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {/* User Section - Expandable */}
          <div className="px-4 py-2">
            <button
              onClick={() => toggleSection("user")}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-sidebar-accent"
            >
              <Avatar className="size-5 mt-0.5">
                <AvatarFallback className="bg-[var(--brand)] text-[var(--brand-foreground)] text-[10px]">JD</AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left">
                <div className="font-medium leading-tight">John Doe</div>
                <div className="text-xs text-muted-foreground">john@abluo.com</div>
              </div>
              <ChevronDown
                className={cn(
                  "size-4 mt-0.5 text-muted-foreground transition-transform duration-(--motion-fast)",
                  expandedSection === "user" && "rotate-180"
                )}
              />
            </button>

            {/* User Expanded Content */}
            <div
              className={cn(
                "overflow-hidden transition-all duration-(--motion-normal) ease-out",
                expandedSection === "user" ? "max-h-40 opacity-100" : "max-h-0 opacity-0"
              )}
            >
              <div className="ml-8 space-y-1 py-1">
                <Link
                  href="/admin/profile"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  <User className="size-4" />
                  Profile
                </Link>
                <Link
                  href="/admin/settings/account"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  <Settings className="size-4" />
                  Account settings
                </Link>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="mx-4 my-1 h-px bg-border" />

          {/* Company Switcher - Expandable */}
          <div className="px-4 py-1">
            <button
              onClick={() => toggleSection("company")}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-sidebar-accent"
            >
              <Building2 className="size-5 mt-0.5 text-muted-foreground" />
              <div className="flex-1 text-left">
                <div className="text-xs text-muted-foreground leading-tight">Company</div>
                <div className="font-medium">{selectedCompany.name}</div>
              </div>
              <ChevronDown
                className={cn(
                  "size-4 mt-0.5 text-muted-foreground transition-transform duration-(--motion-fast)",
                  expandedSection === "company" && "rotate-180"
                )}
              />
            </button>

            {/* Company Expanded Content */}
            <div
              className={cn(
                "overflow-hidden transition-all duration-(--motion-normal) ease-out",
                expandedSection === "company" ? "max-h-80 opacity-100" : "max-h-0 opacity-0"
              )}
            >
              <div className="ml-8 space-y-0.5 py-1">
                {mockCustomers.map((company) => (
                  <button
                    key={company.id}
                    onClick={() => handleCompanySelect(company)}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
                  >
                    <span className={cn(selectedCompany.id === company.id && "font-medium")}>
                      {company.name}
                    </span>
                    {selectedCompany.id === company.id && (
                      <Check className="size-4 text-[var(--brand)]" />
                    )}
                  </button>
                ))}
                <div className="my-1 h-px bg-border/50" />
                <Link
                  href="/admin/clients"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  <Building2 className="size-4" />
                  View all companies
                </Link>
                <Link
                  href="/admin/clients/new"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  <Plus className="size-4" />
                  Add company
                </Link>
              </div>
            </div>
          </div>

          {/* Project Switcher - Expandable */}
          <div className="px-4 py-1">
            <button
              onClick={() => toggleSection("project")}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-sidebar-accent"
            >
              <FolderKanban className="size-5 mt-0.5 text-muted-foreground" />
              <div className="flex-1 text-left">
                <div className="text-xs text-muted-foreground leading-tight">Project</div>
                <div className="font-medium">{selectedProject?.name || "Select project"}</div>
              </div>
              <ChevronDown
                className={cn(
                  "size-4 mt-0.5 text-muted-foreground transition-transform duration-(--motion-fast)",
                  expandedSection === "project" && "rotate-180"
                )}
              />
            </button>

            {/* Project Expanded Content */}
            <div
              className={cn(
                "overflow-hidden transition-all duration-(--motion-normal) ease-out",
                expandedSection === "project" ? "max-h-80 opacity-100" : "max-h-0 opacity-0"
              )}
            >
              <div className="ml-8 space-y-0.5 py-1">
                {companyProjects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => handleProjectSelect(project)}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
                  >
                    <span className={cn(selectedProject?.id === project.id && "font-medium")}>
                      {project.name}
                    </span>
                    {selectedProject?.id === project.id && (
                      <Check className="size-4 text-[var(--brand)]" />
                    )}
                  </button>
                ))}
                <div className="my-1 h-px bg-border/50" />
                <Link
                  href="/admin/projects"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  <FolderKanban className="size-4" />
                  View all projects
                </Link>
                <Link
                  href="/admin/projects/new"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  <Plus className="size-4" />
                  Add project
                </Link>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="mx-4 my-2 h-px bg-border" />

          {/* Main Navigation */}
          <nav className="px-4 py-2">
            {navigationItems.map((item) => {
              const Icon = item.icon
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors",
                    "min-h-[48px]",
                    active
                      ? "bg-sidebar-accent text-[var(--brand)]"
                      : "text-sidebar-foreground hover:bg-sidebar-accent"
                  )}
                >
                  <Icon className={cn("size-5", active && "text-[var(--brand)]")} />
                  <span>{t(item.titleKey)}</span>
                  {item.badge && (
                    <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-[var(--brand)] text-[10px] font-semibold text-[var(--brand-foreground)]">
                      {item.badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Safe area padding for iOS */}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    </>
  )
}
