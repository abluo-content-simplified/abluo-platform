import type { HeroSection } from '@/lib/sanity/types'

interface Props {
  section: HeroSection
}

export function HeroSection({ section }: Props) {
  const { eyebrow, headline, subheadline, ctaLabel, ctaHref } = section

  const headlineLines = headline?.split('\n') ?? []

  return (
    <section
      className="relative flex min-h-[88vh] flex-col justify-center px-6 py-24 md:px-16 lg:px-24"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      {/* Decorative left border accent */}
      <div
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ backgroundColor: 'var(--color-primary)' }}
        aria-hidden="true"
      />

      <div className="mx-auto w-full max-w-5xl">
        {/* Eyebrow */}
        {eyebrow && (
          <p
            className="mb-8 animate-fade-slide-up text-xs font-medium uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-text-muted)', animationDelay: '0s' }}
          >
            {eyebrow}
          </p>
        )}

        {/* Headline */}
        <h1
          className="mb-8 animate-fade-slide-up text-5xl font-semibold leading-[1.1] tracking-tight md:text-6xl lg:text-7xl"
          style={{
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-heading)',
            animationDelay: eyebrow ? '0.1s' : '0s',
          }}
        >
          {headlineLines.length > 1 ? (
            headlineLines.map((line, i) => (
              <span key={i} className="block">{line}</span>
            ))
          ) : (
            headline
          )}
        </h1>

        {/* Divider */}
        <div
          className="mb-8 h-[1px] w-16 animate-fade-slide-up"
          style={{
            backgroundColor: 'var(--color-border)',
            animationDelay: eyebrow ? '0.2s' : '0.1s',
          }}
        />

        {/* Subheadline */}
        {subheadline && (
          <p
            className="mb-12 max-w-xl animate-fade-slide-up text-lg leading-relaxed"
            style={{
              color: 'var(--color-text-secondary)',
              animationDelay: eyebrow ? '0.3s' : '0.2s',
            }}
          >
            {subheadline}
          </p>
        )}

        {/* CTA */}
        {ctaLabel && (
          <a
            href={ctaHref ?? '#'}
            className="inline-flex h-12 animate-fade-slide-up items-center gap-2 px-8 text-sm font-medium tracking-wide transition-opacity hover:opacity-85"
            style={{
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-background)',
              animationDelay: eyebrow ? '0.4s' : '0.3s',
            }}
          >
            {ctaLabel}
            <span aria-hidden="true" style={{ opacity: 0.6 }}>→</span>
          </a>
        )}
      </div>

      {/* Bottom scroll indicator */}
      <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
        <div
          className="h-8 w-[1px] animate-pulse"
          style={{ backgroundColor: 'var(--color-border)' }}
        />
      </div>
    </section>
  )
}
