import Link from 'next/link'
import { tenantClient } from '@/lib/sanity/client'
import { websiteSiteConfigQuery } from '@/lib/sanity/queries'
import type { WebsiteSiteConfig, SupportedLocale } from '@/lib/sanity/types'
import { FooterLanguageSwitcher } from './FooterClient'

interface FooterProps {
  tenantId: string
  locale: SupportedLocale
  defaultLocale: SupportedLocale
  /** 'full' shows the CTA section. 'minimal' shows links + copyright only. */
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
    <footer className="bg-[#363366]">

      {/* ── CTA section (FooterFull only) ──────────────────────── */}
      {hasCta && (
        <div className="border-b border-white/10 px-5 py-16 md:px-10">
          <div className="mx-auto max-w-[1200px]">
            {config.footerCtaHeading && (
              <h2 className="mb-3 font-['Barlow_Condensed'] text-[50px] font-bold leading-[64px] text-white">
                {config.footerCtaHeading}
              </h2>
            )}
            {config.footerCtaSubtext && (
              <p className="mb-7 text-[15px] text-white/70">{config.footerCtaSubtext}</p>
            )}
            <form
              className="flex max-w-[520px] flex-col gap-3 sm:flex-row"
              onSubmit={(e) => e.preventDefault()}
            >
              <input
                type="email"
                required
                placeholder={config.footerCtaInputPlaceholder ?? 'Your email'}
                className="flex-1 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-[15px] text-white placeholder-white/35 outline-none transition-colors focus:border-[#ffa22b] focus:ring-2 focus:ring-[#ffa22b]/15"
              />
              <button
                type="submit"
                className="shrink-0 rounded-xl border-2 border-[#ffa22b] bg-[#ffa22b] px-6 py-3 text-sm font-semibold text-white transition-all hover:border-white/30 hover:bg-transparent"
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
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/12 pb-6">
            <span className="text-sm text-white/45">
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
                      className="text-sm font-medium text-white/55 transition-colors hover:text-white"
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
                <p className="text-xs text-white/25">{config.registrationInfo}</p>
              )}
              {config.legalAddress && (
                <p className="mt-1 text-xs text-white/25">{config.legalAddress}</p>
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

/**
 * FooterMinimal — convenience export for pages that don't need the CTA.
 */
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
