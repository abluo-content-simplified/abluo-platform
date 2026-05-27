import type { TeamSection } from '@/lib/sanity/types'

interface Props {
  section: TeamSection
}

export function TeamSection({ section }: Props) {
  const { title, subtitle, members } = section

  return (
    <section className="bg-white px-6 py-24 md:px-16 lg:px-24">
      <div className="mx-auto w-full max-w-5xl">
        {/* Section header */}
        <div className="mb-16">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
            {subtitle ?? 'Team'}
          </p>
          {title && (
            <h2 className="text-3xl font-semibold leading-snug tracking-tight text-zinc-900 md:text-4xl">
              {title}
            </h2>
          )}
          <div className="mt-6 h-[1px] w-12 bg-zinc-200" />
        </div>

        {/* Members grid */}
        {members && members.length > 0 && (
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member) => (
              <div key={member._key} className="group flex flex-col">
                {/* Avatar placeholder */}
                <div className="mb-6 flex h-20 w-20 items-center justify-center bg-zinc-100">
                  <span className="text-2xl font-light text-zinc-400" aria-hidden="true">
                    {member.name
                      .split(' ')
                      .filter((w) => w.length > 1)
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join('')}
                  </span>
                </div>

                {/* Name + role */}
                <p className="mb-1 text-base font-semibold text-zinc-900">
                  {member.name}
                </p>
                {member.role && (
                  <p className="mb-4 text-xs font-medium uppercase tracking-wide text-zinc-400">
                    {member.role}
                  </p>
                )}

                {/* Divider */}
                <div className="mb-4 h-[1px] w-8 bg-zinc-200 transition-all group-hover:w-16" />

                {/* Bio */}
                {member.bio && (
                  <p className="text-sm leading-relaxed text-zinc-500">{member.bio}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
