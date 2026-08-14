import type { Metadata } from 'next'
import { tenantClient } from '@/lib/sanity/client'
import {
  eventsPageQuery,
  localeConfigQuery,
  designSystemQuery,
  websiteSiteConfigQuery,
  projectModuleConfigQuery,
} from '@/lib/sanity/queries'
import { getEnabledModuleIds, type ProjectModuleConfig } from '@/lib/modules/config'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import type { EventsPage, LocaleConfig, SupportedLocale, DesignSystem, WebsiteSiteConfig } from '@/lib/sanity/types'
import { SectionRenderer, hydrateSections } from '@/components/sections/SectionRenderer'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ tenant: string; locale: string }>
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const eventsPage = await fetchForTenant<EventsPage>(eventsPageQuery, { locale, defaultLocale })

  return {
    title: eventsPage?.seoTitle ?? eventsPage?.heroTitle ?? 'Events',
    description: eventsPage?.seoDescription ?? eventsPage?.heroSubtitle ?? 'All events',
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function EventsListPage({ params }: PageProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // ADR-016 Phase C — the page now renders purely from sections[]. The
  // events grid that used to be fetched and rendered here directly is now
  // fetched by hydrateSections below, driven by the migrated
  // eventsListingSection(timeFilter:'all') section.
  const [eventsPage, designSystem, siteConfig, moduleConfig] = await Promise.all([
    fetchForTenant<EventsPage>(eventsPageQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
    fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale }),
  ])

  // ADR-016 Phase A/C — hydrate blogListingSection / eventsListingSection /
  // liveLatestSection sections with data fetched server-side, mutating
  // eventsPage.sections in place. This is now the ONLY data-fetch path for
  // the page body — there is no fixed-field rendering left.
  // ADR-020 — one query now serves both section gating and module config.
  // getEnabledModuleIds preserves the null-vs-[] distinction the gating
  // contract depends on (unresolved fails open; resolved-empty gates).
  const enabledModuleIds = getEnabledModuleIds(moduleConfig)

  await hydrateSections(eventsPage?.sections, { fetchForTenant, locale: locale as SupportedLocale, defaultLocale, enabledModuleIds })

  return (
    <>
    {eventsPage?.sections?.map((section, index) => (
      <SectionRenderer
        key={section._key}
        section={section}
        siteConfig={siteConfig}
        designSystem={designSystem}
        backgroundPattern={undefined}
        sectionIndex={index}
        locale={locale}
        tenantSlug={tenantId}
        fromParam="events"
        enabledModuleIds={enabledModuleIds}
        moduleConfig={moduleConfig}
      />
    ))}
    </>
  )
}
