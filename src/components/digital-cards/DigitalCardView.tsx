import type { CSSProperties } from 'react'
import Link from 'next/link'
import { FadeIn } from '@/components/animation/FadeIn'
import { SlideUp } from '@/components/animation/SlideUp'
import { Icon, socialIconName } from '@/components/icons'
import { focalObjectPosition } from '@/lib/gallery/focal'
import { imageSrcSet, imageUrl } from '@/lib/sanity/image'
import { resolveEasing } from '@/lib/motion/easing'
import type { MotionTokens } from '@/lib/sanity/types'
import { DIGITAL_CARD_CREDIT, type DigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'
import type { CardLinkView, CardView } from '@/lib/modules/digital-cards/website'
import { CardBeacon } from './CardBeacon'
import { CardContacts } from './CardContacts'
import { CardQrButton } from './CardQrButton'
import { EncodedLink } from './EncodedLink'

/**
 * A Digital Card (ADR-049) — one calm, mobile-first screen in the site's own
 * design system. No colours, fonts or themes of its own (D4): every colour is
 * a design-system variable. The one personalisation, the background image,
 * sits behind a readability layer made of the site's own background colour.
 *
 * Contacts never appear in this server HTML in plain text (D9): they arrive
 * encoded in the view model and are assembled by the client components.
 * Rendered inside the bare card layout (no header / footer / banner, D10).
 */
export interface DigitalCardViewProps {
  view: CardView
  messages: DigitalCardSiteMessages
  /** Legal pages (privacy, legal notice) — the card's automatic footer. */
  legalLinks: ReadonlyArray<{ label: string; href: string; external?: boolean }>
  projectSlug: string
  /** Production deployment on the project's own domain — see CardBeacon. */
  countable: boolean
  motion?: MotionTokens | null
  /**
   * The dashboard editor's live preview (Amendment A): the card fills its
   * frame instead of the window (background absolute, not fixed), and nothing
   * is counted. The editor makes the frame inert, so nothing in it can be used.
   */
  preview?: boolean
}

const FOCUS = 'outline-offset-2 focus-visible:outline focus-visible:outline-2'
const FOCUS_STYLE: CSSProperties = { outlineColor: 'var(--color-primary)' }

const BUTTON = `flex min-h-12 w-full items-center justify-center gap-2 px-5 py-3 text-center text-base font-semibold transition-opacity hover:opacity-90 ${FOCUS}`
/** A link with a one-liner: label and line stacked, still one target of at least 48px. */
const BUTTON_STACKED = `flex min-h-12 w-full flex-col items-center justify-center gap-0.5 px-5 py-2.5 text-center transition-opacity hover:opacity-90 ${FOCUS}`
const PRIMARY_STYLE: CSSProperties = {
  ...FOCUS_STYLE,
  backgroundColor: 'var(--btn-primary-bg, var(--color-primary))',
  color: 'var(--btn-primary-text)',
  borderRadius: 'var(--radius-btn, var(--radius-md))',
  border: '1px solid transparent',
  fontFamily: 'var(--font-body)',
}
const SECONDARY_STYLE: CSSProperties = {
  ...FOCUS_STYLE,
  backgroundColor: 'var(--btn-secondary-bg, var(--color-surface))',
  color: 'var(--btn-secondary-text, var(--color-text-primary))',
  borderRadius: 'var(--radius-btn, var(--radius-md))',
  border: '1px solid var(--color-border)',
  fontFamily: 'var(--font-body)',
}

/**
 * A link's logo (Amendment A, 10): decorative, on a small neutral tile in the
 * card's background colour so any logo stays readable on any button colour.
 * Absolutely placed at the start of the button (the label stays centred, the
 * same with or without a logo); the image is 24px high, up to 48px wide, never
 * cropped; the tile is a fixed 32px tall with ~4px padding.
 */
function CardLogoTile({ logo }: { logo: NonNullable<CardLinkView['logo']> }) {
  return (
    <span
      data-card-link-logo=""
      aria-hidden="true"
      className="pointer-events-none absolute start-3 top-1/2 flex h-8 -translate-y-1/2 items-center justify-center p-1"
      style={{ backgroundColor: 'var(--color-background)', borderRadius: 'var(--radius-sm, var(--radius-md))' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Media Library logo, sized by the helper */}
      <img src={logo.src} alt="" width={logo.width} height={24} loading="lazy" decoding="async" className="h-6 w-auto max-w-12 object-contain" />
    </span>
  )
}

function CardButton({ link, primary, messages }: { link: CardLinkView; primary: boolean; messages: DigitalCardSiteMessages }) {
  const style = primary ? PRIMARY_STYLE : SECONDARY_STYLE
  // The accessible name is the label (+ "opens in a new tab"); the one-liner is
  // its description: aria-hidden inside the link so it stays out of the name,
  // and referenced by aria-describedby so screen readers still read it.
  const descriptionId = link.description ? `card-link-desc-${link.key}` : undefined
  // With a logo the button reserves room for the tile on BOTH sides, so labels stay centred and aligned with the buttons that have none.
  const className = `${link.description ? BUTTON_STACKED : BUTTON}${link.logo ? ' relative !px-[4.5rem]' : ''}`
  const label = link.description ? (
    <>
      {link.logo && <CardLogoTile logo={link.logo} />}
      <span className="text-base font-semibold">
        {link.label}
        {link.external && <span className="sr-only"> ({messages.opensInNewTab})</span>}
      </span>
      <span id={descriptionId} aria-hidden="true" className="text-sm leading-5 font-normal opacity-75">
        {link.description}
      </span>
    </>
  ) : (
    <>
      {link.logo && <CardLogoTile logo={link.logo} />}
      {link.label}
      {link.external && <span className="sr-only"> ({messages.opensInNewTab})</span>}
    </>
  )
  if (link.hrefEnc) {
    return (
      <EncodedLink hrefEnc={link.hrefEnc} linkKey={link.key} external={link.external} hint={messages.needsScript} className={className} style={style} describedBy={descriptionId}>
        {label}
      </EncodedLink>
    )
  }
  if (!link.href) return null
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" data-card-link={link.key} className={className} style={style} aria-describedby={descriptionId}>
        {label}
      </a>
    )
  }
  return (
    <Link href={link.href} data-card-link={link.key} className={className} style={style} aria-describedby={descriptionId}>
      {label}
    </Link>
  )
}

