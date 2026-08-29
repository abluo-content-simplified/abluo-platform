import Link from 'next/link'
import { tenantClient } from '@/lib/sanity/client'
import { websiteSiteConfigQuery } from '@/lib/sanity/queries'
import type { WebsiteSiteConfig, SupportedLocale } from '@/lib/sanity/types'
import { resolveNavLink, resolveNavLinks } from '@/lib/sanity/nav-links'
import { imageUrl } from '@/lib/sanity/image'
import { renderWordmark } from '@/lib/wordmark'
import { Icon } from '@/components/icons'
import { FooterLanguageSwitcher } from './FooterClient'
import { EarlyAccessFooterCta } from '@/components/forms/EarlyAccessFooterCta'

interface FooterProps {
  tenantId: string
  locale: SupportedLocale
  defaultLocale: SupportedLocale
  variant?: 'full' | 'minimal'
  /**
   * Render the legacy contact cell — home link (logo or site name) plus the
   * flat `address` / `email` pair from Website Settings.
   *
   * This is the content the generic tenant layout used to render in its own
   * inline `<footer>`. It is opt-in and defaults to `false`, so the Livener
   * footer — which never showed it — is untouched, while a tenant migrating
   * off that inline footer keeps every line it had. It only renders when
   * `footerColumns` are NOT authored: once a tenant authors real footer
   * columns, the brand row supersedes this fallback.
   */
  showContact?: boolean
}

