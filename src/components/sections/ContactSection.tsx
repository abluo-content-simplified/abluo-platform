import type { ContactSection, WebsiteSiteConfig, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { getContactSectionMessages } from '@/lib/i18n/contact-section-messages'
import { buildAddressQuery, getMapEmbedUrl, getMapsDeepLink } from '@/lib/maps/provider'
import { FormOverlayWrapper } from '@/components/forms/FormOverlayWrapper'
import { FormOverlayTrigger } from '@/components/forms/FormOverlayTrigger'
import { overlayButtonClass } from '@/lib/forms/overlay-button'
import { WhatsAppWidget } from '@/components/forms/WhatsAppWidget'
import { hasWhatsAppNumber } from '@/lib/forms/whatsapp'

interface Props {
  section: ContactSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  siteConfig?: WebsiteSiteConfig | null
  /** BCP 47 locale string — used to resolve UI chrome labels */
  locale?: string
  /** URL tenant slug — the submission route scope for the optional message button. */
  tenantSlug?: string
}

export function ContactSection({ section, surface, designSystem, siteConfig, locale = 'en', tenantSlug }: Props) {
  const { title, subtitle } = section
  const showMap = section.showMap ?? true
  const mapHeight = section.mapHeight ?? 400
  const mapTheme = section.mapTheme ?? 'auto'
  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const m = getContactSectionMessages(locale)

  // Motion tokens
  const mot = designSystem?.motion
  const duration = mot?.durationSlow !== undefined ? mot.durationSlow / 1000 : 0.35
  const ease: string | number[] = mot?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  // ── Map resolution ──────────────────────────────────────────────────────────
  // Build address string from structured location (preferred) or legacy flat
  // address (fallback). Both come from siteConfig — the section owns nothing.
  const addressQuery = buildAddressQuery(siteConfig?.location, siteConfig?.address)
  const mapEmbedUrl = showMap && addressQuery ? getMapEmbedUrl(addressQuery, mapTheme) : null
  const mapsDeepLink = addressQuery ? getMapsDeepLink(addressQuery) : null
  const renderMap = showMap && !!mapEmbedUrl

  // ── Message button (overlay) ─────────────────────────────────────────────────
  // Optional: when a form is referenced (and we know the tenant), a button sits at
  // the bottom of the contact details and opens the form in an overlay. Styling is
  // design-system-driven (overlayButtonClass), so it adopts each tenant's tokens.
  const contactForm = section.contactForm ?? null
  const showButton = !!contactForm?.formId && !!tenantSlug
  const buttonLabel = section.contactButtonLabel ?? contactForm?.title ?? 'Send us a message'

  // ── WhatsApp button (optional) ───────────────────────────────────────────────
  // Renders next to the message button when enabled on the section AND the site
  // has a WhatsApp number + form configured (Site Settings → Contact).
  const waNumber = siteConfig?.whatsappNumber
  const waForm = siteConfig?.whatsappForm ?? null
  const showWhatsapp = !!section.showWhatsappButton && hasWhatsAppNumber(waNumber) && !!waForm?.formId && !!tenantSlug

  // ── Layout ─────────────────────────────────────────────────────────────────
  // Two-column when map is shown; single full-width column when map is hidden.
  const gridClass = renderMap ? 'grid gap-16 md:grid-cols-2' : 'max-w-[560px]'

  return (
    <SectionContainer id="contatti" style={surfaceStyles}>
      <div className={gridClass}>

        {/* ── Left: contact details (+ optional message button) ───────── */}
        <div className="flex h-full flex-col">
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
            {addressQuery && (
              <div>
                <p
                  className="mb-1 text-xs font-medium uppercase tracking-[0.2em]"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {m.addressLabel}
                </p>
                {mapsDeepLink ? (
                  <a
                    href={mapsDeepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm transition-opacity hover:opacity-80"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {addressQuery}
                  </a>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {addressQuery}
                  </p>
                )}
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
                  className="text-sm transition-opacity hover:opacity-80"
                  style={{ color: 'var(--color-text-secondary)' }}
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
                  className="text-sm transition-opacity hover:opacity-80"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {siteConfig.email}
                </a>
              </div>
            )}
          </div>
        </SlideUp>

        {/* Contact actions — pinned to the bottom of the column so they line up
            with the base of the map; left-aligned with the contact details. */}
        {(showButton || showWhatsapp) && (
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-10">
            {showButton && contactForm && (
              <FormOverlayWrapper
                tenantSlug={tenantSlug as string}
                locale={locale}
                forms={[{ formId: contactForm.formId, definition: contactForm }]}
              >
                <FormOverlayTrigger
                  formId={contactForm.formId}
                  title={section.contactOverlayTitle ?? undefined}
                  source={{ source: 'contact_section' }}
                  className={overlayButtonClass('primary')}
                >
                  {buttonLabel}
                </FormOverlayTrigger>
              </FormOverlayWrapper>
            )}
            {showWhatsapp && waForm && (
              <WhatsAppWidget
                definition={waForm}
                number={waNumber as string}
                tenantSlug={tenantSlug as string}
                locale={locale}
                variant="inline"
              />
            )}
          </div>
        )}
        </div>

        {/* ── Right: map ─────────────────────────────────────────────── */}
        {renderMap && (
          <SlideUp duration={duration} ease={ease} delay={0.1}>
            <p
              className="mb-3 text-xs font-medium uppercase tracking-[0.2em]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {m.directionsLabel}
            </p>
            {/*
              Wrapping anchor: clicking the map opens Google Maps / native Maps app.
              The iframe itself is interactive (zoom/pan) — the link only activates
              when the user clicks outside the iframe's interactive area.
            */}
            <a
              href={mapsDeepLink ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={m.openInMapsLabel}
              className="block overflow-hidden"
              style={{ borderRadius: 'var(--radius-card, 12px)' }}
            >
              <iframe
                src={mapEmbedUrl}
                width="100%"
                height={mapHeight}
                style={{
                  border: 0,
                  display: 'block',
                  borderRadius: 'var(--radius-card, 12px)',
                }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title={m.mapTitle}
                allowFullScreen
              />
            </a>
          </SlideUp>
        )}

      </div>
    </SectionContainer>
  )
}
