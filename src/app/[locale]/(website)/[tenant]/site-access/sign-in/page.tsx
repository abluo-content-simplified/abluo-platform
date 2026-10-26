/**
 * ADR-040 B2.4 — the site's own sign-in page, where a browser lands when it
 * opens a protected document it may not see (or that does not exist — the
 * two are indistinguishable). The same members-only placeholder and password
 * prompt as a restricted page; after signing in the visitor returns to the
 * document's address, which re-checks everything.
 *
 * It receives only `returnTo` (validated: a same-site path inside this site)
 * and the one-word outcome of the last attempt.
 */
import type { Metadata } from 'next'
import { RestrictedPage } from '@/components/site/RestrictedPage'
import { ACCESS_FORM_FIELDS, accessFormActions, parseAccessNotice, safeReturnPath } from '@/lib/access/request'
import { promptNotice, promptNoticeKind } from '@/lib/access/prompt'
import { visitorStateFor } from '@/lib/access/page-gate.server'
import { deniedPageMetadata } from '@/lib/access/page-metadata'
import { getAccessMessages } from '@/lib/i18n/access-messages'
import { siteBasePath } from '@/lib/sanity/href'
import { isHostScopedRequest } from '@/lib/tenancy/link-scope.server'
import { tenantClient } from '@/lib/sanity/client'
import { websiteSiteConfigQuery } from '@/lib/sanity/queries'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import type { WebsiteSiteConfig } from '@/lib/sanity/types'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ locale: string; tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, tenant } = await params
  const config = await tenantClient(asUrlProjectSegment(tenant))
    .fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale: locale })
    .catch(() => null)
  return deniedPageMetadata({ locale, siteName: config?.siteName ?? tenant })
}

export default async function SiteAccessSignInPage({ params, searchParams }: Props) {
  const { locale, tenant } = await params
  const sp = await searchParams
  const siteBase = siteBasePath(locale, tenant, await isHostScopedRequest(tenant))
  const raw = Array.isArray(sp.returnTo) ? sp.returnTo[0] : sp.returnTo
  const returnTo = safeReturnPath(raw, siteBase) ?? siteBase
  const { notice: fromRoute, waitMinutes } = parseAccessNotice(sp)
  const visitor = await visitorStateFor(tenant)
  const kind = promptNoticeKind(fromRoute, { kind: 'denied', reason: 'no_session', navigation: 'hidden', visitor })
  const notice = promptNotice(kind, getAccessMessages(locale), waitMinutes)
  return (
    <RestrictedPage
      locale={locale}
      homeHref={siteBase}
      actions={accessFormActions(siteBase)}
      returnTo={returnTo}
      fields={ACCESS_FORM_FIELDS}
      notice={notice ? { tone: notice.tone, text: notice.text, invalid: notice.invalid } : null}
      signedIn={visitor === 'other_groups'}
    />
  )
}