export async function Footer({
  tenantId,
  locale,
  defaultLocale,
  variant = 'full',
  showContact = false,
}: FooterProps) {
  const { fetchForTenant } = tenantClient(tenantId)
  const config = await fetchForTenant<WebsiteSiteConfig>(
    websiteSiteConfigQuery,
    { locale, defaultLocale },
  )

  if (!config) return null

  const currentYear = new Date().getFullYear()
  const copyrightYears =
    config.foundedYear && config.foundedYear < currentYear
      ? `${config.foundedYear}–${currentYear}`
      : String(currentYear)

  const hasCta =
    variant === 'full' &&
    (config.footerCtaHeading || config.footerCtaButtonLabel)

  // ── Brand + columns row (additive) ──────────────────────────────────────────
  // Everything below is gated on `footerColumns` being authored. Absent on
  // every tenant that predates the field, so those footers render byte-for-byte
  // as they did before: no brand cell, no columns, no divider.
  const columns = (config.footerColumns ?? []).filter(
    (column) => column.heading || column.links?.length,
  )
  const hasBrandRow = variant === 'full' && columns.length > 0

  const logoSrc = config.logo ? imageUrl(config.logo as never, 480) : undefined
  // Precedence: image logo → text wordmark → plain site name.
  const wordmark = renderWordmark(config.wordmarkText, config.wordmarkAccent)

  // Credit link ("Built by …") beside the copyright. Runs through the shared
  // nav-link resolver, so an external URL, a page reference and a `mailto:`
  // href all behave exactly as they do in the header.
  const credit = config.footerCredit
    ? resolveNavLink(config.footerCredit, locale, tenantId)
    : null

  const borderSoft = 'color-mix(in oklch, var(--color-text-primary) 10%, transparent)'

  // Legacy contact cell — only when opted in, only for a 'full' footer, and only
  // while there is no authored brand row to supersede it.
  const hasContactRow =
    showContact && variant === 'full' && !hasBrandRow && Boolean(logoSrc || config.siteName || config.address || config.email)

  return (
    <footer style={{ backgroundColor: 'var(--color-secondary)' }}>

      {/* ── CTA section ────────────────────────────────────────── */}
      {hasCta && (
        <div
          className="border-b px-5 py-16 md:px-10"
          style={{ borderColor: 'color-mix(in oklch, var(--color-text-primary) 10%, transparent)' }}
        >
          <div className="mx-auto max-w-[1200px]">
            {config.footerCtaHeading && (
              <h2
                className="mb-3"
                style={{
                  fontFamily: 'var(--font-heading)',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--font-size-h2, 3.125rem)',
                  fontWeight: 'var(--font-weight-h2, 700)',
                  lineHeight: 'var(--line-height-h2, 4rem)',
                }}
              >
                {config.footerCtaHeading}
              </h2>
            )}
            {config.footerCtaSubtext && (
              <p className="mb-7 text-[15px]" style={{ color: 'var(--color-text-primary)', opacity: 0.7 }}>
                {config.footerCtaSubtext}
              </p>
            )}
            <div className="max-w-[520px]">
              <EarlyAccessFooterCta
                emailPlaceholder={config.footerCtaInputPlaceholder ?? undefined}
                buttonLabel={config.footerCtaButtonLabel ?? undefined}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Brand cell + link columns ──────────────────────────── */}
      {/*
        Responsive by construction, unlike the original single-breakpoint
        `1.5fr repeat(4, 1fr)`: the brand cell and the column block stack on
        small screens and sit side by side from `lg`, and the columns
        themselves are an auto-fit grid, so 1 to 5 authored columns all lay
        out without the component knowing how many there are.
      */}
      {hasBrandRow && (
        <div className="border-b px-5 py-16 md:px-10" style={{ borderColor: borderSoft }}>
          <div className="mx-auto flex max-w-[1200px] flex-col gap-12 lg:flex-row lg:gap-16">

            {/* Brand */}
            <div className="lg:w-[30%] lg:shrink-0">
              <Link href={`/${locale}/${tenantId}`} className="mb-4 inline-block">
                {logoSrc ? (
                  <img
                    src={logoSrc}
                    alt={config.siteName ?? tenantId}
                    style={{ height: 'var(--logo-height-desktop)', width: 'auto' }}
                  />
                ) : (
                  <span
                    className="text-2xl font-extrabold tracking-[-0.03em]"
                    style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
                  >
                    {wordmark ?? config.siteName ?? tenantId}
                  </span>
                )}
              </Link>

              {config.tagline && (
                <p
                  className="mb-6 max-w-[24ch] text-sm leading-relaxed"
                  style={{ fontFamily: 'var(--font-body)', color: 'var(--color-text-primary)', opacity: 0.6 }}
                >
                  {config.tagline}
                </p>
              )}

              {config.footerSubTagline && (
                <div
                  className="text-[0.625rem] font-bold uppercase tracking-[0.12em]"
                  style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)', opacity: 0.45 }}
                >
                  {config.footerSubTagline}
                </div>
              )}

              {config.socialLinks && config.socialLinks.length > 0 && (
                <ul className="mt-5 flex list-none flex-wrap gap-x-5 gap-y-2">
                  {config.socialLinks
                    .filter((social) => social.url)
                    .map((social) => (
                      <li key={social.url}>
                        <a
                          href={social.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 transition-opacity hover:opacity-100"
                          style={{ color: 'var(--color-text-primary)', opacity: 0.45 }}
                        >
                          {/* Unregistered platforms render no icon rather than a broken one. */}
                          <Icon name={social.platform} size={16} />
                          <span
                            className="text-[0.625rem] font-bold uppercase tracking-[0.1em]"
                            style={{ fontFamily: 'var(--font-heading)' }}
                          >
                            {social.platform}
                          </span>
                        </a>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            {/* Link columns */}
            <div
              className="grid flex-1 gap-8"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(9.375rem, 1fr))' }}
            >
              {columns.map((column) => (
                <div key={column._key}>
                  {column.heading && (
                    <h4
                      className="mb-5 text-[0.6875rem] font-bold uppercase tracking-[0.1em]"
                      style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)', opacity: 0.6 }}
                    >
                      {column.heading}
                    </h4>
                  )}
                  <ul className="list-none space-y-3">
                    {resolveNavLinks(column.links, locale, tenantId).map((link, i) => (
                      <li key={`${link.label}-${link.href}-${i}`}>
                        <Link
                          href={link.href}
                          target={link.external ? '_blank' : undefined}
                          rel={link.external ? 'noopener noreferrer' : undefined}
                          className="text-sm transition-opacity hover:opacity-100"
                          style={{ fontFamily: 'var(--font-body)', color: 'var(--color-text-primary)', opacity: 0.45 }}
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}

      {/* ── Legacy contact cell ────────────────────────────────────
          Same content and the same tokens the generic tenant layout rendered
          in its own inline <footer>: home link (logo at --logo-height-mobile,
          or the site name), then the flat address and mailto: email. Nothing
          here is new — it exists so migrating a tenant onto this shared
          component drops none of the lines that footer showed. */}
      {hasContactRow && (
        <div className="border-b px-5 py-10 md:px-10" style={{ borderColor: borderSoft }}>
          <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            {logoSrc ? (
              <Link href={`/${locale}/${tenantId}`} className="transition-opacity hover:opacity-100">
                <img
                  src={logoSrc}
                  alt={config.siteName ?? tenantId}
                  style={{ height: 'var(--logo-height-mobile)', width: 'auto', opacity: 0.6 }}
                />
              </Link>
            ) : (
              <Link
                href={`/${locale}/${tenantId}`}
                className="text-xs transition-opacity hover:opacity-100"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {wordmark ?? config.siteName}
              </Link>
            )}
            <div className="flex flex-col gap-1 sm:items-end">
              {config.address && (
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {config.address}
                </p>
              )}
              {config.email && (
                <a
                  href={`mailto:${config.email}`}
                  className="text-xs transition-opacity hover:opacity-100"
                  style={{ color: 'var(--color-text-muted)', opacity: 0.75 }}
                >
                  {config.email}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Bottom bar ─────────────────────────────────────────── */}
      <div className="px-5 py-10 md:px-10">
        <div className="mx-auto max-w-[1200px]">

          {/* Top row: copyright + links */}
          <div
            className="flex flex-wrap items-center justify-between gap-4 border-b pb-6"
            style={{ borderColor: 'color-mix(in oklch, var(--color-text-primary) 12%, transparent)' }}
          >
            <span className="text-sm" style={{ color: 'var(--color-text-primary)', opacity: 0.45 }}>
              © {copyrightYears} {config.legalName ?? config.siteName}
            </span>

            {config.footerLinks && config.footerLinks.length > 0 && (
              <ul className="flex flex-wrap gap-5 list-none">
                {resolveNavLinks(config.footerLinks, locale, tenantId).map((link, i) => (
                  <li key={`${link.href}-${i}`}>
                    <Link
                      href={link.href}
                      target={link.external ? '_blank' : undefined}
                      rel={link.external ? 'noopener noreferrer' : undefined}
                      className="text-sm font-medium transition-colors"
                      style={{ color: 'var(--color-text-primary)', opacity: 0.55 }}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {/* Credit link — absent until `footerCredit` is authored. */}
            {credit && (
              <Link
                href={credit.href}
                target={credit.external ? '_blank' : undefined}
                rel={credit.external ? 'noopener noreferrer' : undefined}
                className="text-sm transition-opacity hover:opacity-100"
                style={{ color: 'var(--color-text-primary)', opacity: 0.45 }}
              >
                {credit.label}
              </Link>
            )}
          </div>

          {/* Bottom row: language switcher + legal */}
          <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              {config.registrationInfo && (
                <p className="text-xs" style={{ color: 'var(--color-text-primary)', opacity: 0.25 }}>
                  {config.registrationInfo}
                </p>
              )}
              {config.legalAddress && (
                <p className="mt-1 text-xs" style={{ color: 'var(--color-text-primary)', opacity: 0.25 }}>
                  {config.legalAddress}
                </p>
              )}
            </div>

            <FooterLanguageSwitcher
              currentLocale={locale}
              supportedLocales={config.supportedLocales ?? [locale]}
              tenantId={tenantId}
            />
          </div>

        </div>
      </div>
    </footer>
  )
}

export async function FooterMinimal({
  tenantId,
  locale,
  defaultLocale,
}: Omit<FooterProps, 'variant'>) {
  return (
    <Footer
      tenantId={tenantId}
      locale={locale}
      defaultLocale={defaultLocale}
      variant="minimal"
    />
  )
}
