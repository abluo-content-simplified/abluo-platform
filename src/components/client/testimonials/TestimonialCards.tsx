'use client'

import { useTranslations } from 'next-intl'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { CardGrid, CardGridItem, ContentCard } from '@/components/app/ui/list/ContentCard'
import { LocalDate, Pill } from '@/components/app/ui/list/cells'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { ICONS, MissingLanguages, RatingValue, TestimonialStateBadge, type TestimonialRow } from './testimonial-bits'

type CardProps = {
  rows: TestimonialRow[]
  onOpen: (row: TestimonialRow, newTab: boolean) => void
  menuFor: (row: TestimonialRow) => CardMenuItem[]
}

/** The card's media area: a calm preview of the quote instead of a picture (testimonials have none). Top-aligned. */
function QuotePreview({ text, emptyLabel }: { text: string; emptyLabel: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-stretch justify-start gap-2 bg-muted p-4">
      {text ? (
        <p className="flex items-start gap-2 text-sm leading-5 text-foreground">
          <span className="mt-0.5 shrink-0 text-muted-foreground">{ICONS.quote}</span>
          <span className="line-clamp-5 min-w-0">{text}</span>
        </p>
      ) : (
        <p className="text-sm leading-5 text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  )
}

/**
 * Desktop cards view: the generic CardGrid / ContentCard configured for
 * testimonials — the media area previews the quote, then the name, status,
 * missing languages, rating and the last update. ⋯ top-right.
 */
export function TestimonialCardsGrid({ rows, onOpen, menuFor }: CardProps) {
  const t = useTranslations('clientDashboard.testimonials.list')
  return (
    <CardGrid label={t('title')}>
      {rows.map((r) => (
        <CardGridItem key={r.id}>
          <ContentCard
            media={{ src: null }}
            mediaContent={<QuotePreview text={r.excerpt} emptyLabel={t('noText')} />}
            title={r.name}
            href={r.href}
            onOpen={(newTab) => onOpen(r, newTab)}
            overlay={<CardMenu variant="chip" label={t('menu', { name: r.name })} items={menuFor(r)} />}
          >
            <span className="flex flex-wrap items-start gap-1.5">
              <TestimonialStateBadge state={r.state} />
              {r.featured ? <Pill tone="highlight">{t('featured')}</Pill> : null}
              <MissingLanguages locales={r.missingLocales} />
            </span>
            {r.rating !== null ? <RatingValue rating={r.rating} /> : null}
            <p className="mt-auto flex items-baseline justify-between gap-3 text-xs leading-5">
              <span className="text-muted-foreground">{t('columns.updated')}</span>
              <LocalDate iso={r.updatedAt} empty="—" className="text-right text-foreground tabular-nums" />
            </p>
          </ContentCard>
        </CardGridItem>
      ))}
    </CardGrid>
  )
}

/** Phones: one row per testimonial (ListRow) — name, status, the excerpt, rating — tapping opens the editor; ⋯ for the rest. */
export function TestimonialPhoneList({ rows, menuFor }: Pick<CardProps, 'rows' | 'menuFor'>) {
  const t = useTranslations('clientDashboard.testimonials.list')
  return (
    <ul className="flex flex-col gap-3" aria-label={t('title')}>
      {rows.map((r) => (
        <ListRow key={r.id} href={r.href} menu={{ label: t('menu', { name: r.name }), items: menuFor(r) }}>
          <span className="line-clamp-2 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{r.name}</span>
          <span className="flex flex-wrap items-start gap-1.5">
            <TestimonialStateBadge state={r.state} />
            {r.featured ? <Pill tone="highlight">{t('featured')}</Pill> : null}
            <MissingLanguages locales={r.missingLocales} />
          </span>
          {r.excerpt ? <span className="line-clamp-2 text-sm leading-5 text-foreground">{r.excerpt}</span> : null}
          {r.rating !== null ? <RatingValue rating={r.rating} /> : null}
        </ListRow>
      ))}
    </ul>
  )
}
