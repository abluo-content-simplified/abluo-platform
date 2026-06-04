export const dynamic = 'force-dynamic'

import { tenantClient } from '@/lib/sanity/client'
import { localeConfigQuery, websiteSiteConfigQuery } from '@/lib/sanity/queries'
import type { LocaleConfig, SupportedLocale } from '@/lib/sanity/types'
import { Nav } from '@/components/livener/Nav'
import { Footer } from '@/components/livener/Footer'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ tenant: string; locale: string }>
}

export default async function WebsiteLayout({ children, params }: LayoutProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  // Fetch locale config first — needed as $defaultLocale param in all subsequent queries
  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // ── Livener ──────────────────────────────────────────────────────────────────
  // Livener uses the custom Nav + Footer with full design system.
  // Other tenants fall through to the generic header/footer below.
  if (tenantId === 'livener') {
    return (
      <>
        <Nav tenantId={tenantId} locale={locale as SupportedLocale} defaultLocale={defaultLocale} />
        <main>{children}</main>
        <Footer tenantId={tenantId} locale={locale as SupportedLocale} defaultLocale={defaultLocale} />
      </>
    )
  }

  // ── Generic fallback (studiomartegani and future tenants) ─────────────────────
  // These tenants retain the existing minimal header until their own nav is built.
  const config = await fetchForTenant<any>(websiteSiteConfigQuery, { locale, defaultLocale })

  return (
    <>
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
      <div className="h-16" />
      <main>{children}</main>
      <footer className="border-t border-zinc-100 bg-white px-6 py-10 md:px-16 lg:px-24">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-400">{config?.siteName}</p>
          {config?.address && <p className="text-xs text-zinc-400">{config.address}</p>}
          {config?.email && (
            <a href={`mailto:${config.email}`} className="text-xs text-zinc-400 transition-colors hover:text-zinc-900">
              {config.email}
            </a>
          )}
        </div>
      </footer>
    </>
  )
}
