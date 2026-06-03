export const dynamic = 'force-dynamic'

import { tenantClient } from '@/lib/sanity/client'
import { websiteSiteConfigQuery } from '@/lib/sanity/queries'
import type { WebsiteSiteConfig } from '@/lib/sanity/types'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ tenant: string; locale: string }>
}

export default async function WebsiteLayout({ children, params }: LayoutProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)
  const config = await fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale })

  return (
    <>
      {/* ── Site header ─────────────────────────────────────────────────── */}
      <header className="fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between bg-white/90 px-6 backdrop-blur-sm md:px-16 lg:px-24">
        <span className="text-sm font-medium tracking-wide text-zinc-900">
          {config?.siteName ?? tenantId}
        </span>
        <div className="flex items-center gap-4">
          <LanguageSwitcher currentLocale={locale} tenant={tenantId} />
          {config?.phone && (
            <a
              href={`tel:${config.phone}`}
              className="text-xs font-medium tracking-wide text-zinc-500 transition-colors hover:text-zinc-900"
            >
              {config.phone}
            </a>
          )}
        </div>
      </header>

      {/* Page offset for fixed header */}
      <div className="h-16" />

      {/* ── Page content ────────────────────────────────────────────────── */}
      <main>{children}</main>

      {/* ── Site footer ─────────────────────────────────────────────────── */}
      <footer className="border-t border-zinc-100 bg-white px-6 py-10 md:px-16 lg:px-24">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-400">{config?.siteName}</p>
          {config?.address && (
            <p className="text-xs text-zinc-400">{config.address}</p>
          )}
          {config?.email && (
            <a
              href={`mailto:${config.email}`}
              className="text-xs text-zinc-400 transition-colors hover:text-zinc-900"
            >
              {config.email}
            </a>
          )}
        </div>
      </footer>
    </>
  )
}
