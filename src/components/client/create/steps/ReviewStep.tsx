'use client'

import type { ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { Button } from '@/components/app/ui/Button'
import { CardMenu } from '@/components/app/ui/CardMenu'
import { Pill } from '@/components/app/ui/list/cells'
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
  menu?: { key: string; label: string; onSelect: () => void; destructive?: boolean; separated?: boolean }[]
  /** Where the live version stands ("Live on your site since …"), edit mode only. */
  status?: string | null
  notice?: { kind: 'status' | 'error'; text: string } | null
}) {
  const t = useTranslations('clientDashboard.create.review')
  const tg = useTranslations('clientDashboard.gallery.post')
  const tm = useTranslations('clientDashboard.create.menu')
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
      case 'cta': {
        const ctas = site.ctas ?? []
        const mode = draft.cta?.mode ?? 'default'
        if (mode === 'none') return t('ctaNone')
        if (mode === 'custom') return ctas.find((c) => c.id === draft.cta?.ref)?.name ?? t('ctaNone')
        const def = ctas.find((c) => c.isDefault)
        return def ? t('ctaDefault', { name: def.name }) : t('ctaNoDefault')
      }
      case 'gallery':
        return (site.galleries ?? []).find((g) => g.id === draft.gallery)?.title ?? tg('none')
    }
  }

  return (
    <section aria-labelledby="review-step-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <StepHeading id="review-step-title" title={draft.title[d]?.trim() || t('title')} helper={t('helper')} />
        </div>
        {menu.length > 0 ? <CardMenu label={tm('label')} items={menu} /> : null}
      </div>
      {status ? <p className="mt-4 text-[0.9375rem] font-medium text-foreground">{status}</p> : null}
      {draft.mode === 'edit' ? <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{t('editing')}</p> : null}
      <p
        role={notice?.kind === 'error' ? 'alert' : 'status'}
        className={`mt-2 min-h-5 text-[0.9375rem] ${notice?.kind === 'error' ? 'text-destructive' : 'text-success'}`}
      >
        {notice?.text}
      </p>

      <ul className="mt-8 divide-y divide-border-subtle border-y border-border-subtle">
        {overviewSections(draft, site).map(({ id, state }) => {
          const name = id === 'gallery' ? tg('section') : t(`sections.${id}`)
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
                  <h2 className="text-[1.0625rem] font-semibold text-foreground">{name}</h2>
                  <StateBadge state={state} label={t(`state.${state}`)} />
                </div>
                <p className="mt-1 line-clamp-3 text-[0.9375rem] leading-6 text-muted-foreground">{summary(id)}</p>
              </div>
              <Button onClick={() => onEdit(id)} aria-label={t('editLabel', { section: name })}>
                {t('edit')}
              </Button>
            </li>
          )
        })}
      </ul>

      <Button variant="link" onClick={onPreview} className="mt-6">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {t('preview')}
      </Button>
    </section>
  )
}

function StateBadge({ state, label }: { state: SectionState; label: string }) {
  if (state === 'done') {
    return (
      <Pill
        tone="success"
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m5 12 5 5L20 7" />
          </svg>
        }
      >
        {label}
      </Pill>
    )
  }
  return <Pill tone={state === 'missing' ? 'highlight' : 'muted'}>{label}</Pill>
}
