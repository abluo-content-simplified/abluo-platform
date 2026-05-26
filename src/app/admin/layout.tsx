import Image from "next/image";
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
      {/* Blurred logo background image - light mode */}
      <Image
        src="/bkg.png"
        alt=""
        fill
        className="fixed inset-0 object-cover dark:hidden"
        aria-hidden="true"
        priority
      />
      {/* Blurred logo background image - dark mode */}
      <Image
        src="/bkg-inv.png"
        alt=""
        fill
        className="fixed inset-0 object-cover hidden dark:block"
        aria-hidden="true"
        priority
      />
      
      <AdminSidebar />
      <SidebarInset className="flex flex-col gap-2 p-2 pl-4 transition-[margin-left] duration-(--sidebar-shrink-duration) ease-out delay-(--sidebar-content-delay)">
        <TopNav />
        <div className="flex flex-1 flex-col overflow-hidden rounded-lg bg-[var(--surface-content)] backdrop-blur-sm shadow-sm ring-1 ring-border/50">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
