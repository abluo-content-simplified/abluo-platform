import type { ContactSection, WebsiteSiteConfig, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from './SectionContainer'
import { getContactSectionMessages } from '@/lib/i18n/contact-section-messages'

interface Props {
  section: ContactSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  siteConfig?: WebsiteSiteConfig | null
  /** BCP 47 locale string — used to resolve UI chrome labels */
  locale?: string
}

export function ContactSection({ section, surface, designSystem, siteConfig, locale = 'en' }: Props) {
  const { title, subtitle, mapEmbedUrl } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const m = getContactSectionMessages(locale)

  // Motion tokens — durationSlow for content sections; divide ms → seconds for motion/react
  const mot = designSystem?.motion
  const duration = mot?.durationSlow !== undefined ? mot.durationSlow / 1000 : 0.35
  const ease: string | number[] = mot?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  return (
      <SectionContainer id="contatti" style={surfaceStyles}>
        <div className="grid gap-16 md:grid-cols-2">
          {/* Left: contact details */}
          <SlideUp duration={duration} ease={ease} delay={0}>
            {title && (
              <h2
                className="mb-6 text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
              >
                {title}
              </h2>
            )}
            {subtitle && (
              <p
                className="mb-10 text-base leading-relaxed"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {subtitle}
              </p>
            )}

            <div className="space-y-6">
              {siteConfig?.address && (
                <div>
                  <p
                    className="mb-1 text-xs font-medium uppercase tracking-[0.2em]"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {m.addressLabel}
                  </p>
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {siteConfig.address}
                  </p>
                </div>
              )}
              {siteConfig?.phone && (
                <div>
                  <p
                    className="mb-1 text-xs font-medium uppercase tracking-[0.2em]"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {m.phoneLabel}
                  </p>
                  <a
                    href={`tel:${siteConfig.phone}`}
                    className="text-sm transition-opacity hover:opacity-100"
                    style={{ color: 'var(--color-text-secondary)', opacity: 0.85 }}
                  >
                    {siteConfig.phone}
                  </a>
                </div>
              )}
              {siteConfig?.email && (
                <div>
                  <p
                    className="mb-1 text-xs font-medium uppercase tracking-[0.2em]"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {m.emailLabel}
                  </p>
                  <a
                    href={`mailto:${siteConfig.email}`}
                    className="text-sm transition-opacity hover:opacity-100"
                    style={{ color: 'var(--color-text-secondary)', opacity: 0.85 }}
                  >
                    {siteConfig.email}
                  </a>
                </div>
              )}
            </div>
          </SlideUp>

          {/* Right: map */}
          <SlideUp duration={duration} ease={ease} delay={0.1}>
            <p
              className="mb-3 text-xs font-medium uppercase tracking-[0.2em]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {m.directionsLabel}
            </p>
            {mapEmbedUrl ? (
              <iframe
                src={mapEmbedUrl}
                className="h-72 w-full border-0 grayscale"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title={m.mapTitle}
              />
            ) : (
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(siteConfig?.address ?? '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-72 w-full flex-col items-center justify-center gap-3 transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--color-surface)' }}
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: 'var(--color-border)' }}
                >
                  <svg
                    className="h-5 w-5"
                    style={{ color: 'var(--color-text-muted)' }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                  </svg>
                </div>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {m.openInMapsLabel}
                </p>
              </a>
            )}
          </SlideUp>
        </div>
      </SectionContainer>

  )
}
