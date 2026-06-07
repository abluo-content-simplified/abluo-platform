import Link from 'next/link'
import { tenantClient } from '@/lib/sanity/client'
import { websiteSiteConfigQuery } from '@/lib/sanity/queries'
import type { WebsiteSiteConfig, SupportedLocale } from '@/lib/sanity/types'
import { FooterLanguageSwitcher } from './FooterClient'

interface FooterProps {
  tenantId: string
  locale: SupportedLocale
  defaultLocale: SupportedLocale
  variant?: 'full' | 'minimal'
}

export async function Footer({
  tenantId,
  locale,
  defaultLocale,
  variant = 'full',
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
                className="mb-3 text-[50px] font-bold leading-[64px]"
                style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
              >
                {config.footerCtaHeading}
              </h2>
            )}
            {config.footerCtaSubtext && (
              <p className="mb-7 text-[15px]" style={{ color: 'var(--color-text-primary)', opacity: 0.7 }}>
                {config.footerCtaSubtext}
              </p>
            )}
            <form className="flex max-w-[520px] flex-col gap-3 sm:flex-row">
              <input
                type="email"
                required
                placeholder={config.footerCtaInputPlaceholder ?? 'Your email'}
                className="flex-1 rounded-xl border px-4 py-3 text-[15px] outline-none transition-colors"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'color-mix(in oklch, var(--color-text-primary) 10%, transparent)',
                  color: 'var(--color-text-primary)',
                }}
              />
              <button
                type="submit"
                className="shrink-0 rounded-xl border-2 px-6 py-3 text-sm font-semibold transition-all"
                style={{
                  borderColor: 'var(--color-primary)',
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                }}
              >
                {config.footerCtaButtonLabel ?? 'Submit'}
              </button>
            </form>
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
                {config.footerLinks.map((link) => (
                  <li key={link.href}>
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