export function DigitalCardView({ view, messages, legalLinks, projectSlug, countable, motion, preview = false }: DigitalCardViewProps) {
  // Motion only through the platform primitives, timed by the design system.
  const duration = motion?.durationSlow !== undefined ? motion.durationSlow / 1000 : 0.35
  const ease = resolveEasing(motion?.easingDecelerate, [0.0, 0.0, 0.2, 1])
  const bg = view.background
  const avatar = view.photo
  const logo = view.logo
  const muted: CSSProperties = { color: 'var(--color-text-secondary)' }

  return (
    <div className={`relative isolate w-full ${preview ? 'min-h-full' : 'min-h-[100svh]'}`} style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}>
      {bg && (
        <>
          {/* Decorative: the Media Library image, its focal point kept in view. */}
          <img
            src={imageUrl(bg, 1280)}
            srcSet={imageSrcSet(bg, [640, 960, 1280, 1920])}
            sizes="100vw"
            alt=""
            aria-hidden="true"
            className={`${preview ? 'absolute' : 'fixed'} inset-0 -z-20 h-full w-full object-cover`}
            style={{ objectPosition: focalObjectPosition(bg) }}
          />
          {/* Readability layer: the site's own background colour, no new colour. */}
          <div
            aria-hidden="true"
            className={`${preview ? 'absolute' : 'fixed'} inset-0 -z-10`}
            style={{ background: 'color-mix(in oklab, var(--color-background) 80%, transparent)' }}
          />
        </>
      )}
      {preview ? null : <CardBeacon projectSlug={projectSlug} cardId={view.publicId} countable={countable} />}

      <div className="mx-auto flex w-full max-w-[28rem] flex-col items-center gap-8 px-5 pb-10 pt-12 text-center sm:pt-16">
        <FadeIn duration={duration} ease={ease} className="flex w-full flex-col items-center gap-3">
          {avatar && (
            <img
              src={imageUrl(avatar.image, 320)}
              alt={avatar.alt}
              width={112}
              height={112}
              className="h-28 w-28 rounded-full object-cover"
              style={{ objectPosition: focalObjectPosition(avatar.image), border: '1px solid var(--color-border)' }}
            />
          )}
          {logo && (
            logo.light && imageUrl(logo.light.image, 480) !== imageUrl(logo.dark.image, 480) ? (
              <>
                {/* Two versions: the light one shows under html.light (the theme the site renders in). */}
                <img src={imageUrl(logo.dark.image, 480)} alt={logo.dark.alt} className="h-16 w-auto max-w-[70%] object-contain [html.light_&]:hidden" />
                <img src={imageUrl(logo.light.image, 480)} alt={logo.light.alt} className="hidden h-16 w-auto max-w-[70%] object-contain [html.light_&]:block" />
              </>
            ) : (
              <img src={imageUrl(logo.dark.image, 480)} alt={logo.dark.alt} className="h-16 w-auto max-w-[70%] object-contain" />
            )
          )}
          {view.name && (
            <h1
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--font-size-h3, 1.75rem)',
                fontWeight: 'var(--font-weight-h3, 600)',
                lineHeight: 'var(--line-height-h3, 1.2)',
              }}
            >
              {view.name}
            </h1>
          )}
          {view.role && (
            <p className="text-base" style={muted}>
              {view.role}
            </p>
          )}
          {view.business &&
            (view.business.href ? (
              <Link href={view.business.href} className={`text-sm font-medium underline-offset-4 hover:underline ${FOCUS}`} style={{ ...FOCUS_STYLE, color: 'var(--color-text-primary)' }}>
                {view.business.name}
              </Link>
            ) : (
              <p className="text-sm font-medium">{view.business.name}</p>
            ))}
          {view.description && (
            <p className="max-w-prose whitespace-pre-line text-base leading-relaxed" style={muted}>
              {view.description}
            </p>
          )}
        </FadeIn>

        {(view.primary || view.links.length > 0) && (
          <SlideUp duration={duration} ease={ease} className="w-full">
            <nav aria-label={messages.linksHeading} className="w-full">
              <ul className="flex w-full flex-col gap-3">
                {view.primary && (
                  <li>
                    <CardButton link={view.primary} primary messages={messages} />
                  </li>
                )}
                {view.links.map((l) => (
                  <li key={l.key}>
                    <CardButton link={l} primary={false} messages={messages} />
                  </li>
                ))}
              </ul>
            </nav>
          </SlideUp>
        )}

        {view.contacts.length > 0 && (
          <CardContacts contacts={view.contacts} heading={messages.contactHeading} hint={messages.needsScript} opensInNewTab={messages.opensInNewTab} />
        )}

        {view.socials.length > 0 && (
          <nav aria-label={messages.socialsHeading} className="w-full">
            <ul className="flex flex-wrap justify-center gap-2">
              {view.socials.map((s) => (
                <li key={s.key}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex min-h-11 items-center gap-2 px-3 py-2 text-sm font-medium transition-opacity hover:opacity-80 ${FOCUS}`}
                    style={{ ...FOCUS_STYLE, color: 'var(--color-text-primary)' }}
                  >
                    <Icon name={socialIconName(s.icon) ?? s.icon} size={18} />
                    <span>{s.label}</span>
                    <span className="sr-only"> ({messages.opensInNewTab})</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {view.locations.length > 0 && (
          <section aria-label={messages.locationsHeading} className="flex w-full flex-col gap-4 text-sm">
            {view.locations.map((l) => (
              <address key={l.key} className="flex flex-col items-center gap-1 not-italic">
                {l.name && <span className="font-medium">{l.name}</span>}
                {l.lines.map((line, i) => (
                  <span key={i} style={muted}>
                    {line}
                  </span>
                ))}
                {l.mapsUrl && (
                  <a
                    href={l.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex min-h-11 items-center gap-1 px-2 font-medium underline-offset-4 hover:underline ${FOCUS}`}
                    style={{ ...FOCUS_STYLE, color: 'var(--color-text-primary)' }}
                  >
                    <Icon name="map-pin" size={16} />
                    {messages.directions}
                    <span className="sr-only"> ({messages.opensInNewTab})</span>
                  </a>
                )}
              </address>
            ))}
          </section>
        )}

        <div className="flex w-full flex-col items-center gap-3">
            {view.saveContactHref && (
              // A plain link to the route handler: the browser downloads the .vcf.
              <a href={view.saveContactHref} className={BUTTON} style={SECONDARY_STYLE} rel="nofollow">
                {messages.saveContact}
              </a>
            )}
            {view.profile && (
              <Link
                href={view.profile.href}
                className={`inline-flex min-h-11 items-center gap-1 px-2 text-sm font-medium underline-offset-4 hover:underline ${FOCUS}`}
                style={{ ...FOCUS_STYLE, color: 'var(--color-text-primary)' }}
              >
                {view.profile.label}
                <Icon name="arrow-right" size={16} />
              </Link>
            )}
            {view.qr && <CardQrButton url={view.qr.url} address={view.qr.address} messages={messages} />}
            {/* The product's own credit: always shown, not tied to showAbluoCredit, and not a card link (no data-card-link → never counted as a click). */}
            <a
              href={DIGITAL_CARD_CREDIT.href}
              target="_blank"
              rel="noopener"
              data-card-credit
              translate="no"
              className={`inline-flex min-h-11 items-center px-2 text-xs underline-offset-4 hover:underline ${FOCUS}`}
              style={{ ...FOCUS_STYLE, ...muted }}
            >
              {DIGITAL_CARD_CREDIT.text}
              <span className="sr-only"> ({messages.opensInNewTab})</span>
            </a>
          </div>

        {legalLinks.length > 0 && (
          <footer className="mt-4 w-full">
            <nav aria-label={messages.legalHeading}>
              <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
                {legalLinks.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      className={`inline-flex min-h-11 items-center underline-offset-4 hover:underline ${FOCUS}`}
                      style={{ ...FOCUS_STYLE, ...muted }}
                      {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </footer>
        )}
      </div>
    </div>
  )
}
