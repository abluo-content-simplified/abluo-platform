import { tenantClient } from '@/lib/sanity/client'
import { websiteSiteConfigQuery } from '@/lib/sanity/queries'
import type { WebsiteSiteConfig, SupportedLocale } from '@/lib/sanity/types'
import { imageUrl } from '@/lib/sanity/image'
import { NavClient } from './NavClient'

interface NavProps {
  tenantId: string
  locale: SupportedLocale
  defaultLocale: SupportedLocale
  variant?: 'full' | 'landing'
}

/**
 * Nav (Full variant) — server component.
 * Fetches siteConfig from Sanity, passes resolved data to NavClient.
 *
 * Usage in layout.tsx:
 *   <Nav tenantId={tenantId} locale={locale} defaultLocale={defaultLocale} />
 *
 * Use variant="landing" for pages without nav links (e.g. campaign landing pages).
 */
export async function Nav({ tenantId, locale, defaultLocale, variant = 'full' }: NavProps) {
  const { fetchForTenant } = tenantClient(tenantId)
  const config = await fetchForTenant<WebsiteSiteConfig>(
    websiteSiteConfigQuery,
    { locale, defaultLocale },
  )

  if (!config) return null

  return (
    <header
      className={[
        // z-index 400 — always above the overlay (300) and drawer (350)
        'sticky top-0 z-[400] flex h-[72px] items-center px-5 md:px-10',
        'border-b border-white/8 bg-[#161d2b] transition-all',
        // Light theme override
        'data-[theme=light]:border-black/8 data-[theme=light]:bg-white data-[theme=light]:shadow-sm',
      ].join(' ')}
    >
      <NavClient
        logoSrc={imageUrl(config.logo, 480)}
        logoLightSrc={imageUrl(config.logoLight, 480)}
        logoAlt={config.siteName ?? 'Livener'}
        navLinks={config.navLinks ?? []}
        ctaLabel={config.ctaLabel ?? 'Get Early Access'}
        ctaHref={config.ctaHref ?? '#'}
        currentLocale={locale}
        supportedLocales={config.supportedLocales ?? [locale]}
        showLangSwitcherInNav={config.showLangSwitcherInNav ?? false}
        variant={variant}
      />
    </header>
  )
}

/**
 * NavLanding — same as Nav but forces variant="landing" (no page links).
 * Convenience export for landing page layouts.
 */
export async function NavLanding({
  tenantId,
  locale,
  defaultLocale,
}: Omit<NavProps, 'variant'>) {
  return <Nav tenantId={tenantId} locale={locale} defaultLocale={defaultLocale} variant="landing" />
}
