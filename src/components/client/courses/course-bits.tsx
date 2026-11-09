'use client'

import { useMemo, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { CourseListItem, CourseListOverview, CourseState } from '@/lib/api/course-drafts'
import type { FilterableCourse } from '@/lib/client/courses-filter'
import type { CourseColor } from '@/lib/modules/courses/model'
import { coursePalette, coursePaletteCssVars, courseColorVar } from '@/lib/modules/courses/palette'
import type { CoursePaletteSource } from '@/lib/api/course-palette'
import {
  changedInWeek,
  courseStatusItems,
  isIncompleteCourse,
  nextException,
  runsUntil,
  siteToday,
  STATUS_TONE,
  visibleWhen,
  weekOf,
  whenLines,
  type CourseStatusItem,
} from '@/lib/modules/courses/list-overview'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { MoreToggle } from '@/components/app/ui/MoreToggle'
import { LocalDate, Pill, useShortDate } from '@/components/app/ui/list/cells'
import { shortMoment } from '@/components/app/lifecycle/publish-plan'
import { useDateLocale } from '@/lib/i18n/date-locale-context'
import { Link } from '@/i18n/navigation'
import { formatDateTime } from '@/lib/i18n/date-locale'
import { useScheduleFormat } from './schedule-bits'

/** Shared bits of the Courses screens (ADR-045): the list row type, the status, colour, classes, limits and icons. */

/** What every row of the list is measured against (computed once per render of the list). */
export type CourseListContext = {
  /** 'YYYY-MM-DD' in the site's zone. */
  today: string
  week: { from: string; to: string }
  /** A place token as a class line names it: the location's short name, else its name ('' = none). */
  placeShort: (token: string) => string
  /** A place token's full name. */
  placeName: (token: string) => string
  /** The site has course pages (a course segment in its main language). */
  coursePages: boolean
}

/** One row of the Courses list (table, cards, phone rows). */
export type CourseRow = FilterableCourse & {
  publicId: string
  shortDescription: string
  color: CourseColor
  isPublished: boolean
  hasDraft: boolean
  schedule: CourseListItem['schedule']
  /** The published version's go-live date (ISO) — shown on a Scheduled badge. */
  publishedAt: string | null
  /** A future unpublish date (ISO). */
  unpublishOn: string | null
  hasImage: boolean
  hasPageAddress: boolean
  /** Where it is on the website (only while online). */
  liveUrl: string | null
  /** The site's time zone, for that date. */
  zone: string
  missingLanguages: string[]
  createdAt: string
  /** The course's editor. */
  href: string
}

/**
 * Input limits, mirroring COURSE_LIMITS in src/lib/api/course-drafts.ts (the
 * server enforces them; the browser only stops typing past them). Kept here so
 * the client bundle never imports the server module.
 */
export const COURSE_UI_LIMITS = { title: 120, shortDescription: 600 } as const

/** The list's context from the overview (places, course pages) and the site zone. */
export function useCourseListContext(overview: Pick<CourseListOverview, 'places' | 'pageSegments'> | undefined, zone: string, defaultLocale: string): CourseListContext {
  return useMemo(() => {
    const today = siteToday(new Date(), zone)
    const byToken = new Map((overview?.places ?? []).map((p) => [p.token, p]))
    return {
      today,
      week: weekOf(today),
      placeShort: (token: string) => (token ? (byToken.get(token)?.short || byToken.get(token)?.name || '') : ''),
      placeName: (token: string) => (token ? (byToken.get(token)?.name ?? '') : ''),
      coursePages: Boolean(overview?.pageSegments?.[defaultLocale]),
    }
  }, [overview, zone, defaultLocale])
}

export function toCourseRow(c: CourseListItem, projectSlug: string, zone: string, ctx?: CourseListContext): CourseRow {
  const s = c.schedule
  const placeTokens = [...new Set((s?.slots ?? []).map((x) => x.placeToken).filter(Boolean))]
  const placeWords = ctx ? placeTokens.flatMap((t) => [ctx.placeName(t), ctx.placeShort(t)]).filter(Boolean) : []
  return {
    id: c.id,
    publicId: c.publicId,
    title: c.title,
    shortDescription: c.shortDescription,
    color: c.color,
    searchText: [c.searchText, ...placeWords].join(' ').toLowerCase(),
    state: c.state,
    isPublished: c.isPublished,
    hasDraft: c.hasDraft,
    schedule: s,
    publishedAt: c.publishedAt,
    unpublishOn: c.unpublishOn ?? null,
    hasImage: c.hasImage ?? false,
    hasPageAddress: c.hasPageAddress ?? false,
    liveUrl: c.liveUrl ?? null,
    zone,
    missingLanguages: c.missingLanguages,
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
    href: `/${projectSlug}/courses/${c.id}`,
    teacherIds: (s?.teacherRefs ?? []).map((p) => p.publicId.toLowerCase()),
    placeTokens,
    languages: s?.languages ?? [],
    weekdays: [...new Set((s?.slots ?? []).map((x) => x.weekday))],
    termIds: s?.termIds ?? [],
    changedThisWeek: ctx ? changedInWeek(s, ctx.week) : false,
    incomplete: isIncompleteCourse({ state: c.state, shortDescription: c.shortDescription, hasImage: c.hasImage ?? false }),
  }
}

/**
 * The course's lifecycle status as the shared lifecycle badge (the editor's
 * header): Draft · Scheduled (+ its date) · Published (+ Pending changes) ·
 * Unpublished · Archived.
 */
export function CourseStateBadge({ state, publishedAt = null, zone, oneLine = false }: { state: CourseState; publishedAt?: string | null; zone?: string; oneLine?: boolean }) {
  const tp = useTranslations('app.lifecycle.publish')
  const dateLocale = useDateLocale()
  if (state === 'changes') return <LifecycleBadge status="published" changes oneLine={oneLine} />
  if (state === 'scheduled' && publishedAt && zone) return <LifecycleBadge status="scheduled" extra={tp('moment', shortMoment(publishedAt, zone, dateLocale))} oneLine={oneLine} />
  return <LifecycleBadge status={state} oneLine={oneLine} />
}

// ── Colour ───────────────────────────────────────────────────────────────────

/** The dashboard's own card colours per theme (globals.css `.abluo-app` --card): the course dots sit on them. */
const APP_CARD = { light: 'oklch(1 0 0)', dark: 'oklch(0.205 0.006 271.1)' } as const

/**
 * The site's course colours as CSS variables for the dashboard, in both of its
 * themes (device or chosen): derived from the website's primary colours by the
 * same helper the website uses (palette.ts), so a course has the same colour
 * here and in the timetable.
 */
export function CoursePaletteStyle({ source }: { source: CoursePaletteSource | null | undefined }) {
  const css = useMemo(() => {
    const light = coursePaletteCssVars(coursePalette({ primary: source?.light, surface: APP_CARD.light, theme: 'light' }), ' ')
    const dark = coursePaletteCssVars(coursePalette({ primary: source?.dark ?? source?.light, surface: APP_CARD.dark, theme: 'dark' }), ' ')
    const one = (s: string) => s.replace(/\n/g, '')
    return `.abluo-app{${one(light)}}.abluo-app[data-theme="dark"]{${one(dark)}}@media (prefers-color-scheme: dark){.abluo-app:not([data-theme]){${one(dark)}}}`
  }, [source?.light, source?.dark])
  return <style dangerouslySetInnerHTML={{ __html: css }} />
}

/** The course's colour dot (a 0.625rem circle); 'none' keeps the space so titles line up. */
export function CourseColorDot({ color }: { color: CourseColor }) {
  if (color === 'none') return <span aria-hidden="true" className="inline-block size-2.5 shrink-0" />
  return <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: `var(${courseColorVar(color, 'dot')})` }} />
}

