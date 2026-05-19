"use client"

import { useTranslations } from "next-intl"
import {
  PanelLeft,
  Search,
  Bell,
  User,
  LogOut,
  UserCog,
  Settings2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSidebar } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type HealthStatus = "healthy" | "degraded" | "critical"

interface AdminTopNavProps {
  notificationCount?: number
  healthStatus?: HealthStatus
  user?: {
    name: string
    email?: string
    avatarUrl?: string
  }
}

const healthStatusColors: Record<HealthStatus, string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  critical: "bg-red-500",
}

export function AdminTopNav({
  notificationCount = 0,
  healthStatus = "healthy",
  user = { name: "John Doe", email: "john@example.com" },
}: AdminTopNavProps) {
  const t = useTranslations()
  const { toggleSidebar } = useSidebar()

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
      {/* Left side - Panel toggle */}
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="size-9 text-muted-foreground hover:text-foreground"
              aria-label={t("topNav.togglePanel")}
            >
              <PanelLeft />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("topNav.togglePanel")}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Right side - Actions */}
      <div className="flex items-center gap-1">
        {/* Search */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-muted-foreground hover:text-foreground"
              aria-label={t("topNav.search")}
            >
              <Search />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("topNav.search")}</TooltipContent>
        </Tooltip>

        {/* Notifications */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative size-9 text-muted-foreground hover:text-foreground"
              aria-label={t("topNav.notifications")}
            >
              <Bell />
              {notificationCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -right-0.5 -top-0.5 size-5 justify-center rounded-full p-0 text-[10px]"
                >
                  {notificationCount > 99 ? "99+" : notificationCount}
                </Badge>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("topNav.notifications")}
          </TooltipContent>
        </Tooltip>

        {/* Health Status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-muted-foreground hover:text-foreground"
              aria-label={t(`topNav.health.${healthStatus}`)}
            >
              <span
                className={cn(
                  "size-2.5 rounded-full",
                  healthStatusColors[healthStatus]
                )}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t(`topNav.health.${healthStatus}`)}
          </TooltipContent>
        </Tooltip>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="ml-1 flex h-9 items-center gap-2 px-2 text-muted-foreground hover:text-foreground"
            >
              <Avatar className="size-7">
                <AvatarImage src={user.avatarUrl} alt={user.name} />
                <AvatarFallback className="bg-muted text-xs">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium text-foreground sm:inline-block">
                {user.name}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <User data-icon="inline-start" />
                {t("topNav.menu.account")}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <UserCog data-icon="inline-start" />
                {t("topNav.menu.impersonate")}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings2 data-icon="inline-start" />
                {t("topNav.menu.customerPreferences")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive">
              <LogOut data-icon="inline-start" />
              {t("topNav.menu.logOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
