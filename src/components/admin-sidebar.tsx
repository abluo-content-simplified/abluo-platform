"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  FileText,
  Settings,
  User,
  LogOut,
  Monitor,
  Sun,
  Moon,
  Minus,
  Equal,
  Menu,
  ChevronDown,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useDensity } from "@/components/density-provider"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface NavItem {
  titleKey: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  badge?: number
}

const navigationItems: NavItem[] = [
  {
    titleKey: "nav.dashboard",
    icon: LayoutDashboard,
    href: "/admin",
    badge: 3,
  },
  {
    titleKey: "nav.clients",
    icon: Users,
    href: "/admin/clients",
  },
  {
    titleKey: "nav.projects",
    icon: FolderKanban,
    href: "/admin/projects",
  },
  {
    titleKey: "nav.content",
    icon: FileText,
    href: "/admin/content",
  },
  {
    titleKey: "nav.settings",
    icon: Settings,
    href: "/admin/settings",
  },
]

// Theme toggle component with pill style
function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const t = useTranslations("userMenu")

  return (
    <div className="flex items-center justify-between px-2 py-1.5">
      <span className="text-sm text-sidebar-foreground/70">{t("theme")}</span>
      <div className="flex items-center gap-0.5 rounded-full bg-sidebar-accent/50 p-0.5">
        <button
          onClick={() => setTheme("system")}
          className={cn(
            "flex size-7 items-center justify-center rounded-full transition-colors",
            theme === "system"
              ? "bg-sidebar text-sidebar-foreground shadow-sm"
              : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
          )}
          aria-label={t("system")}
        >
          <Monitor className="size-4" />
        </button>
        <button
          onClick={() => setTheme("light")}
          className={cn(
            "flex size-7 items-center justify-center rounded-full transition-colors",
            theme === "light"
              ? "bg-sidebar text-sidebar-foreground shadow-sm"
              : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
          )}
          aria-label={t("light")}
        >
          <Sun className="size-4" />
        </button>
        <button
          onClick={() => setTheme("dark")}
          className={cn(
            "flex size-7 items-center justify-center rounded-full transition-colors",
            theme === "dark"
              ? "bg-sidebar text-sidebar-foreground shadow-sm"
              : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
          )}
          aria-label={t("dark")}
        >
          <Moon className="size-4" />
        </button>
      </div>
    </div>
  )
}

// Density toggle component with pill style
function DensityToggle() {
  const { density, setDensity } = useDensity()
  const t = useTranslations("userMenu")

  return (
    <div className="flex items-center justify-between px-2 py-1.5">
      <span className="text-sm text-sidebar-foreground/70">{t("density")}</span>
      <div className="flex items-center gap-0.5 rounded-full bg-sidebar-accent/50 p-0.5">
        <button
          onClick={() => setDensity("compact")}
          className={cn(
            "flex size-7 items-center justify-center rounded-full transition-colors",
            density === "compact"
              ? "bg-sidebar text-sidebar-foreground shadow-sm"
              : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
          )}
          aria-label={t("compact")}
        >
          <Minus className="size-4" />
        </button>
        <button
          onClick={() => setDensity("comfortable")}
          className={cn(
            "flex size-7 items-center justify-center rounded-full transition-colors",
            density === "comfortable"
              ? "bg-sidebar text-sidebar-foreground shadow-sm"
              : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
          )}
          aria-label={t("comfortable")}
        >
          <Equal className="size-4" />
        </button>
        <button
          onClick={() => setDensity("large")}
          className={cn(
            "flex size-7 items-center justify-center rounded-full transition-colors",
            density === "large"
              ? "bg-sidebar text-sidebar-foreground shadow-sm"
              : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
          )}
          aria-label={t("large")}
        >
          <Menu className="size-4" />
        </button>
      </div>
    </div>
  )
}

export function AdminSidebar() {
  const pathname = usePathname()
  const t = useTranslations()
  const { state } = useSidebar()

  const isActive = (href: string) => {
    if (href === "/admin") {
      return pathname === "/admin"
    }
    return pathname.startsWith(href)
  }

  return (
    <Sidebar variant="floating" collapsible="icon">
      {/* Header with logo icon only */}
      <SidebarHeader>
        <div className="flex h-12 items-center px-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <span className="text-sm font-semibold">A</span>
          </div>
        </div>
      </SidebarHeader>

      {/* Main navigation content */}
      <SidebarContent className="pt-4">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={t(item.titleKey)}
                      render={<Link href={item.href} />}
                    >
                      <Icon />
                      <span>{t(item.titleKey)}</span>
                    </SidebarMenuButton>
                    {item.badge !== undefined && item.badge > 0 && (
                      <SidebarMenuBadge>
                        <Badge
                          variant="secondary"
                          className="size-5 justify-center rounded-full p-0 text-[10px]"
                        >
                          {item.badge}
                        </Badge>
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer with user menu */}
      <SidebarFooter className="mt-auto">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 outline-none transition-colors",
                  "hover:bg-sidebar-accent",
                  "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  state === "collapsed" && "justify-center"
                )}
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <span className="text-sm font-semibold">JD</span>
                </div>
                {state !== "collapsed" && (
                  <>
                    <div className="flex flex-1 flex-col items-start text-left">
                      <span className="text-sm font-medium text-sidebar-foreground">
                        John Doe
                      </span>
                      <span className="text-xs text-sidebar-foreground/60">
                        john@abluo.com
                      </span>
                    </div>
                    <ChevronDown className="size-4 text-sidebar-foreground/50" />
                  </>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuPositioner side="top" align="start" sideOffset={8}>
                  <DropdownMenuContent className="w-[240px]">
                    {/* User info header */}
                    <div className="flex items-center gap-2 px-2 py-2">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <span className="text-sm font-semibold">JD</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">John Doe</span>
                        <span className="text-xs text-muted-foreground">
                          john@abluo.com
                        </span>
                      </div>
                    </div>
                    <DropdownMenuSeparator />

                    {/* Account & Preferences */}
                    <DropdownMenuItem>
                      <User className="mr-2 size-4" />
                      {t("userMenu.account")}
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Settings className="mr-2 size-4" />
                      {t("userMenu.preferences")}
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    {/* Theme Toggle */}
                    <ThemeToggle />

                    {/* Density Toggle */}
                    <DensityToggle />

                    <DropdownMenuSeparator />

                    {/* Logout */}
                    <DropdownMenuItem className="text-destructive focus:text-destructive">
                      <LogOut className="mr-2 size-4" />
                      {t("userMenu.logOut")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenuPositioner>
              </DropdownMenuPortal>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* Rail for hover expand */}
      <SidebarRail />
    </Sidebar>
  )
}
