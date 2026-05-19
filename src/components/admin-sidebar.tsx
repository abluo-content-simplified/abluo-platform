"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  LayoutDashboard,
  Users,
  UserPlus,
  FolderKanban,
  FolderPlus,
  FileText,
  Settings,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
} from "@/components/ui/sidebar"

interface NavItem {
  titleKey: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  badge?: number
}

interface NavGroup {
  labelKey?: string
  items: NavItem[]
}

const navigationGroups: NavGroup[] = [
  {
    items: [
      {
        titleKey: "nav.dashboard",
        icon: LayoutDashboard,
        href: "/admin",
        badge: 3,
      },
    ],
  },
  {
    labelKey: "nav.clients",
    items: [
      {
        titleKey: "nav.allClients",
        icon: Users,
        href: "/admin/clients",
      },
      {
        titleKey: "nav.addClient",
        icon: UserPlus,
        href: "/admin/clients/new",
      },
    ],
  },
  {
    labelKey: "nav.projects",
    items: [
      {
        titleKey: "nav.allProjects",
        icon: FolderKanban,
        href: "/admin/projects",
      },
      {
        titleKey: "nav.addProject",
        icon: FolderPlus,
        href: "/admin/projects/new",
      },
    ],
  },
  {
    labelKey: "nav.content",
    items: [
      {
        titleKey: "nav.browseContent",
        icon: FileText,
        href: "/admin/content",
      },
    ],
  },
]

const settingsItem: NavItem = {
  titleKey: "nav.settings",
  icon: Settings,
  href: "/admin/settings",
}

export function AdminSidebar() {
  const pathname = usePathname()
  const t = useTranslations()

  const isActive = (href: string) => {
    if (href === "/admin") {
      return pathname === "/admin"
    }
    return pathname.startsWith(href)
  }

  return (
    <Sidebar variant="floating" collapsible="icon">
      {/* Header with logo */}
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex h-12 items-center gap-2 px-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <span className="text-sm font-semibold">A</span>
          </div>
          <span className="text-lg font-semibold tracking-tight text-sidebar-foreground transition-opacity duration-200 group-data-[collapsible=icon]:opacity-0">
            Abluo
          </span>
        </div>
      </SidebarHeader>

      {/* Main navigation content */}
      <SidebarContent>
        {navigationGroups.map((group, groupIndex) => (
          <SidebarGroup key={groupIndex}>
            {group.labelKey && (
              <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
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
        ))}
      </SidebarContent>

      {/* Footer with settings */}
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={isActive(settingsItem.href)}
              tooltip={t(settingsItem.titleKey)}
              render={<Link href={settingsItem.href} />}
            >
              <Settings />
              <span>{t(settingsItem.titleKey)}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* Rail for hover expand */}
      <SidebarRail />
    </Sidebar>
  )
}
