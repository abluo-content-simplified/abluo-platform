// Public-facing website layout per tenant
// Rendered per client domain

export default function WebsiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      {children}
    </div>
  )
}
