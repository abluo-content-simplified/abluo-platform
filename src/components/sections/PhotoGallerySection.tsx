import type { PhotoGallerySection as PhotoGallerySectionType, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { GalleryPlacement } from '@/components/gallery/GalleryPlacement'
import { galleriesOf } from '@/lib/gallery/compose'

interface Props {
  section: PhotoGallerySectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale: string
}

// ── Photo Gallery section (Gallery module, ADR-022) ───────────────────────────
// Presentation only. The section decides where a gallery appears and how it is
// laid out; the galleries themselves — which photos, in what order — belong to
// the Gallery module and are edited once, wherever they are used.
//
// Layout, tile shapes, focal points, tabs and the lightbox are shared with the
// blog-post gallery through GalleryPlacement.

export function PhotoGallerySection({ section, surface, designSystem, locale }: Props) {
  const { eyebrow, headline, description } = section
  const galleries = galleriesOf(section)
  const hasItems = galleries.some((g) => (g.items ?? []).some((i) => !!i?.mediaAsset))
  // An empty gallery renders nothing on the public site — an admin-facing
  // "no items yet" message would be shown to visitors.
  if (!hasItems) return null

  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])
  const hasHeader = Boolean(eyebrow || headline || description)

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {hasHeader && (
        <SlideUp duration={duration} ease={ease} delay={0} className="mb-12 max-w-2xl">
          {eyebrow && (
            <EyebrowLabel
              eyebrow={eyebrow}
              designSystem={designSystem}
              defaultAccent="none"
              weight="semibold"
              className="mb-5"
            />
          )}
          {headline && (
            <h2
              className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--font-size-h2, var(--fs-h2))',
                fontWeight: 'var(--font-weight-h2, 600)',
                lineHeight: 'var(--line-height-h2, 1.375)',
                letterSpacing: 'var(--letter-spacing-h2, -0.025em)',
              }}
            >
              {headline}
            </h2>
          )}
          {description && (
            <p
              className="mt-5 text-base leading-relaxed"
              style={{
                color: 'var(--color-text-secondary)',
                fontFamily: 'var(--font-body)',
                maxWidth: '52ch',
              }}
            >
              {description}
            </p>
          )}
        </SlideUp>
      )}

      <GalleryPlacement
        galleries={galleries}
        layout={section.layout}
        columns={section.columns}
        imageRatio={section.imageRatio}
        spacing={section.spacing}
        showCaptions={section.showCaptions}
        lightbox={section.lightbox}
        display={section.galleryDisplay}
        showAllTab={section.showAllTab}
        anchorId={section.anchorId}
        structuredDataName={headline}
        locale={locale}
        designSystem={designSystem}
      />
    </SectionContainer>
  )
}
