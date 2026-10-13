import { ImageResponse } from 'next/og'
import { tenantClient } from '@/lib/sanity/client'
import { pageHomeQuery, websiteSiteConfigQuery, designSystemQuery, localeConfigQuery } from '@/lib/sanity/queries'
import type { WebsitePage, WebsiteSiteConfig, LocaleConfig, DesignSystem, SupportedLocale } from '@/lib/sanity/types'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import { headingFamily, loadCardFont } from '@/lib/seo/og-font'
import { normalizeHost } from '@/lib/tenancy/host-scope'
import { splitWordmark } from '@/lib/wordmark'

/**
 * The generated social card — the `og:image` a site gets when nobody uploaded
 * one (ADR-034 companion; see the precedence note below).
 *
 * ── Precedence, and the Next.js subtlety that makes it work ──────────────────
 * page `ogImage` → siteConfig `openGraphImage` → this file. Next resolves the
 * last step itself: in `resolve-metadata`, a file-convention image is applied
 * only when the metadata object does not have an `images` OWN PROPERTY —
 *
 *     if (openGraph && !source?.openGraph?.hasOwnProperty('images')) { … }
 *
 * `hasOwnProperty`, not a truthiness check. So `images: undefined` SUPPRESSES
 * this card; the key has to be absent entirely. `generateMetadata` in page.tsx
 * therefore spreads the key in only when a real image exists. Set it to
 * undefined there and every site silently loses its card.
 *
 * ── Why a card and not a screenshot of the page ──────────────────────────────
 * A screenshot needs a headless browser (slow, fragile, a dependency per
 * render) and a homepage scaled to 1200×630 is an unreadable thumbnail. A card
 * drawn from the tenant's own design system reads at thumbnail size, which is
 * the only size anyone sees it at.
 */

export const alt = 'Social share card'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** Redrawn at most daily; a share card changes about as often as a site name. */
export const revalidate = 86400

interface Props {
  params: Promise<{ tenant: string; locale: string }>
}

export default async function OpengraphImage({ params }: Props) {
  const { tenant: rawTenantId, locale } = await params
  const tenantId = asUrlProjectSegment(rawTenantId)
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const [home, config, ds] = await Promise.all([
    fetchForTenant<WebsitePage>(pageHomeQuery, { locale, defaultLocale }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    fetchForTenant<DesignSystem>(designSystemQuery, {}),
  ])

  // Same precedence the page's <title> uses, so the card never disagrees with
  // the page it represents.
  const title = home?.seoTitle ?? config?.seoDefaultTitle ?? config?.siteName ?? tenantId
  const description = home?.seoDescription ?? config?.seoDefaultDescription ?? config?.tagline ?? ''
  const siteName = config?.siteName ?? tenantId
  const domain = config?.customDomain ? normalizeHost(config.customDomain) : ''

  // Dark theme: a share card sits on a light feed in every client, so the dark
  // face reads as a deliberate object rather than a washed-out rectangle.
  const dark = ds?.colors?.darkTheme
  const light = ds?.colors?.lightTheme
  const bg = dark?.background ?? light?.background ?? '#0b0b0c'
  const ink = dark?.textPrimary ?? light?.textPrimary ?? '#f2f1ee'
  const muted = dark?.textMuted ?? ink
  const primary = dark?.primary ?? dark?.accent ?? light?.primary ?? '#ff4d00'

  const font = await loadCardFont(headingFamily(ds?.typography?.headingFont))
  // Satori cannot rasterise without font data. No font → no card, and Next
  // simply omits og:image, which is where every site started anyway.
  if (!font) return new Response('Font unavailable', { status: 503 })

  // The wordmark's accented characters, picked up from the same field the
  // header and footer use — so No!Logo's "!" is orange here too.
  const segments = splitWordmark(config?.wordmarkText ?? siteName, config?.wordmarkAccent)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between', backgroundColor: bg, color: ink,
          padding: '84px 90px 76px 110px', fontFamily: font.family, position: 'relative',
        }}
      >
        {/* The accent rail, echoing the one tmz draws down the live page. */}
        <div style={{ position: 'absolute', left: 52, top: 84, bottom: 76, width: 7, borderRadius: 4, backgroundColor: primary }} />

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {domain ? (
            <div style={{ fontSize: 21, letterSpacing: 4, textTransform: 'uppercase', color: primary }}>{domain}</div>
          ) : null}
          <div
            style={{
              fontSize: title.length > 46 ? 55 : 69,
              lineHeight: 1.06, letterSpacing: -2, marginTop: 30, maxWidth: 940,
            }}
          >
            {title}
          </div>
          {description ? (
            <div style={{ fontSize: 27, lineHeight: 1.45, marginTop: 26, maxWidth: 820, color: muted }}>
              {description.length > 150 ? `${description.slice(0, 149)}…` : description}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', fontSize: 23 }}>
          {segments.map((seg, i) => (
            <span key={i} style={{ color: seg.accent ? primary : ink }}>{seg.text}</span>
          ))}
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: font.family, data: font.data, style: 'normal', weight: 700 }] }
  )
}
