// Client dashboard layout
// Sidebar will be added here once built

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full">
      {/* ClientSidebar will go here */}
      <div className="flex flex-1 flex-col">
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