// ── Course cell (title, teachers) ────────────────────────────────────────────

/** "Julie Van Brabant, Larissa Popa +1": two names, then how many more. */
export function useTeachersText() {
  const t = useTranslations('clientDashboard.courses.list')
  return (names: readonly string[] | undefined): string => {
    const list = names ?? []
    if (list.length <= 2) return list.join(', ')
    return t('teachersMore', { names: list.slice(0, 2).join(', '), count: list.length - 2 })
  }
}

/** The Course column: colour dot + bold title (one line, full title on hover), the teachers muted below. */
export function CourseTitleCell({ row }: { row: CourseRow }) {
  const t = useTranslations('clientDashboard.courses.list')
  const teachersText = useTeachersText()
  const title = row.title || t('untitled')
  const teachers = teachersText(row.schedule?.teachers)
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="flex h-6 items-center">
        <CourseColorDot color={row.color} />
      </span>
      <div className="min-w-0 flex-1">
        <Link href={row.href} title={title} className="block truncate text-sm leading-6 font-semibold text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {title}
        </Link>
        {teachers ? (
          <p title={(row.schedule?.teachers ?? []).join(', ')} className="truncate text-sm leading-5 text-muted-foreground">
            {teachers}
          </p>
        ) : null}
      </div>
    </div>
  )
}

// ── When ─────────────────────────────────────────────────────────────────────

