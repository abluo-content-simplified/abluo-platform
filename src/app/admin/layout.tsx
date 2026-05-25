import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin-sidebar";
import { TopNav } from "@/components/top-nav";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset className="flex flex-col gap-2 p-2 pl-4">
        <TopNav />
        <div className="flex flex-1 flex-col overflow-hidden rounded-lg bg-background shadow-sm ring-1 ring-border">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
