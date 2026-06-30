import type { TeamSection, PortableTextContent, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import { IMAGE_HOVER_CLASSES } from '@/lib/image-presentation'

interface Props {
  section: TeamSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

function RichText({ blocks }: { blocks: PortableTextContent }) {
  return (
    <div className="space-y-3">
      {blocks.map((block) => {
        if (block._type !== 'block') return null
        const text = block.children.map((c) => c.text).join('')
        return (
          <p key={block._key} className="text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {text}
          </p>
        )
      })}
    </div>
  )
}

export function TeamSection({ section, surface, designSystem }: Props) {
  const { title, subtitle, intro, members } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  return (
    <SectionContainer style={surfaceStyles}>
      {/* Section header */}
      <SlideUp duration={duration} ease={ease} delay={0} className="mb-16 max-w-2xl">
        {subtitle && (
          <p
            className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {subtitle}
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
        {intro && intro.length > 0 && (
          <div className="mt-6">
            <RichText blocks={intro} />
          </div>
        )}
        <div className="mt-6 h-[1px] w-12" style={{ backgroundColor: 'var(--color-border)' }} />
      </SlideUp>

      {/* Members grid — 1 col → 2 col (sm) → 3 col (lg) → 4 col (xl) */}
      {members && members.length > 0 && (
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {members.map((member, index) => {
            const src = imageUrl(member.photo, 600)
            const srcSet = imageSrcSet(member.photo, [300, 600, 900])

            return (
              <SlideUp key={member._key} duration={duration} ease={ease} delay={index * 0.07}>
                <div className="group flex flex-col">
                  {/* Photo or initials placeholder */}
                  <div
                    className="relative mb-6 w-full overflow-hidden"
                    style={{
                      aspectRatio: '3 / 4',
                      backgroundColor: 'var(--color-surface)',
                      // Border radius uses the DS token — will become a DS media token in future
                      borderRadius: 'var(--radius-lg)',
                    }}
                  >
                    {src ? (
                      <img
                        src={src}
                        srcSet={srcSet}
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
                        alt={member.name}
                        className={`h-full w-full object-cover ${IMAGE_HOVER_CLASSES}`}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <span
                          className="text-3xl font-light"
                          style={{ color: 'var(--color-text-muted)' }}
                          aria-hidden="true"
                        >
                          {member.name
                            .split(' ')
                            .filter((w) => w.length > 1)
                            .slice(0, 2)
                            .map((w) => w[0])
                            .join('')}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Name */}
                  <p
                    className="mb-1 text-base font-semibold"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {member.name}
                  </p>

                  {/* Role */}
                  {member.role && (
                    <p
                      className="mb-4 text-xs font-medium uppercase tracking-wide"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {member.role}
                    </p>
                  )}

                  {/* Divider */}
                  <div
                    className="mb-4 h-[1px] w-8 transition-all duration-300 group-hover:w-14"
                    style={{ backgroundColor: 'var(--color-border)' }}
                  />

                  {/* Bio */}
                  {member.bio && (
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {member.bio}
                    </p>
                  )}
                </div>
              </SlideUp>
            )
          })}
        </div>
      )}
    </SectionContainer>
  )
}
