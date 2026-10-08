'use client'

import { bodyParagraphs } from '@/lib/whats-new/model'
import { LocalDate } from './list/cells'

/**
 * One product update ("What's new", ADR-030) as a client reads it: date,
 * optional "New" mark, title, optional image, plain-text body (paragraphs and
 * line breaks) and an optional button that opens an external https link.
 *
 * Shared because the admin previews exactly what the client will see. All
 * copy arrives translated (and already in the reader's language); the caller
 * passes the "New" and "opens in a new tab" labels.
 */
export function UpdateCard({
  title,
  body,
  imageUrl,
  cta,
  publishedAt,
  newLabel,
  opensInNewTabLabel,
  lang,
}: {
  title: string
  body: string
  imageUrl: string | null
  cta: { label: string; url: string } | null
  publishedAt: string | null
  /** Shown as a small mark when given (the update is unread). */
  newLabel?: string | null
  opensInNewTabLabel: string
  /** The language the text is written in, when it differs from the page's. */
  lang?: string
}) {
  const paragraphs = bodyParagraphs(body)
  return (
    <article lang={lang} className="flex flex-col gap-3">
      <div className="flex min-h-6 items-center gap-2 text-sm text-muted-foreground">
        {publishedAt ? <LocalDate iso={publishedAt} /> : null}
        {newLabel ? (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-accent px-2.5 text-xs font-medium text-accent-foreground">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-action" />
            {newLabel}
          </span>
        ) : null}
      </div>
      <h3 className="text-[1.0625rem] leading-6 font-semibold text-foreground">{title}</h3>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL, not a next/image source
        <img src={imageUrl} alt="" loading="lazy" className="aspect-[16/9] w-full rounded-xl border border-border-subtle bg-muted object-cover" />
      ) : null}
      {paragraphs.length ? (
        <div className="space-y-3 text-[0.9375rem] leading-6 text-foreground">
          {paragraphs.map((lines, i) => (
            <p key={i}>
              {lines.map((line, j) => (
                <span key={j}>
                  {j > 0 ? <br /> : null}
                  {line}
                </span>
              ))}
            </p>
          ))}
        </div>
      ) : null}
      {cta ? (
        <div>
          <a
            href={cta.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-[0.9375rem] font-medium text-foreground transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {cta.label}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 17 17 7M8 7h9v9" />
            </svg>
            <span className="sr-only"> {opensInNewTabLabel}</span>
          </a>
        </div>
      ) : null}
    </article>
  )
}
