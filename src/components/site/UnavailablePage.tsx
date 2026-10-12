'use client'

/**
 * ADR-032 D12 — the branded unavailable page, rendered by the `[tenant]`
 * segment's not-found.tsx inside the normal site layout (nav, footer, design
 * system tokens).
 *
 * It knows nothing about the requested item and must not: no Sanity import
 * and no data loading of any kind — a test enforces this. Everything comes
 * from the URL (locale, tenant, route segment) and the layout's providers
 * (link scope, enabled modules), so a scheduled, unpublished, archived, deleted or never-existing
 * URL renders the identical page.
 */

import { useParams, usePathname } from 'next/navigation'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { useHostScoped } from '@/components/SiteLinkScope'
import { useEnabledModuleIds } from '@/components/site/SiteModulesContext'
import { siteBasePath } from '@/lib/sanity/href'
import { getUnavailablePageMessages, type UnavailablePageMessages } from '@/lib/i18n/unavailable-page-messages'
import { BROWSE_TARGETS, resolveBrowseTarget, type BrowseTarget } from '@/lib/lifecycle/unavailable'

const BROWSE_LABEL: Record<BrowseTarget, keyof UnavailablePageMessages> = {
  blog: 'browseArticles',
  events: 'browseEvents',
  news: 'browseNews',
}

export function UnavailablePage() {
  const params = useParams<{ locale?: string; tenant?: string }>()
  const pathname = usePathname()
  const hostScoped = useHostScoped()
  const enabledModuleIds = useEnabledModuleIds()

  const locale = typeof params?.locale === 'string' ? params.locale : ''
  const tenantId = typeof params?.tenant === 'string' ? params.tenant : ''
  const m = getUnavailablePageMessages(locale)

  const base = locale && tenantId ? siteBasePath(locale, tenantId, hostScoped) : '/'
  const homeHref = base
  const target = locale && tenantId ? resolveBrowseTarget(pathname, locale, tenantId, enabledModuleIds) : null
  const browseHref = target ? `${base}${BROWSE_TARGETS[target].path}` : null

  return (
    <SectionContainer>
      <div className="mx-auto flex min-h-[40vh] max-w-[640px] flex-col items-center justify-center text-center">
        <h1
          className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
          style={{
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-heading)',
            fontSize: 'var(--font-size-h2, var(--fs-h2))',
            fontWeight: 'var(--font-weight-h2, 600)',
            lineHeight: 'var(--line-height-h2, 1.375)',
            letterSpacing: 'var(--letter-spacing-h2, -0.025em)',
          }}
        >
          {m.heading}
        </h1>
        <p
          className="mt-4 text-base leading-relaxed"
          style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}
        >
          {m.body}
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href={homeHref}
            className="inline-flex h-12 items-center px-8 text-sm font-semibold tracking-wide transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)', color: '#fff', borderRadius: 'var(--radius-btn)' }}
          >
            {m.goHome}
          </a>
          {target && browseHref && (
            <a
              href={browseHref}
              className="inline-flex h-12 items-center border px-8 text-sm font-medium transition-opacity hover:opacity-75"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', borderRadius: 'var(--radius-btn)' }}
            >
              {m[BROWSE_LABEL[target]]}
            </a>
          )}
        </div>
      </div>
    </SectionContainer>
  )
}
