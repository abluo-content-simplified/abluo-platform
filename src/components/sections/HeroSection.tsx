import type { HeroSection } from '@/lib/sanity/types'

interface Props {
  section: HeroSection
}

export function HeroSection({ section }: Props) {
  const { eyebrow, headline, subheadline, ctaLabel, ctaHref } = section

  // Split headline on newline for visual line control
  const headlineLines = headline?.split('\n') ?? []

  return (
    <section className="relative flex min-h-[88vh] flex-col justify-center bg-white px-6 py-24 md:px-16 lg:px-24">
      {/* Decorative left border accent */}
      <div
        className="absolute left-0 top-0 h-full w-[3px] bg-zinc-900"
        aria-hidden="true"
      />

      <div className="mx-auto w-full max-w-5xl">
        {/* Eyebrow label */}
        {eyebrow && (
          <p
            className="mb-8 animate-fade-slide-up text-xs font-medium uppercase tracking-[0.2em] text-zinc-400"
            style={{ animationDelay: '0s' }}
          >
            {eyebrow}
          </p>
        )}

        {/* Headline */}
        <h1
          className="mb-8 animate-fade-slide-up text-5xl font-semibold leading-[1.1] tracking-tight text-zinc-900 md:text-6xl lg:text-7xl"
          style={{ animationDelay: eyebrow ? '0.1s' : '0s' }}
        >
          {headlineLines.length > 1 ? (
            headlineLines.map((line, i) => (
              <span key={i} className="block">
                {line}
              </span>
            ))
          ) : (
            headline
          )}
        </h1>

        {/* Divider */}
        <div
          className="mb-8 h-[1px] w-16 animate-fade-slide-up bg-zinc-300"
          style={{ animationDelay: eyebrow ? '0.2s' : '0.1s' }}
        />

        {/* Subheadline */}
        {subheadline && (
          <p
            className="mb-12 max-w-xl animate-fade-slide-up text-lg leading-relaxed text-zinc-500"
            style={{ animationDelay: eyebrow ? '0.3s' : '0.2s' }}
          >
            {subheadline}
          </p>
        )}

        {/* CTA */}
        {ctaLabel && (
          <a
            href={ctaHref ?? '#'}
            className="inline-flex h-12 animate-fade-slide-up items-center gap-2 bg-zinc-900 px-8 text-sm font-medium tracking-wide text-white transition-colors hover:bg-zinc-700"
            style={{ animationDelay: eyebrow ? '0.4s' : '0.3s' }}
          >
            {ctaLabel}
            <span aria-hidden="true" className="text-zinc-400">
              →
            </span>
          </a>
        )}
      </div>

      {/* Bottom scroll indicator */}
      <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
        <div className="h-8 w-[1px] animate-pulse bg-zinc-300" />
      </div>
    </section>
  )
}
