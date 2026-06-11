import type { TeamSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'

interface Props {
  section: TeamSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

export function TeamSection({ section, surface, designSystem }: Props) {
  const { title, subtitle, members } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  return (
    <section
      className="px-6 py-24 md:px-16 lg:px-24"
      style={surfaceStyles}
    >
      <div className="mx-auto w-full max-w-5xl">
        {/* Section header */}
        <div className="mb-16">
          <p
            className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {subtitle ?? 'Team'}
          </p>
          {title && (
            <h2
              className="text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
            >
              {title}
            </h2>
          )}
          <div className="mt-6 h-[1px] w-12" style={{ backgroundColor: 'var(--color-border)' }} />
        </div>

        {/* Members grid */}
        {members && members.length > 0 && (
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member) => (
              <div key={member._key} className="group flex flex-col">
                {/* Avatar */}
                <div
                  className="mb-6 flex h-20 w-20 items-center justify-center"
                  style={{ backgroundColor: 'var(--color-surface)' }}
                >
                  <span
                    className="text-2xl font-light"
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

                {/* Name + role */}
                <p
                  className="mb-1 text-base font-semibold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {member.name}
                </p>
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
                  className="mb-4 h-[1px] w-8 transition-all group-hover:w-16"
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
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
