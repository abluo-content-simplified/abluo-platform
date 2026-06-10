import type { TreatmentsSection } from '@/lib/sanity/types'

interface Props {
  section: TreatmentsSection
}

export function TreatmentsSection({ section }: Props) {
  const { eyebrow, title, intro, treatments } = section

  return (
    <section
      id="trattamenti"
      className="px-6 py-24 md:px-16 lg:px-24"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <div className="mx-auto w-full max-w-5xl">
        {/* Header */}
        <div className="mb-16">
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
              className="mb-6 text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
            >
              {title}
            </h2>
          )}
          {intro && (
            <p
              className="max-w-2xl text-base leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {intro}
            </p>
          )}
          <div className="mt-8 h-[1px] w-12" style={{ backgroundColor: 'var(--color-border)' }} />
        </div>

        {/* Treatment rows */}
        {treatments && treatments.length > 0 && (
          <div className="grid gap-0" style={{ borderTop: '1px solid var(--color-border)' }}>
            {treatments.map((treatment, index) => (
              <div
                key={treatment._key}
                className="group grid gap-6 py-10 md:grid-cols-[2rem_1fr_2fr] md:gap-12"
                style={{ borderBottom: '1px solid var(--color-border)' }}
              >
                {/* Number */}
                <span
                  className="hidden text-sm font-light md:block"
                  style={{ color: 'var(--color-border)' }}
                >
                  {String(index + 1).padStart(2, '0')}
                </span>

                {/* Left: name + tagline */}
                <div className="flex flex-col justify-start">
                  <h3
                    className="mb-2 text-lg font-semibold"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {treatment.name}
                  </h3>
                  {treatment.tagline && (
                    <p
                      className="text-sm font-medium italic"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {treatment.tagline}
                    </p>
                  )}
                </div>

                {/* Right: description */}
                {treatment.description && (
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {treatment.description}
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