/**
 * The course's weekly classes as short lines ("Mon 12:30 · MERO"), the first
 * two and a "+N" MoreToggle that shows all of them in place (only that toggle
 * expands; the rest of the row keeps opening the course).
 */
export function CourseWhen({
  row,
  ctx,
  expanded,
  onToggle,
  withToggle = true,
}: {
  row: CourseRow
  ctx: CourseListContext
  expanded: boolean
  onToggle: () => void
  /** false: the "+N" is rendered elsewhere (`CourseWhenToggle`, e.g. outside a phone row's link). */
  withToggle?: boolean
}) {
  const t = useTranslations('clientDashboard.courses.list')
  const { weekdayName } = useScheduleFormat()
  const lines = whenLines(row.schedule?.slots, ctx.placeShort, t('when.online'))
  if (!row.schedule) return <span className="flex min-h-6 items-center text-sm text-muted-foreground">—</span>
  if (!lines.length) return <span className="flex min-h-6 items-center text-sm text-muted-foreground">{t('classesCount', { count: 0 })}</span>
  const { shown } = visibleWhen(lines, expanded)
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <ul id={`course-when-${row.id}`} className="flex min-w-0 max-w-full flex-col" aria-label={t('when.label', { name: row.title || t('untitled') })}>
        {shown.map((l) => (
          <li key={l.key} className="truncate text-sm leading-6 whitespace-nowrap text-foreground tabular-nums">
            <span className="font-medium">{weekdayName(l.weekday, 'short')}</span> {l.time}
            {l.place ? <span className="text-muted-foreground"> · {l.place}</span> : null}
          </li>
        ))}
      </ul>
      {withToggle ? <CourseWhenToggle row={row} ctx={ctx} expanded={expanded} onToggle={onToggle} /> : null}
    </div>
  )
}

/** The When lines' "+N" (null when every line already shows). */
export function CourseWhenToggle({ row, ctx, expanded, onToggle }: { row: CourseRow; ctx: CourseListContext; expanded: boolean; onToggle: () => void }) {
  const t = useTranslations('clientDashboard.courses.list')
  const lines = whenLines(row.schedule?.slots, ctx.placeShort, '')
  const { more } = visibleWhen(lines, false)
  if (more === 0) return null
  return (
    <MoreToggle
      count={more}
      expanded={expanded}
      onToggle={onToggle}
      controls={`course-when-${row.id}`}
      lessText={t('when.less')}
      label={expanded ? t('when.showFewer') : t('when.showAll', { count: lines.length })}
    />
  )
}

// ── Next class ───────────────────────────────────────────────────────────────

