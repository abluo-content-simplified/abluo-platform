/**
 * AuthLayout — the shared chrome for signed-out pages.
 *
 * Extracted so sign-in, password reset and anything else that happens before a
 * session exists look like one product rather than three pages built on
 * different days. The login page's own markup is the reference.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-zinc-50">
      {/* Left accent */}
      <div className="hidden w-52 bg-zinc-950 lg:flex lg:flex-col lg:justify-between lg:px-8 lg:py-10">
        <div>
          <p className="text-xs font-medium tracking-[0.25em] uppercase text-zinc-100">Abluo</p>
          <p className="mt-1 text-[10px] text-zinc-500 tracking-wider">Admin</p>
        </div>
        <p className="text-[10px] text-zinc-700 tracking-widest uppercase">Content. Simplified.</p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <p className="mb-10 text-xs font-medium tracking-[0.25em] uppercase text-zinc-400 lg:hidden">
            Abluo Admin
          </p>
          <h1 className="mb-1 text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
          {subtitle && <p className="mb-8 text-sm text-zinc-400">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  )
}
