import type { ContentSection, PortableTextContent, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from './SectionContainer'

function RichText({ blocks }: { blocks: PortableTextContent }) {
  return (
    <div className="space-y-4">
      {blocks.map((block) => {
        if (block._type !== 'block') return null
        const text = block.children.map((c) => c.text).join('')
        if (block.style === 'h2') {
          return (
            <h2 key={block._key} className="text-2xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {text}
            </h2>
          )
        }
        if (block.style === 'h3') {
          return (
            <h3 key={block._key} className="text-xl font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {text}
            </h3>
          )
        }
        return (
          <p key={block._key} className="text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {text}
          </p>
        )
      })}
    </div>
  )
}

interface Props {
  section: ContentSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

export function ContentSection({ section, surface, designSystem }: Props) {
  const { eyebrow, title, body } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlow for content sections; divide ms → seconds for motion/react
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  return (
      <SectionContainer style={surfaceStyles}>
        <div className="grid gap-12 md:grid-cols-2 md:gap-20 lg:gap-28">
          {/* Left: label + title */}
          <SlideUp duration={duration} ease={ease} delay={0} className="flex flex-col justify-center">
            {eyebrow && (
              <p
                className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {eyebrow}
              </p>
            )}
            {title && (
              <h2
                className="text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
              >
                {title}
              </h2>
            )}
          </SlideUp>

          {/* Right: body text */}
          <SlideUp duration={duration} ease={ease} delay={0.1} className="flex flex-col justify-center">
            {body && <RichText blocks={body} />}
          </SlideUp>
        </div>
      </SectionContainer>

  )
}