/** "Thu 26", "16 Nov" — a site-local day. */
function useDayWords() {
  const dateLocale = useDateLocale()
  return useMemo(() => {
    const at = (day: string) => Date.parse(`${day}T12:00:00Z`)
    return {
      weekdayDay: (day: string) => formatDateTime(dateLocale, at(day), { weekday: 'short', day: 'numeric', timeZone: 'UTC' }),
      dayMonth: (day: string) => formatDateTime(dateLocale, at(day), { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      full: (day: string) => formatDateTime(dateLocale, at(day), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    }
  }, [dateLocale])
}

/** "Cancelled Thu 26" / "Substitute Tue 17" / "Time changed Wed 18" / "At L51 on 16 Nov". */
export function useExceptionText() {
  const t = useTranslations('clientDashboard.courses.list.exception')
  const days = useDayWords()
  return (e: { kind: string; date: string; placeToken: string }, ctx: CourseListContext): string =>
    e.kind === 'moved' ? t('moved', { place: ctx.placeShort(e.placeToken) || t('otherPlace'), date: days.dayMonth(e.date) }) : t(e.kind as 'cancelled' | 'substitute' | 'timeChanged', { day: days.weekdayDay(e.date) })
}

/** The next class's date and, under it, the nearest change of the course in the next 14 days. */
export function CourseNextClass({ row, ctx, align = 'start' }: { row: CourseRow; ctx: CourseListContext; align?: 'start' | 'end' }) {
  const exceptionText = useExceptionText()
  const exception = nextException(row.schedule?.exceptions, ctx.today)
  return (
    <div className={`flex min-w-0 flex-col ${align === 'end' ? 'items-end' : 'items-start'}`}>
      <LocalDate iso={row.schedule?.nextClassAt} empty="—" className="text-sm leading-6 whitespace-nowrap text-foreground tabular-nums" />
      {exception ? (
        <span className="flex items-center gap-1.5 text-xs leading-5 whitespace-nowrap text-muted-foreground">
          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${exception.kind === 'cancelled' ? 'bg-attention' : 'bg-primary'}`} />
          {exceptionText(exception, ctx)}
        </span>
      ) : null}
    </div>
  )
}

// ── Runs until ───────────────────────────────────────────────────────────────

/** The last class date; an amber pill when it is within 14 days (nothing after it). */
export function CourseRunsUntil({ row, ctx }: { row: CourseRow; ctx: CourseListContext }) {
  const t = useTranslations('clientDashboard.courses.list')
  const days = useDayWords()
  const r = runsUntil(row.schedule, ctx.today)
  if (!row.schedule || !row.schedule.classes) return <span className="flex min-h-6 items-center text-sm text-muted-foreground">—</span>
  if (!r.date) return <span className="flex min-h-6 items-center text-sm whitespace-nowrap text-muted-foreground">{t('until.open')}</span>
  if (r.endsSoon) {
    return (
      <span className="flex min-h-6 items-center" title={t('status.endsSoon', { count: r.daysLeft ?? 0 })}>
        <Pill tone="warning">{days.full(r.date)}</Pill>
      </span>
    )
  }
  return <span className="flex min-h-6 items-center text-sm whitespace-nowrap text-foreground tabular-nums">{days.full(r.date)}</span>
}

// ── Status ───────────────────────────────────────────────────────────────────

/** What a status item says. */
export function useStatusText() {
  const t = useTranslations('clientDashboard.courses.list')
  const tl = useTranslations('app.lifecycle')
  const date = useShortDate()
  return (item: CourseStatusItem): string => {
    switch (item.kind) {
      case 'archived':
      case 'draft':
      case 'unpublished':
        return tl(`status.${item.kind}`)
      case 'scheduled':
        return item.at ? t('status.scheduledFor', { date: date(item.at) }) : tl('status.scheduled')
      case 'noClasses':
        return t('status.noClasses')
      case 'noAddress':
        return t('status.noAddress')
      case 'endsSoon':
        return t('status.endsSoon', { count: item.days })
      case 'missing':
        return t('missing', { languages: item.languages.map((l) => l.toUpperCase()).join(', ') })
      case 'unpublishOn':
        return t('status.unpublishOn', { date: date(item.at) })
      case 'changes':
        return tl('pendingChanges')
      case 'live':
        return t('status.live')
    }
  }
}

const STATUS_ICON: Partial<Record<CourseStatusItem['kind'], ReactNode>> = {
  scheduled: (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2" />
    </svg>
  ),
  archived: (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4" />
    </svg>
  ),
  noClasses: <span aria-hidden="true" className="size-1.5 rounded-full bg-attention" />,
  noAddress: <span aria-hidden="true" className="size-1.5 rounded-full bg-attention" />,
  endsSoon: <span aria-hidden="true" className="size-1.5 rounded-full bg-attention" />,
  missing: <span aria-hidden="true" className="size-1.5 rounded-full bg-attention" />,
}

/**
 * ONE status pill — the most important thing about the course (lifecycle
 * first, then warnings in amber, then Live in green without a dot) — and the
 * whole list on hover and for screen readers.
 */
export function CourseStatusPill({ row, ctx }: { row: CourseRow; ctx: CourseListContext }) {
  const text = useStatusText()
  const items = courseStatusItems(row, ctx)
  if (!items.length) return null
  const [first, ...rest] = items
  const all = items.map(text)
  return (
    <span className="flex min-h-6 items-center gap-1.5" title={all.join(' · ')}>
      <Pill tone={STATUS_TONE[first.kind]} icon={STATUS_ICON[first.kind]}>
        {all[0]}
      </Pill>
      {rest.length ? (
        <>
          <span aria-hidden="true" className="text-xs leading-6 text-muted-foreground tabular-nums">
            +{rest.length}
          </span>
          <span className="sr-only">{all.slice(1).join(', ')}</span>
        </>
      ) : null}
    </span>
  )
}

// ── Icons ────────────────────────────────────────────────────────────────────

export function svg(d: string, size = 20, width = 2) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export const COURSE_ICONS = {
  plus: svg('M12 5v14M5 12h14', 18, 2.2),
  list: svg('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', 20, 2.2),
  grid: svg('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', 20, 1.8),
  more: svg('M5 12h.01M12 12h.01M19 12h.01', 20, 2.6),
  publish: svg('M12 19V5M5 12l7-7 7 7', 20, 1.8),
  unpublish: svg('M12 5v14M5 12l7 7 7-7', 20, 1.8),
  restore: svg('M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5', 20, 1.8),
  trash: svg('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', 20, 1.8),
  dates: svg('M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 20, 1.8),
  calendar: svg('M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 28, 1.5),
}
