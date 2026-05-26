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
      {/* Blurred logo background - positioned behind everything */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        {/* Large blurred orange glow - top left */}
        <div
          className="absolute -top-48 -left-48 size-[600px]"
          style={{
            background: "radial-gradient(circle, rgba(232, 106, 51, 0.4) 0%, rgba(232, 106, 51, 0) 70%)",
          }}
          aria-hidden="true"
        />
        {/* Medium blurred orange glow - center right */}
        <div
          className="absolute top-1/4 right-0 size-[450px]"
          style={{
            background: "radial-gradient(circle, rgba(232, 106, 51, 0.25) 0%, rgba(232, 106, 51, 0) 70%)",
          }}
          aria-hidden="true"
        />
        {/* Small blurred orange glow - bottom */}
        <div
          className="absolute -bottom-24 left-1/3 size-[400px]"
          style={{
            background: "radial-gradient(circle, rgba(232, 106, 51, 0.2) 0%, rgba(232, 106, 51, 0) 70%)",
          }}
          aria-hidden="true"
        />
      </div>
      
      <AdminSidebar />
      <SidebarInset className="flex flex-col gap-2 p-2 pl-4 transition-[margin-left] duration-[220ms] ease-out delay-[40ms]">
        <TopNav />
        <div className="flex flex-1 flex-col overflow-hidden rounded-lg bg-background/80 backdrop-blur-sm shadow-sm ring-1 ring-border/50">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
