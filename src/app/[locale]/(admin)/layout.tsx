// Admin dashboard layout
// Sidebar and topbar will be added here once built in v0

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full">
      {/* AdminSidebar will go here */}
      <div className="flex flex-1 flex-col">
        {/* AdminTopbar will go here */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
