"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
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
  ChevronsUpDown,
  PanelLeft,
  PanelLeftClose,
  Columns2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useDensity } from "@/components/density-provider"
import { DelayedTooltip } from "@/components/ui/delayed-tooltip"
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

// Sidebar behavior options
type SidebarBehavior = "expanded" | "collapsed" | "hover"

// Sidebar behavior toggle component
function SidebarBehaviorToggle({
  behavior,
  onBehaviorChange,
}: {
  behavior: SidebarBehavior
  onBehaviorChange: (behavior: SidebarBehavior) => void
}) {
  const t = useTranslations("userMenu")

  return (
    <div className="flex items-center justify-between px-2 py-1.5">
      <span className="text-sm text-sidebar-foreground/70">{t("sidebar")}</span>
      <div className="flex items-center gap-0.5 rounded-full bg-sidebar-accent/50 p-0.5">
        <DelayedTooltip content={t("expanded")} side="top">
          <button
            onClick={() => onBehaviorChange("expanded")}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              behavior === "expanded"
                ? "bg-sidebar text-sidebar-foreground shadow-sm"
                : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
            )}
          >
            <PanelLeft className="size-4" />
          </button>
        </DelayedTooltip>
        <DelayedTooltip content={t("collapsed")} side="top">
          <button
            onClick={() => onBehaviorChange("collapsed")}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              behavior === "collapsed"
                ? "bg-sidebar text-sidebar-foreground shadow-sm"
                : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
            )}
          >
            <PanelLeftClose className="size-4" />
          </button>
        </DelayedTooltip>
        <DelayedTooltip content={t("expandOnHover")} side="top">
          <button
            onClick={() => onBehaviorChange("hover")}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              behavior === "hover"
                ? "bg-sidebar text-sidebar-foreground shadow-sm"
                : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
            )}
          >
            <Columns2 className="size-4" />
          </button>
        </DelayedTooltip>
      </div>
    </div>
  )
}

// Theme toggle component with pill style
function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const t = useTranslations("userMenu")

  return (
    <div className="flex items-center justify-between px-2 py-1.5">
      <span className="text-sm text-sidebar-foreground/70">{t("theme")}</span>
      <div className="flex items-center gap-0.5 rounded-full bg-sidebar-accent/50 p-0.5">
        <DelayedTooltip content={t("system")} side="top">
          <button
            onClick={() => setTheme("system")}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              theme === "system"
                ? "bg-sidebar text-sidebar-foreground shadow-sm"
                : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
            )}
          >
            <Monitor className="size-4" />
          </button>
        </DelayedTooltip>
        <DelayedTooltip content={t("light")} side="top">
          <button
            onClick={() => setTheme("light")}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              theme === "light"
                ? "bg-sidebar text-sidebar-foreground shadow-sm"
                : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
            )}
          >
            <Sun className="size-4" />
          </button>
        </DelayedTooltip>
        <DelayedTooltip content={t("dark")} side="top">
          <button
            onClick={() => setTheme("dark")}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              theme === "dark"
                ? "bg-sidebar text-sidebar-foreground shadow-sm"
                : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
            )}
          >
            <Moon className="size-4" />
          </button>
        </DelayedTooltip>
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
        <DelayedTooltip content={t("compact")} side="top">
          <button
            onClick={() => setDensity("compact")}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              density === "compact"
                ? "bg-sidebar text-sidebar-foreground shadow-sm"
                : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
            )}
          >
            <Minus className="size-4" />
          </button>
        </DelayedTooltip>
        <DelayedTooltip content={t("comfortable")} side="top">
          <button
            onClick={() => setDensity("comfortable")}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              density === "comfortable"
                ? "bg-sidebar text-sidebar-foreground shadow-sm"
                : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
            )}
          >
            <Equal className="size-4" />
          </button>
        </DelayedTooltip>
        <DelayedTooltip content={t("large")} side="top">
          <button
            onClick={() => setDensity("large")}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              density === "large"
                ? "bg-sidebar text-sidebar-foreground shadow-sm"
                : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
            )}
          >
            <Menu className="size-4" />
          </button>
        </DelayedTooltip>
      </div>
    </div>
  )
}

export function AdminSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations()
  const { state, setOpen } = useSidebar()
  const [sidebarBehavior, setSidebarBehavior] = React.useState<SidebarBehavior>("expanded")

  // Handle sidebar behavior changes
  const handleBehaviorChange = (behavior: SidebarBehavior) => {
    setSidebarBehavior(behavior)
    if (behavior === "expanded") {
      setOpen(true)
    } else if (behavior === "collapsed") {
      setOpen(false)
    }
    // "hover" behavior is handled by the SidebarRail component
  }

  const isActive = (href: string) => {
    if (href === "/admin") {
      return pathname === "/admin"
    }
    return pathname.startsWith(href)
  }

  // Handle logo click - go to dashboard or scroll to top if already there
  const handleLogoClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (pathname === "/admin") {
      // Already on dashboard, smooth scroll to top
      window.scrollTo({ top: 0, behavior: "smooth" })
    } else {
      // Navigate to dashboard
      router.push("/admin")
    }
  }

  return (
    <Sidebar variant="floating" collapsible="icon">
      {/* Header with logo */}
      <SidebarHeader>
        <button
          onClick={handleLogoClick}
          className="flex h-12 items-center px-2 transition-opacity hover:opacity-80"
        >
          {/* Logo icon - always visible, fixed size */}
          <Image
            src="/logo.svg"
            alt="Abluo"
            width={32}
            height={32}
            className="size-8 shrink-0"
          />
          {/* Logotype - with smooth fade/slide animation synced to sidebar transition */}
          <div
            className={cn(
              "ml-1 overflow-hidden transition-all duration-[220ms] ease-out",
              state === "collapsed"
                ? "w-0 opacity-0 -translate-x-2"
                : "w-[100px] opacity-100 translate-x-0"
            )}
          >
            <Image
              src="/abluo.svg"
              alt="Abluo"
              width={100}
              height={24}
              className="h-6 w-auto dark:hidden"
            />
            <Image
              src="/abluo-inv.svg"
              alt="Abluo"
              width={100}
              height={24}
              className="hidden h-6 w-auto dark:block"
            />
          </div>
        </button>
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
                      className={cn(
                        !active && "text-sidebar-foreground/70 [&>svg]:text-sidebar-foreground/60",
                        !active && "hover:text-sidebar-foreground hover:[&>svg]:text-sidebar-foreground"
                      )}
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
                    <ChevronsUpDown className="size-4 text-sidebar-foreground/50" />
                  </>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuPositioner side="top" align="start" sideOffset={8}>
                  <DropdownMenuContent className="w-[260px]">
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

                    {/* Sidebar Behavior Toggle */}
                    <SidebarBehaviorToggle
                      behavior={sidebarBehavior}
                      onBehaviorChange={handleBehaviorChange}
                    />

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
