'use client'

import { useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { StepHeading, languageName } from '@/components/client/create/StepHeading'
import { countWords } from '@/lib/client/normalize-blocks'
import { languageStates, languageSummaryKey, overviewSections, type OverviewSection, type SectionState } from '@/lib/client/wizard-steps'

/**
 * The overview (ADR-025 · "review"): once the first pass is over, a draft
 * reopens here. One calm list of the post's parts, each with its state and an
 * Edit button that opens just that step ("Done" comes back here), plus Preview.
 * The shell's main button goes on to Publish.
 */
export function ReviewStep({
  draft,
  site,
  onEdit,
  onPreview,
  menu = [],
  status,
  notice,
}: StepProps & {
  onEdit: (section: OverviewSection['id']) => void
  onPreview: () => void
  /** The "…" menu: lifecycle actions (take offline, discard, delete …). */
  menu?: { key: string; label: string; onSelect: () => void }[]
  /** Where the live version stands ("Live on your site since …"), edit mode only. */
  status?: string | null
  notice?: { kind: 'status' | 'error'; text: string } | null
}) {
  const t = useTranslations('clientDashboard.create.review')
  const tm = useTranslations('clientDashboard.create.menu')
  const [menuOpen, setMenuOpen] = useState(false)
  const tp = useTranslations('clientDashboard.create.publish')
  const ui = useLocale()
  const d = site.defaultLocale
  const labels = new Map(site.categories.map((c) => [c.value, c.label]))

  const summary = (id: OverviewSection['id']): ReactNode => {
    switch (id) {
      case 'category':
        return draft.categories.length ? draft.categories.map((k) => labels.get(k) ?? k).join(', ') : t('noCategory')
      case 'title':
        return draft.title[d]?.trim() ? (
          <>
            <span className="block font-medium text-foreground">{draft.title[d]}</span>
            {draft.subtitle[d]?.trim() ? <span className="block">{draft.subtitle[d]}</span> : null}
          </>
        ) : (
          t('noTitle')
        )
      case 'story': {
        const words = countWords(draft.body[d])
        return words ? t('words', { count: words }) : t('noStory')
      }
      case 'cover':
        return !draft.cover ? t('noCover') : !draft.cover.alt[d]?.trim() ? t('coverAltMissing') : t('coverSet')
      case 'languages':
        return languageStates(
          draft,
          site.languages.filter((l) => l !== d)
        )
          .map(({ locale, state }) => `${languageName(locale, ui)} ${state === 'ready' ? '✓' : `– ${tp(languageSummaryKey(state, 'draft'))}`}`)
          .join(' · ')
    }
  }

  return (
    <section aria-labelledby="review-step-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <StepHeading id="review-step-title" title={draft.title[d]?.trim() || t('title')} helper={t('helper')} />
        </div>
        {menu.length > 0 ? (
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label={tm('label')}
              aria-expanded={menuOpen}
              aria-controls="review-menu"
              onClick={() => setMenuOpen((o) => !o)}
              className="grid size-11 place-items-center rounded-full border border-border text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <path d="M5 12h.01M12 12h.01M19 12h.01" />
              </svg>
            </button>
            {menuOpen ? (
              <ul
                id="review-menu"
                className="absolute right-0 z-10 mt-2 w-64 overflow-hidden rounded-2xl border border-border bg-popover py-1 text-popover-foreground shadow-[var(--shadow-raise)]"
              >
                {menu.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false)
                        item.onSelect()
                      }}
                      className="flex min-h-12 w-full items-center px-4 text-left text-[15px] text-foreground hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      {status ? <p className="mt-4 text-[15px] font-medium text-foreground">{status}</p> : null}
      {draft.mode === 'edit' ? <p className="mt-1 text-[15px] leading-6 text-muted-foreground">{t('editing')}</p> : null}
      <p
        role={notice?.kind === 'error' ? 'alert' : 'status'}
        className={`mt-2 min-h-5 text-[15px] ${notice?.kind === 'error' ? 'text-destructive' : 'text-success'}`}
      >
        {notice?.text}
      </p>

      <ul className="mt-8 divide-y divide-border-subtle border-y border-border-subtle">
        {overviewSections(draft, site).map(({ id, state }) => {
          const name = t(`sections.${id}`)
          return (
            <li key={id} className="flex items-start gap-4 py-5">
              {id === 'cover' && draft.cover?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${draft.cover.url}?w=160&h=160&fit=crop&auto=format`}
                  alt=""
                  width={56}
                  height={56}
                  className="size-14 shrink-0 rounded-xl object-cover"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[17px] font-semibold text-foreground">{name}</h2>
                  <StateBadge state={state} label={t(`state.${state}`)} />
                </div>
                <p className="mt-1 line-clamp-3 text-[15px] leading-6 text-muted-foreground">{summary(id)}</p>
              </div>
              <button
                type="button"
                onClick={() => onEdit(id)}
                aria-label={t('editLabel', { section: name })}
                className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border px-4 text-[15px] font-semibold text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {t('edit')}
              </button>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={onPreview}
        className="mt-6 inline-flex min-h-11 items-center gap-2 text-[17px] font-semibold text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {t('preview')}
      </button>
    </section>
  )
}

function StateBadge({ state, label }: { state: SectionState; label: string }) {
  if (state === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m5 12 5 5L20 7" />
        </svg>
        {label}
      </span>
    )
  }
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        state === 'missing' ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
      }`}
    >
      {label}
    </span>
  )
}
