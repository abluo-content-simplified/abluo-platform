import type { StatementSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { FadeIn } from '@/components/animation/FadeIn'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import type { ResolvedImage } from '@/lib/sanity/types'
import { resolveEasing } from '@/lib/motion/easing'
import { renderHeadline } from '@/lib/headline-accent'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'

interface Props {
  section: StatementSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

export function StatementSection({ section, surface, designSystem }: Props) {
  const { eyebrow, headline, headlineAccent, description, alignment = 'left', image, imagePosition = 'right' } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const hasImage = Boolean(image?.asset)
  const isCenter = !hasImage && alignment === 'center'
  const imageOnLeft = hasImage && imagePosition === 'left'

  const textBlock = (
    <SlideUp duration={duration} ease={ease} delay={0} className="flex flex-col justify-center">
      {eyebrow && (
        <EyebrowLabel
          eyebrow={eyebrow}
          designSystem={designSystem}
          defaultAccent="none"
          weight="semibold"
          className={isCenter ? 'mb-5 justify-center' : 'mb-5'}
        />
      )}
      {headline && (
        <h2
          className={`[--fs-h2:2.25rem] md:[--fs-h2:3rem] lg:[--fs-h2:3.75rem]${isCenter ? ' mx-auto' : ''}`}
          style={{
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-heading)',
            maxWidth: isCenter ? '18ch' : undefined,
            fontSize: 'var(--font-size-h2, var(--fs-h2))',
            fontWeight: 'var(--font-weight-h2, 600)',
            lineHeight: 'var(--line-height-h2, 1.1)',
            letterSpacing: 'var(--letter-spacing-h2, -0.025em)',
          }}
        >
          {renderHeadline(headline, headlineAccent)}
        </h2>
      )}
      {description && (
        <p
          className={`mt-7 text-lg leading-relaxed${isCenter ? ' mx-auto' : ''}`}
          style={{
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-body)',
            maxWidth: isCenter ? '55ch' : '52ch',
          }}
        >
          {description}
        </p>
      )}
    </SlideUp>
  )

  const imageBlock = hasImage ? (
    <FadeIn duration={duration} ease={ease} delay={0.12} className="flex items-center">
      <div
        className="relative w-full overflow-hidden rounded-[var(--radius-lg)]"
        style={{ aspectRatio: '4 / 3' }}
      >
        <img
          src={imageUrl(image as ResolvedImage, 1200) ?? ''}
          srcSet={imageSrcSet(image as ResolvedImage, [600, 900, 1200, 1600])}
          sizes="(max-width: 768px) 100vw, 50vw"
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      </div>
    </FadeIn>
  ) : null

  return (
      <SectionContainer id={section.anchorId} style={surfaceStyles}>
        {hasImage ? (
          /* Two-column layout: text + image */
          <div
            className={`flex flex-col gap-12 md:grid md:grid-cols-2 md:gap-16 lg:gap-24${imageOnLeft ? ' md:[&>*:first-child]:order-2' : ''}`}
          >
            {imageOnLeft ? (
              <>
                {imageBlock}
                {textBlock}
              </>
            ) : (
              <>
                {textBlock}
                {imageBlock}
              </>
            )}
          </div>
        ) : (
          /* Text-only: left or center aligned */
          <div className={isCenter ? 'text-center' : 'max-w-3xl'}>
            {textBlock}
          </div>
        )}
      </SectionContainer>

  )
}
