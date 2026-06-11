import type { ContentSection, PortableTextContent, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'

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

  return (
    <section
      className="px-6 py-24 md:px-16 lg:px-24"
      style={surfaceStyles}
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="grid gap-12 md:grid-cols-2 md:gap-20 lg:gap-28">
          {/* Left: label + title */}
          <div className="flex flex-col justify-center">
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
          </div>

          {/* Right: body text */}
          <div className="flex flex-col justify-center">
            {body && <RichText blocks={body} />}
          </div>
        </div>
      </div>
    </section>
  )
}
