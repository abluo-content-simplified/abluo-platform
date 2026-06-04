import Image from 'next/image'
import Link from 'next/link'
import { PlayCircle } from 'lucide-react'
import { SlideUp, FadeIn, StaggerChildren } from '@/components/animation'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import type { Event, SupportedLocale } from '@/lib/sanity/types'

interface LivePageContentProps {
  event: Event | null
  locale: SupportedLocale
}

// ─── No event fallback ────────────────────────────────────────────────────────

function NoLiveEvent() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-10">
      <div className="text-center">
        <p className="font-['Barlow_Condensed'] text-2xl font-semibold text-white/40">
          No live event scheduled right now.
        </p>
        <p className="mt-2 text-sm text-white/25">Check back soon.</p>
      </div>
    </div>
  )
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Event['status'] }) {
  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-red-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        Live
      </span>
    )
  }
  if (status === 'upcoming') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-[#ffa22b]/25 bg-[#ffa22b]/12 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-[#ffa22b]">
        Upcoming
      </span>
    )
  }
  return null
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LivePageContent({ event, locale }: LivePageContentProps) {
  if (!event) return <NoLiveEvent />

  const heroSrc = imageUrl(event.heroImage, 1600)
  const heroSrcSet = imageSrcSet(event.heroImage, [800, 1200, 1600, 2400])
  const gallerySrc = event.gallery?.[0] ? imageUrl(event.gallery[0], 1600) : undefined
  const gallerySrcSet = event.gallery?.[0] ? imageSrcSet(event.gallery[0], [800, 1200, 1600]) : undefined

  // Format date range for display
  const startDate = event.startDate
    ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(event.startDate))
    : null
  const endDate = event.endDate
    ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(event.endDate))
    : null

  const channelUrl = event.youtubeChannelUrl ?? 'https://www.youtube.com/@livener-net'

  return (
    <div
      className="min-h-screen bg-[#161d2b]"
      style={{
        backgroundImage: 'url(/livener/bkg.svg)',
        backgroundPosition: '50% 0',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '121%',
      }}
    >
      <div className="mx-auto max-w-[900px] px-5 pb-24 pt-12 md:px-10">

        {/* ── Page hero ────────────────────────────────────────────── */}
        <SlideUp duration={0.6}>
          <h1 className="font-['Barlow_Condensed'] text-[clamp(48px,8vw,68px)] font-bold leading-[1.05] text-[#f2f2f2]">
            Welcome to Livener
          </h1>
        </SlideUp>

        <SlideUp delay={0.1} duration={0.6}>
          <h2 className="mt-3 font-['Barlow_Condensed'] text-[clamp(22px,4vw,32px)] font-semibold leading-tight text-[#ffa22b]">
            Live video streaming, in the palm of your hands
          </h2>
        </SlideUp>

        <SlideUp delay={0.18} duration={0.5}>
          <p className="mt-4 text-sm font-medium text-[#f2f2f2]/60">
            Currently in beta — tested live, in real environments.
          </p>
        </SlideUp>

        {/* ── Event announcement ────────────────────────────────────── */}
        <div className="mt-14">
          <SlideUp delay={0.05}>
            <div className="flex items-center gap-3">
              <StatusBadge status={event.status} />
            </div>
          </SlideUp>

          <SlideUp delay={0.12}>
            <h2 className="mt-4 font-['Barlow_Condensed'] text-[clamp(28px,5vw,46px)] font-bold leading-tight text-[#f2f2f2]">
              {event.title}
            </h2>
          </SlideUp>

          {(startDate || event.location) && (
            <SlideUp delay={0.2}>
              <p className="mt-2 font-['Barlow_Condensed'] text-xl font-semibold text-[#ffa22b]">
                {startDate && endDate
                  ? `${startDate} — ${endDate}`
                  : startDate}
                {event.location && (
                  <span className="ml-2 text-[#f2f2f2]/50">· {event.location}</span>
                )}
              </p>
            </SlideUp>
          )}
        </div>

        {/* ── Hero image ───────────────────────────────────────────── */}
        {heroSrc && (
          <FadeIn delay={0.1} className="mt-10 overflow-hidden rounded-2xl">
            <img
              src={heroSrc}
              srcSet={heroSrcSet}
              sizes="(max-width: 900px) 100vw, 900px"
              alt={event.heroImage?.alt ?? event.title ?? ''}
              className="w-full object-cover"
              loading="eager"
            />
          </FadeIn>
        )}

        {/* ── Body content ─────────────────────────────────────────── */}
        {event.shortDescription && (
          <SlideUp delay={0.05} className="mt-10">
            <p className="text-base leading-relaxed text-[#f2f2f2]/75">
              {event.shortDescription}
            </p>
          </SlideUp>
        )}

        {/* ── YouTube link ─────────────────────────────────────────── */}
        <SlideUp delay={0.1} className="mt-8">
          <p className="text-base leading-relaxed text-[#f2f2f2]/75">
            Visit{' '}
            <Link
              href={channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#ffa22b] underline-offset-2 hover:underline"
            >
              {channelUrl.replace('https://', '')}
            </Link>{' '}
            to see the future of live streaming.
          </p>
        </SlideUp>

        {/* ── Watch on YouTube CTA ──────────────────────────────────── */}
        <SlideUp delay={0.15} className="mt-10">
          <Link
            href={event.youtubeUrl ?? channelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-3 rounded-xl border-2 border-[#ffa22b] bg-[#ffa22b] px-6 py-3.5 font-['Poppins'] text-sm font-semibold text-white transition-all hover:border-[#363366] hover:bg-[#363366]"
          >
            <PlayCircle size={18} />
            {event.ctaLabel ?? 'Watch on YouTube'}
          </Link>
        </SlideUp>

        {/* ── Gallery image ─────────────────────────────────────────── */}
        {gallerySrc && (
          <FadeIn delay={0.1} className="mt-14 overflow-hidden rounded-2xl">
            <img
              src={gallerySrc}
              srcSet={gallerySrcSet}
              sizes="(max-width: 900px) 100vw, 900px"
              alt={event.gallery?.[0]?.alt ?? ''}
              className="w-full object-cover"
              loading="lazy"
            />
          </FadeIn>
        )}

      </div>
    </div>
  )
}
