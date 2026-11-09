'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { CardGrid, CardGridItem, ContentCard } from '@/components/app/ui/list/ContentCard'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { isShiftChange } from '@/components/app/ui/Checkbox'
import type { DataTableSelection } from '@/components/app/ui/list/DataTable'
import { courseColorVar } from '@/lib/modules/courses/palette'
import {
  COURSE_ICONS,
  CourseColorDot,
  CourseNextClass,
  CourseRunsUntil,
  CourseStatusPill,
  CourseWhen,
  CourseWhenToggle,
  useTeachersText,
  type CourseListContext,
  type CourseRow,
} from './course-bits'

type CardProps = {
  rows: CourseRow[]
  ctx: CourseListContext
  /** Square checkboxes (bulk bar); absent when the person can't change anything. */
  selection?: DataTableSelection<CourseRow>
  onOpen: (row: CourseRow, newTab: boolean) => void
  menuFor: (row: CourseRow) => CardMenuItem[]
  /** The one course whose classes are all shown. */
  expandedId: string | null
  onToggleExpanded: (id: string) => void
}

/** The card's media area: the course's colour (soft tint of the site's palette) with a calendar mark in its dot colour. */
function ColourMedia({ row }: { row: CourseRow }) {
  const tinted = row.color !== 'none'
  return (
    <div
      className={`absolute inset-0 grid place-items-center ${tinted ? '' : 'bg-muted text-muted-foreground'}`}
      style={tinted ? { backgroundColor: `var(${courseColorVar(row.color as Exclude<CourseRow['color'], 'none'>, 'bg')})`, color: `var(${courseColorVar(row.color as Exclude<CourseRow['color'], 'none'>, 'dot')})` } : undefined}
    >
      <span aria-hidden="true">{COURSE_ICONS.calendar}</span>
    </div>
  )
}

/** "Label  value" — one fact line at the bottom of a card. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm leading-6">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="flex min-w-0 justify-end text-right">{children}</span>
    </div>
  )
}

/**
 * Desktop cards view: the generic CardGrid / ContentCard configured for
 * courses — the media area carries the course's colour, then the title, the
 * teachers, the status pill, the weekly classes ("+N" shows all of them in
 * place, like the table), the next class and when the course runs until. ⋯
 * top-right.
 */
export function CoursesCardsGrid({ rows, ctx, selection, onOpen, menuFor, expandedId, onToggleExpanded }: CardProps) {
  const t = useTranslations('clientDashboard.courses.list')
  const teachersText = useTeachersText()
  return (
    <CardGrid label={t('title')}>
      {rows.map((c) => (
        <CardGridItem key={c.id}>
          <ContentCard
            media={{ src: null, alt: '' }}
            mediaContent={<ColourMedia row={c} />}
            title={c.title || t('untitled')}
            subtitle={teachersText(c.schedule?.teachers) || undefined}
            href={c.href}
            selection={selection ? { checked: selection.selected.has(c.id), onChange: (checked, shift) => selection.onToggle(c.id, checked, shift), label: selection.rowLabel(c) } : undefined}
            onOpen={(newTab) => onOpen(c, newTab)}
            overlay={<CardMenu variant="chip" label={t('menu', { name: c.title })} items={menuFor(c)} />}
          >
            <CourseStatusPill row={c} ctx={ctx} />
            <CourseWhen row={c} ctx={ctx} expanded={expandedId === c.id} onToggle={() => onToggleExpanded(c.id)} />
            <div className="mt-auto flex flex-col border-t border-border-subtle pt-2">
              <Fact label={t('columns.next')}>
                <CourseNextClass row={c} ctx={ctx} align="end" />
              </Fact>
              <Fact label={t('columns.until')}>
                <CourseRunsUntil row={c} ctx={ctx} />
              </Fact>
            </div>
          </ContentCard>
        </CardGridItem>
      ))}
    </CardGrid>
  )
}

/**
 * Phones: one row per course (ListRow) — colour dot and title, teachers,
 * status, the next class and the weekly classes ("+N" right under them); tapping opens the editor, "+N"
 * (outside the row's link) shows every class, ⋯ for the rest.
 */
export function CoursesPhoneList({ rows, ctx, selection, menuFor, expandedId, onToggleExpanded }: Omit<CardProps, 'onOpen'>) {
  const t = useTranslations('clientDashboard.courses.list')
  const teachersText = useTeachersText()
  return (
    <ul className="flex flex-col gap-3" aria-label={t('title')}>
      {rows.map((c) => {
        const teachers = teachersText(c.schedule?.teachers)
        return (
          <ListRow
            key={c.id}
            href={c.href}
            select={selection ? { checked: selection.selected.has(c.id), label: selection.rowLabel(c), onChange: (checked, e) => selection.onToggle(c.id, checked, isShiftChange(e)) } : undefined}
            menu={{ label: t('menu', { name: c.title }), items: menuFor(c) }}
            after={<CourseWhenToggle row={c} ctx={ctx} expanded={expandedId === c.id} onToggle={() => onToggleExpanded(c.id)} />}
          >
            <span className="flex w-full min-w-0 items-start gap-2">
              <span className="flex h-[1.375rem] items-center">
                <CourseColorDot color={c.color} />
              </span>
              <span className="line-clamp-2 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{c.title || t('untitled')}</span>
            </span>
            {teachers ? <span className="line-clamp-1 text-sm leading-5 text-muted-foreground">{teachers}</span> : null}
            <CourseStatusPill row={c} ctx={ctx} />
            {c.schedule?.nextClassAt ? (
              <span className="flex items-start gap-2 text-sm leading-6">
                <span className="text-muted-foreground">{t('columns.next')}</span>
                <CourseNextClass row={c} ctx={ctx} />
              </span>
            ) : null}
            <CourseWhen row={c} ctx={ctx} expanded={expandedId === c.id} onToggle={() => onToggleExpanded(c.id)} withToggle={false} />
          </ListRow>
        )
      })}
    </ul>
  )
}
