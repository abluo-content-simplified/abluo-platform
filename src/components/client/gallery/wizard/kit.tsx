'use client'

/**
 * Pieces of the blog wizard (v1.0.45) copied for the gallery and media
 * wizards: NameFields (title + description with limits), the overview's "…"
 * menu and state badge, and the done screen. The preview frame and the languages
 * pieces are shared with the blog wizard (create/PreviewPane, create/LanguageChoices).
 */
import { useTranslations } from 'next-intl'
import type { SectionState } from '@/lib/client/wizard-steps'
import { ButtonLink } from '@/components/app/ui/Button'
import { CardMenu } from '@/components/app/ui/CardMenu'
import { TextArea } from '@/components/app/ui/TextInput'
import { Pill } from '@/components/app/ui/list/cells'

// ── TitleFields (blog TitleStep) ─────────────────────────────────────────────

function Remaining({ value, max, id }: { value: string; max: number; id: string }) {
  const t = useTranslations('clientDashboard.create.titleStep')
  const left = max - value.length
  return (
    <p id={id} aria-live="polite" className="mt-2 min-h-5 text-sm text-muted-foreground">
      {left <= Math.max(20, Math.round(max * 0.2)) ? t('remaining', { count: Math.max(0, left) }) : ''}
    </p>
  )
}

function Source({ id, label, lang, text }: { id: string; label: string; lang: string; text: string }) {
  return (
    <div id={id} className="mt-2 rounded-xl bg-muted px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p lang={lang} className="mt-1 text-[1.0625rem] leading-7 break-words text-foreground">
        {text}
      </p>
    </div>
  )
}

/** Title + second line (a gallery's description), the blog TitleStep's fields. */
export function NameFields({
  idPrefix,
  title,
  description,
  onTitle,
  onDescription,
  labels,
  placeholders,
  max,
  autoFocus,
  lang,
  source,
}: {
  idPrefix: string
  title: string
  description: string
  onTitle: (v: string) => void
  onDescription: (v: string) => void
  labels: { title: string; description: string }
  placeholders: { title: string; description: string }
  max: { title: number; description: number }
  autoFocus?: boolean
  lang?: string
  source?: {
    label: string
    lang: string
    title: string
    description: string
    empty: string
  }
}) {
  return (
    <div className="mt-8 flex flex-col gap-6">
      <div>
        <label htmlFor={`${idPrefix}-title`} className="text-[0.9375rem] font-medium text-foreground">
          {labels.title}
        </label>
        {source ? (
          <Source id={`${idPrefix}-title-src`} label={source.label} lang={source.lang} text={source.title || source.empty} />
        ) : null}
        <TextArea
          id={`${idPrefix}-title`}
          lang={lang}
          rows={2}
          value={title}
          maxLength={max.title}
          autoFocus={autoFocus}
          required
          aria-describedby={source ? `${idPrefix}-title-src ${idPrefix}-title-left` : `${idPrefix}-title-left`}
          placeholder={placeholders.title}
          data-enter-next=""
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          onChange={(e) => onTitle(e.target.value.replace(/\n/g, ' '))}
          textSize="title"
          className="overflow-x-hidden"
        />
        <Remaining id={`${idPrefix}-title-left`} value={title} max={max.title} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-description`} className="text-[0.9375rem] font-medium text-foreground">
          {labels.description}
        </label>
        {source && source.description ? (
          <Source id={`${idPrefix}-description-src`} label={source.label} lang={source.lang} text={source.description} />
        ) : null}
        {/* Wraps long words inside the field — no horizontal scrollbar on phones. */}
        <TextArea
          id={`${idPrefix}-description`}
          lang={lang}
          rows={2}
          value={description}
          maxLength={max.description}
          aria-describedby={
            source?.description ? `${idPrefix}-description-src ${idPrefix}-description-left` : `${idPrefix}-description-left`
          }
          placeholder={placeholders.description}
          data-enter-next=""
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          onChange={(e) => onDescription(e.target.value.replace(/\n/g, ' '))}
          textSize="lead"
          className="overflow-x-hidden whitespace-pre-wrap"
        />
        <Remaining id={`${idPrefix}-description-left`} value={description} max={max.description} />
      </div>
    </div>
  )
}

// ── Overview pieces (blog ReviewStep) ────────────────────────────────────────

export function OverviewMenu({ items, label }: { items: { key: string; label: string; onSelect: () => void }[]; label: string }) {
  return <CardMenu label={label} items={items} />
}

export function StateBadge({ state, label }: { state: SectionState; label: string }) {
  if (state === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m5 12 5 5L20 7" />
        </svg>
        {label}
      </span>
    )
  }
  return <Pill tone={state === 'missing' ? 'highlight' : 'muted'}>{label}</Pill>
}

// ── Done (blog DoneStep) ─────────────────────────────────────────────────────

/** The blog DoneStep's screen: check mark, heading, body and the way back. */
export function DoneScreen({ heading, body, backHref, backLabel }: { heading: string; body: string; backHref: string; backLabel: string }) {
  return (
    <section aria-labelledby="done-step-title" className="flex flex-col items-start pt-10">
      <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-muted text-success">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m5 12 5 5L20 7" />
        </svg>
      </span>
      <h1 id="done-step-title" className="mt-6 text-[1.875rem] leading-9 font-semibold tracking-tight text-foreground">
        {heading}
      </h1>
      <p className="mt-3 text-[1.0625rem] leading-7 text-muted-foreground">{body}</p>
      <div className="mt-10 flex w-full flex-col gap-3 sm:flex-row">
        <ButtonLink href={backHref} variant="primary" size="lg">
          {backLabel}
        </ButtonLink>
      </div>
    </section>
  )
}
