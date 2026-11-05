'use client'

import { useTranslations } from 'next-intl'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { CardGrid, CardGridItem, ContentCard } from '@/components/app/ui/list/ContentCard'
import { LocalDate } from '@/components/app/ui/list/cells'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { colorClass, COURSE_ICONS, CourseStateBadge, MissingPills, useClassesText, type CourseRow } from './course-bits'

type CardProps = {
  rows: CourseRow[]
  onOpen: (row: CourseRow, newTab: boolean) => void
  menuFor: (row: CourseRow) => CardMenuItem[]
}

/** The card's media area: the course's colour (a design-system token) with a calendar mark. */
function ColourMedia({ row }: { row: CourseRow }) {
  return (
    <div className={`absolute inset-0 grid place-items-center text-muted-foreground ${colorClass(row.color)}`}>
      <span aria-hidden="true">{COURSE_ICONS.calendar}</span>
    </div>
  )
}

/**
 * Desktop cards view: the generic CardGrid / ContentCard configured for
 * courses — the media area carries the course's colour, then title, short
 * description, status, weekly classes, teachers and the last update. ⋯ top-right.
 */
export function CoursesCardsGrid({ rows, onOpen, menuFor }: CardProps) {
  const t = useTranslations('clientDashboard.courses.list')
  const classesText = useClassesText()
  return (
    <CardGrid label={t('title')}>
      {rows.map((c) => (
        <CardGridItem key={c.id}>
          <ContentCard
            media={{ src: null, alt: '' }}
            mediaContent={<ColourMedia row={c} />}
            title={c.title || t('untitled')}
            subtitle={c.shortDescription || undefined}
            href={c.href}
            onOpen={(newTab) => onOpen(c, newTab)}
            overlay={<CardMenu variant="chip" label={t('menu', { name: c.title })} items={menuFor(c)} />}
          >
            <span className="flex flex-wrap items-start gap-1.5">
              <CourseStateBadge state={c.state} />
            </span>
            <MissingPills languages={c.missingLanguages} state={c.state} />
            <p className="text-sm leading-5 text-muted-foreground">
              {t('columns.classes')}: <span className="text-foreground">{classesText(c.schedule)}</span>
            </p>
            {c.schedule?.teachers.length ? <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">{c.schedule.teachers.join(', ')}</p> : null}
            <p className="mt-auto flex items-baseline justify-between gap-3 text-xs leading-5">
              <span className="text-muted-foreground">{t('columns.updated')}</span>
              <LocalDate iso={c.updatedAt} empty="—" className="text-right text-foreground tabular-nums" />
            </p>
          </ContentCard>
        </CardGridItem>
      ))}
    </CardGrid>
  )
}

/** Phones: one row per course (ListRow) — title, short description, status, classes — tapping opens the editor; ⋯ for the rest. */
export function CoursesPhoneList({ rows, menuFor }: Pick<CardProps, 'rows' | 'menuFor'>) {
  const t = useTranslations('clientDashboard.courses.list')
  const classesText = useClassesText()
  return (
    <ul className="flex flex-col gap-3" aria-label={t('title')}>
      {rows.map((c) => (
        <ListRow key={c.id} href={c.href} menu={{ label: t('menu', { name: c.title }), items: menuFor(c) }}>
          <span className="line-clamp-2 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{c.title || t('untitled')}</span>
          {c.shortDescription ? <span className="line-clamp-2 text-sm leading-5 text-foreground">{c.shortDescription}</span> : null}
          <span className="flex flex-wrap items-start gap-1.5">
            <CourseStateBadge state={c.state} />
          </span>
          <MissingPills languages={c.missingLanguages} state={c.state} />
          <span className="text-sm leading-5 text-muted-foreground">{classesText(c.schedule)}</span>
        </ListRow>
      ))}
    </ul>
  )
}
