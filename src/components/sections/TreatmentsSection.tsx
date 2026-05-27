import type { TreatmentsSection } from '@/lib/sanity/types'

interface Props {
  section: TreatmentsSection
}

export function TreatmentsSection({ section }: Props) {
  const { eyebrow, title, intro, treatments } = section

  return (
    <section id="trattamenti" className="bg-white px-6 py-24 md:px-16 lg:px-24">
      <div className="mx-auto w-full max-w-5xl">
        {/* Header */}
        <div className="mb-16">
          {eyebrow && (
            <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
              {eyebrow}
            </p>
          )}
          {title && (
            <h2 className="mb-6 text-3xl font-semibold leading-snug tracking-tight text-zinc-900 md:text-4xl">
              {title}
            </h2>
          )}
          {intro && (
            <p className="max-w-2xl text-base leading-relaxed text-zinc-500">{intro}</p>
          )}
          <div className="mt-8 h-[1px] w-12 bg-zinc-200" />
        </div>

        {/* Treatment cards */}
        {treatments && treatments.length > 0 && (
          <div className="grid gap-0 divide-y divide-zinc-100">
            {treatments.map((treatment, index) => (
              <div
                key={treatment._key}
                className="group grid gap-6 py-10 md:grid-cols-[2rem_1fr_2fr] md:gap-12"
              >
                {/* Number */}
                <span className="hidden text-sm font-light text-zinc-300 md:block">
                  {String(index + 1).padStart(2, '0')}
                </span>

                {/* Left: name + tagline */}
                <div className="flex flex-col justify-start">
                  <h3 className="mb-2 text-lg font-semibold text-zinc-900">
                    {treatment.name}
                  </h3>
                  {treatment.tagline && (
                    <p className="text-sm font-medium italic text-zinc-400">
                      {treatment.tagline}
                    </p>
                  )}
                </div>

                {/* Right: description */}
                {treatment.description && (
                  <p className="text-sm leading-relaxed text-zinc-500">
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
