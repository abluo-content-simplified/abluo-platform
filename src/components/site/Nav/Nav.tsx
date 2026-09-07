import { tenantClient } from '@/lib/sanity/client'
import { websiteSiteConfigQuery } from '@/lib/sanity/queries'
import type { WebsiteSiteConfig, SupportedLocale } from '@/lib/sanity/types'
import { imageUrl } from '@/lib/sanity/image'
import { resolveNavLinks } from '@/lib/sanity/nav-links'
import { NavClient } from './NavClient'
import type { UrlProjectSegment } from '@/lib/tenancy/ids'

interface NavProps {
  /** The `[tenant]` URL segment. Not a tenant slug — see `@/lib/tenancy/ids`. */
  tenantId: UrlProjectSegment
  locale: SupportedLocale
  defaultLocale: SupportedLocale
  variant?: 'full' | 'landing'
}

export async function Nav({ tenantId, locale, defaultLocale, variant = 'full' }: NavProps) {
  const { fetchForTenant } = tenantClient(tenantId)
  const config = await fetchForTenant<WebsiteSiteConfig>(
    websiteSiteConfigQuery,
    { locale, defaultLocale },
  )

  if (!config) return null

  return (
    <header
      className="sticky top-0 z-[400] flex h-[72px] items-center px-5 md:px-10 border-b transition-all"
      style={{
        backgroundColor: 'var(--color-background)',
        borderColor: 'var(--color-border)',
      }}
    >
      <NavClient
        logoSrc={imageUrl(config.logo, 480)}
        logoLightSrc={imageUrl(config.logoLight, 480)}
        logoAlt={config.siteName ?? tenantId}
        // Matches the generic tenant header in layout.tsx: the practice name is
        // drawn beside the mark only when there IS a mark. A wordmark tenant
        // renders its name once, as the wordmark, and must not get it twice.
        siteName={imageUrl(config.logo, 480) ? (config.siteName ?? undefined) : undefined}
        wordmarkText={config.wordmarkText}
        wordmarkAccent={config.wordmarkAccent}
        navLinks={resolveNavLinks(config.navLinks, locale, tenantId)}
        ctaLabel={config.ctaLabel}
        ctaHref={config.ctaHref}
        currentLocale={locale}
        supportedLocales={config.supportedLocales ?? [locale]}
        showLangSwitcherInNav={config.showLangSwitcherInNav ?? false}
        tenantId={tenantId}
        themeMode={config.themeMode}
        themeSwitcherPlacement={config.themeSwitcherPlacement}
        variant={variant}
      />
    </header>
  )
}

export async function NavLanding({
  tenantId,
  locale,
  defaultLocale,
}: Omit<NavProps, 'variant'>) {
  return <Nav tenantId={tenantId} locale={locale} defaultLocale={defaultLocale} variant="landing" />
}
