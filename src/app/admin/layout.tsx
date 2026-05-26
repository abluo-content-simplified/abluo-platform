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
      {/* Blurred logo background - positioned behind everything */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        {/* Large blurred logo elements */}
        <Image
          src="/logo.svg"
          alt=""
          width={600}
          height={600}
          className="absolute -top-32 -left-32 size-[500px] opacity-30 blur-[100px]"
          aria-hidden="true"
        />
        <Image
          src="/logo.svg"
          alt=""
          width={400}
          height={400}
          className="absolute top-1/3 left-1/2 size-[350px] opacity-20 blur-[80px]"
          aria-hidden="true"
        />
        <Image
          src="/logo.svg"
          alt=""
          width={300}
          height={300}
          className="absolute bottom-0 right-1/4 size-[280px] opacity-15 blur-[70px]"
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
