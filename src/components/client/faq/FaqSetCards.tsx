'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { CardGrid, CardGridItem, ContentCard } from '@/components/app/ui/list/ContentCard'
import { LocalDate } from '@/components/app/ui/list/cells'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { FAQ_ICONS, FaqStateBadge, MissingLanguages, type FaqRow } from './faq-bits'

type CardProps = {
  rows: FaqRow[]
  canWrite: boolean
  onOpen: (row: FaqRow, newTab: boolean) => void
  onUsedIn: (row: FaqRow) => void
  menuFor: (row: FaqRow) => CardMenuItem[]
}

/**
 * The card's media area: a calm preview of the set — its first two
 * questions — instead of a picture (FAQ sets have none). Top-aligned.
 */
function QuestionPreview({ questions, emptyLabel }: { questions: string[]; emptyLabel: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-stretch justify-start gap-2.5 bg-muted p-4">
      {questions.length ? (
        questions.slice(0, 2).map((q, n) => (
          <p key={n} className="flex items-start gap-2 text-sm leading-5 text-foreground">
            <span className="mt-0.5 shrink-0 text-muted-foreground">{FAQ_ICONS.question}</span>
            <span className="line-clamp-2 min-w-0">{q}</span>
          </p>
        ))
      ) : (
        <p className="text-sm leading-5 text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  )
}

/** "6 questions · Used in 3 places" (the count opens the list). */
function CountsLine({ row, onUsedIn }: { row: FaqRow; onUsedIn: (row: FaqRow) => void }) {
  const t = useTranslations('clientDashboard.faq.list')
  return (
    <p className="flex flex-wrap items-center gap-x-1 text-sm leading-5 text-muted-foreground">
      <span>{t('questions', { count: row.count })}</span>
      <span aria-hidden="true">·</span>
      {row.usedIn.length ? (
        <Button variant="link" className="-my-3 text-sm" onClick={() => onUsedIn(row)} aria-label={t('usedInOpen', { name: row.name, count: row.usedIn.length })}>
          {t('usedInCount', { count: row.usedIn.length })}
        </Button>
      ) : (
        <span>{t('notUsed')}</span>
      )}
    </p>
  )
}

/**
 * Desktop cards view: the generic CardGrid / ContentCard configured for FAQ
 * sets — the media area previews the first two questions, then name, status,
 * missing languages, "N questions · Used in", and the last update. ⋯ top-right.
 */
export function FaqSetCardsGrid({ rows, canWrite, onOpen, onUsedIn, menuFor }: CardProps) {
  const t = useTranslations('clientDashboard.faq.list')
  return (
    <CardGrid label={t('title')}>
      {rows.map((s) => (
        <CardGridItem key={s.id}>
          <ContentCard
            media={{ src: null }}
            mediaContent={<QuestionPreview questions={s.firstQuestions} emptyLabel={t('noQuestions')} />}
            title={s.name}
            href={s.href}
            onOpen={(newTab) => onOpen(s, newTab)}
            overlay={canWrite ? <CardMenu variant="chip" label={t('menu', { name: s.name })} items={menuFor(s)} /> : null}
          >
            <span className="flex flex-wrap items-start gap-1.5">
              <FaqStateBadge state={s.state} />
              <MissingLanguages locales={s.missingLocales} />
            </span>
            <CountsLine row={s} onUsedIn={onUsedIn} />
            <p className="mt-auto flex items-baseline justify-between gap-3 text-xs leading-5">
              <span className="text-muted-foreground">{t('columns.updated')}</span>
              <LocalDate iso={s.updatedAt} empty="—" className="text-right text-foreground tabular-nums" />
            </p>
          </ContentCard>
        </CardGridItem>
      ))}
    </CardGrid>
  )
}

/**
 * Phones: one row per set (ListRow) — name, status, the first question,
 * "N questions · Used in" — tapping opens the editor; ⋯ for the rest
 * (including "Where it's used", which FaqSetsBrowser puts in the menu).
 */
export function FaqSetPhoneList({ rows, canWrite, menuFor }: Pick<CardProps, 'rows' | 'canWrite' | 'menuFor'>) {
  const t = useTranslations('clientDashboard.faq.list')
  return (
    <ul className="flex flex-col gap-3" aria-label={t('title')}>
      {rows.map((s) => (
        <ListRow key={s.id} href={s.href} menu={canWrite ? { label: t('menu', { name: s.name }), items: menuFor(s) } : undefined}>
          <span className="line-clamp-2 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{s.name}</span>
          <span className="flex flex-wrap items-start gap-1.5">
            <FaqStateBadge state={s.state} />
            <MissingLanguages locales={s.missingLocales} />
          </span>
          {s.firstQuestions[0] ? <span className="line-clamp-2 text-sm leading-5 text-foreground">{s.firstQuestions[0]}</span> : null}
          <span className="text-sm leading-5 text-muted-foreground">
            {t('questions', { count: s.count })} · {s.usedIn.length ? t('usedInCount', { count: s.usedIn.length }) : t('notUsed')}
          </span>
        </ListRow>
      ))}
    </ul>
  )
}
