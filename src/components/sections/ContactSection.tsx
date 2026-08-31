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
import { resolveWhatsAppConfig, type ProjectModuleConfig } from '@/lib/modules/config'
import { resolveEasing } from '@/lib/motion/easing'
import type { UrlProjectSegment } from '@/lib/tenancy/ids'

interface Props {
  section: ContactSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  siteConfig?: WebsiteSiteConfig | null
  /** ADR-020 — module-owned per-website configuration; source of truth for WhatsApp. */
  moduleConfig?: ProjectModuleConfig
  /** BCP 47 locale string — used to resolve UI chrome labels */
  locale?: string
  /** URL tenant slug — the submission route scope for the optional message button. */
  /** The `[tenant]` URL segment — not a tenant slug. See `@/lib/tenancy/ids`. */
  tenantSlug?: UrlProjectSegment
}

export function ContactSection({ section, surface, designSystem, siteConfig, moduleConfig, locale = 'en', tenantSlug }: Props) {
  const { title, subtitle } = section
  const showMap = section.showMap ?? true
  const mapHeight = section.mapHeight ?? 400
  const mapTheme = section.mapTheme ?? 'auto'
  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const m = getContactSectionMessages(locale)

  // Motion tokens
  const mot = designSystem?.motion
  const duration = mot?.durationSlow !== undefined ? mot.durationSlow / 1000 : 0.35
  const ease = resolveEasing(mot?.easingDecelerate, [0.0, 0.0, 0.2, 1])

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
  // ADR-020 Amendment A — everything about WhatsApp, including WHERE its buttons
  // appear, is configured in the WhatsApp module. This used to be a per-section
  // checkbox while the floating button was a site setting: two placements of the
  // same feature, configured in two unrelated places.
  //
  // In capture mode a form is required (it collects the subject and message);
  // in direct mode the button opens WhatsApp straight away and needs none.
  const whatsapp = resolveWhatsAppConfig(moduleConfig, siteConfig)
  const waNumber = whatsapp.number
  const waForm = whatsapp.form
  const showWhatsapp =
    whatsapp.inContactSections &&
    hasWhatsAppNumber(waNumber) &&
    !!tenantSlug &&
    (whatsapp.mode === 'direct' || !!waForm?.formId)

  // ── Layout ─────────────────────────────────────────────────────────────────
  // Two-column when map is shown; single full-width column when map is hidden.
  const gridClass = renderMap ? 'grid gap-16 md:grid-cols-2' : 'max-w-[560px]'

  return (
    <SectionContainer id={section.anchorId ?? 'contatti'} style={surfaceStyles}>
      <div className={gridClass}>

        {/* ── Left: contact details (+ optional message button) ───────── */}
        <div className="flex h-full flex-col">
        <SlideUp duration={duration} ease={ease} delay={0}>
          {title && (
            <h2
              className="mb-6 [--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
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
                tenantSlug={tenantSlug as UrlProjectSegment}
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
                tenantSlug={tenantSlug as UrlProjectSegment}
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
              style={{ borderRadius: 'var(--radius-lg)' }}
            >
              <iframe
                src={mapEmbedUrl}
                width="100%"
                height={mapHeight}
                style={{
                  border: 0,
                  display: 'block',
                  borderRadius: 'var(--radius-lg)',
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
