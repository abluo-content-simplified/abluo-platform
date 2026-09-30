import type { LocationsSection as LocationsSectionType, SiteLocation, WebsiteSiteConfig, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { resolveEasing } from '@/lib/motion/easing'
import { getLocationsSectionMessages } from '@/lib/i18n/locations-section-messages'
import { formatLocationAddress, getLocationMapsLink, selectLocations } from '@/lib/maps/locations'

interface Props {
  section: LocationsSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  /** The locations live in siteConfig.locations — this section only presents them. */
  siteConfig?: WebsiteSiteConfig | null
  /** Page locale — picks the dictionary label for the Maps link. */
  locale?: string
}

/**
 * LocationsSection — presentation of siteConfig.locations[] (Sections vs
 * Modules: the section owns no data). Each location renders with DOM id =
 * its key, so `/contact#brey` scrolls to it. The Maps link is an outbound
 * link only — no embed, no cookies, no consent needed.
 */
export function LocationsSection({ section, surface, designSystem, siteConfig, locale }: Props) {
  const locations = selectLocations(siteConfig?.locations, section.selection, section.locationKeys)
  if (locations.length === 0) return null

  const { eyebrow, title, intro } = section
  const layout = section.layout === 'list' ? 'list' : 'cards'
  const msg = getLocationsSectionMessages(locale)
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const hasHeader = !!(eyebrow || title || intro)

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {hasHeader && (
        <SlideUp duration={duration} ease={ease} delay={0} className="mb-12 max-w-2xl">
          {eyebrow && <EyebrowLabel eyebrow={eyebrow} designSystem={designSystem} className="mb-4" />}
          {title && (
            <h2
              className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
            >
              {title}
            </h2>
          )}
          {intro && (
            <p className="mt-6 text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)', whiteSpace: 'pre-line' }}>
              {intro}
            </p>
          )}
        </SlideUp>
      )}

      {layout === 'cards' ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((location, index) => (
            <SlideUp key={location._key ?? location.key} duration={duration} ease={ease} delay={index * 0.07}>
              <LocationEntry
                location={location}
                msg={msg}
                className="flex h-full flex-col p-6"
                style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}
              />
            </SlideUp>
          ))}
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--color-border)' }}>
          {locations.map((location, index) => (
            <SlideUp key={location._key ?? location.key} duration={duration} ease={ease} delay={index * 0.05}>
              <LocationEntry
                location={location}
                msg={msg}
                className="grid gap-3 py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-10"
                style={{ borderBottom: '1px solid var(--color-border)' }}
                split
              />
            </SlideUp>
          ))}
        </div>
      )}
    </SectionContainer>
  )
}

function LocationEntry({
  location,
  msg,
  className,
  style,
  split = false,
}: {
  location: SiteLocation
  msg: ReturnType<typeof getLocationsSectionMessages>
  className: string
  style: React.CSSProperties
  /** List layout: name in the left column, details in the right. */
  split?: boolean
}) {
  const addressLines = formatLocationAddress(location.address)
  const mapsLink = getLocationMapsLink(location)

  const details = (
    <div className="flex flex-1 flex-col gap-3">
      {addressLines.length > 0 && (
        <address className="text-sm not-italic leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
          {addressLines.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </address>
      )}
      {location.accessNote && (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)', whiteSpace: 'pre-line' }}>
          {location.accessNote}
        </p>
      )}
      {mapsLink && (
        <a
          href={mapsLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex items-center gap-1 self-start pt-1 text-sm font-medium underline-offset-4 hover:underline"
          style={{ color: 'var(--color-primary)' }}
        >
          {msg.openInMaps}
          <span aria-hidden="true">↗</span>
          <span className="sr-only"> ({msg.opensInNewTab})</span>
        </a>
      )}
    </div>
  )

  return (
    // The key doubles as the DOM id so other pages can link to one place (/contact#brey).
    <article id={location.key} className={`scroll-mt-24 ${className}`} style={style}>
      <h3
        className={`text-lg font-semibold ${split ? '' : 'mb-3'}`}
        style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
      >
        {location.name ?? location.key}
      </h3>
      {details}
    </article>
  )
}
