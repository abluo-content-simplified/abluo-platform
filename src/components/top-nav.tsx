"use client"

import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import {
  Search,
  Bell,
  Sun,
  Moon,
  Monitor,
  User,
  Users,
  Settings,
  LogOut,
  PanelLeftOpen,
  PanelLeftClose,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useSidebar } from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"

interface TopNavProps {
  className?: string
}

export function TopNav({ className }: TopNavProps) {
  const t = useTranslations("topNav")
  const { theme, setTheme } = useTheme()
  const { toggleSidebar, state, isMobile } = useSidebar()

  return (
    <header
      className={cn(
        "flex h-14 items-center justify-between gap-4 rounded-lg bg-sidebar px-4 shadow-sm ring-1 ring-sidebar-border",
        className
      )}
    >
      {/* Left side - Sidebar toggle */}
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label={t("toggleSidebar")}
        >
          {state === "collapsed" || isMobile ? (
            <PanelLeftOpen className="size-5" />
          ) : (
            <PanelLeftClose className="size-5" />
          )}
        </Button>
      </div>

      {/* Right side - Actions */}
      <div className="flex items-center">
        {/* Action group: Search, Notifications, Health, Theme */}
        <div className="flex items-center gap-2">
          {/* Search */}
          <Button
            variant="ghost"
            size="icon"
            className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label={t("search")}
          >
            <Search className="size-5" />
          </Button>

          {/* Notifications */}
          <Button
            variant="ghost"
            size="icon"
            className="relative text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label={t("notifications")}
          >
            <Bell className="size-5" />
            <Badge
              variant="default"
              className="absolute -top-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full p-0 text-[10px]"
            >
              5
            </Badge>
          </Button>

          {/* Health Status */}
          <div className="flex items-center gap-2 px-2">
            <span className="inline-flex size-2 rounded-full bg-green-500" />
            <span className="text-sm font-medium text-sidebar-foreground/65">
              {t("healthy")}
            </span>
          </div>

          {/* Theme Toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/70 outline-none transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                "focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              )}
              aria-label={t("theme")}
            >
              <Sun className="size-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute size-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuPositioner side="bottom" align="end">
              <DropdownMenuContent className="min-w-[140px]">
                <DropdownMenuRadioGroup
                  value={theme}
                  onValueChange={(value) => setTheme(value as string)}
                >
                  <DropdownMenuRadioItem value="system">
                    <Monitor className="mr-2 size-4" />
                    {t("system")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="light">
                    <Sun className="mr-2 size-4" />
                    {t("light")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <Moon className="mr-2 size-4" />
                    {t("dark")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenuPositioner>
          </DropdownMenuPortal>
        </DropdownMenu>
        </div>

        {/* Spacer */}
        <div className="w-4" />

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-2 py-1.5 outline-none transition-colors",
              "hover:bg-sidebar-accent",
              "focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            )}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span className="text-sm font-semibold">JD</span>
            </div>
            <span className="hidden text-sm font-medium text-sidebar-foreground md:inline-block">
              John Doe
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuPositioner side="bottom" align="end">
              <DropdownMenuContent className="min-w-[200px]">
                <DropdownMenuItem>
                  <User className="mr-2 size-4" />
                  {t("account")}
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Users className="mr-2 size-4" />
                  {t("impersonate")}
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings className="mr-2 size-4" />
                  {t("customerPreferences")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 size-4" />
                  {t("logOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPositioner>
          </DropdownMenuPortal>
        </DropdownMenu>
      </div>
    </header>
  )
}
