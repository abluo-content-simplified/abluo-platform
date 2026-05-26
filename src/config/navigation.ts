import {
  LayoutDashboard,
  Users,
  FolderKanban,
  FileText,
  Settings,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  titleKey: string
  icon: LucideIcon
  href: string
  badge?: number
}

export const navigationItems: NavItem[] = [
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

// Mock data for company/project switchers
export const mockCustomers = [
  { id: "1", name: "Acme Corp" },
  { id: "2", name: "Globex Inc" },
  { id: "3", name: "Initech" },
]

export const mockProjects = [
  { id: "1", name: "Website Redesign", customerId: "1" },
  { id: "2", name: "Mobile App", customerId: "1" },
  { id: "3", name: "Marketing Campaign", customerId: "1" },
  { id: "4", name: "ERP Integration", customerId: "2" },
  { id: "5", name: "Security Audit", customerId: "3" },
]
