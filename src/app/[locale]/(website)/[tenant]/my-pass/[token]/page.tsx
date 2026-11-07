/**
 * ADR-044 D9, D11 — the My pass page a person opens from the link in their
 * email: /{locale}/my-pass/{token} (on the club's own domain no project
 * segment; the proxy adds it).
 *
 * The token is the only credential. This page:
 *  - answers a malformed, unknown, other-site or module-off link with the SAME
 *    calm "link not valid" screen (no hint whether it existed);
 *  - rate-limits the lookup per address (src/lib/reservations/website/link-guard.ts);
 *  - is `noindex`, `private, no-store` (next.config) and `Referrer-Policy:
 *    no-referrer` (proxy + meta), and the proxy marks it like the private
 *    draft preview so the layout loads no analytics and no first-touch
 *    recorder on it — the token never reaches a third party;
 *  - renders inside the site's normal layout (nav, footer, design tokens).
 * Nothing here logs the token.
 */
import type { Metadata } from 'next'
import { MyPass } from '@/components/site/reservations/MyPass'
import { LinkNotice, PageShell } from '@/components/site/reservations/PageShell'
import { RESTRICTED_ROBOTS } from '@/lib/access/page-metadata'
import { getReservationSiteMessages } from '@/lib/reservations/website/messages'
import { loadPassPage } from '@/lib/reservations/website/pages.server'
import { siteBasePath } from '@/lib/sanity/href'
import { isHostScopedRequest } from '@/lib/tenancy/link-scope.server'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ locale: string; tenant: string; token: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  return {
    title: getReservationSiteMessages(locale).pass.title,
    description: null,
    robots: RESTRICTED_ROBOTS,
    referrer: 'no-referrer',
    alternates: null,
  }
}

export default async function MyPassPage({ params }: Props) {
  const { locale, tenant, token } = await params
  const m = getReservationSiteMessages(locale)
  const state = await loadPassPage({ tenant, locale, token })
  if (state.kind === 'ok') {
    return (
      <PageShell title={m.pass.title}>
        <MyPass tenant={tenant} locale={locale} token={token} initial={state.view} messages={m} />
      </PageShell>
    )
  }
  const text = state.kind === 'limited' ? m.limited : state.kind === 'unavailable' ? m.unavailable : m.invalid
  return <LinkNotice heading={text.heading} body={text.body} homeHref={siteBasePath(locale, tenant, await isHostScopedRequest(tenant))} homeLabel={m.goHome} />
}
