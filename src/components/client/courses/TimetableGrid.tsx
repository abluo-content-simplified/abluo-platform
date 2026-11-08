'use client'

import { useTranslations } from 'next-intl'
import type { ClassView, PlaceOption } from '@/lib/api/course-schedule'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { Pill } from '@/components/app/ui/list/cells'
import { ModePill, useRepeatText, useScheduleFormat } from './schedule-bits'
import { groupByPlace, weekdaysWithClasses, type PlaceRow } from './schedule-model'

type Shared = {
  classes: ClassView[]
  places: PlaceOption[]
  /** Course publicId → title. */
  courses: Record<string, string>
  /** Class id → changed dates in the next weeks. */
  exceptions: Record<string, number>
  onOpen: (c: ClassView) => void
  /** When a day filter is set, only that weekday's column / list. */
  onlyDay?: number
}

/** One class as a row: time and course, teachers and languages, badges. Shared by the grid cells and the phone list. */
function ClassItem({ c, courses, exceptions, onOpen, placeLine }: Pick<Shared, 'courses' | 'exceptions' | 'onOpen'> & { c: ClassView; placeLine?: string }) {
  const t = useTranslations('clientDashboard.courses.timetable')
  const { timeRange, languageName } = useScheduleFormat()
  const repeatText = useRepeatText()
  // A plain "every week on one day" is already said by the column; anything else is said in words.
  const plain = c.repeat?.kind === 'weekly' && c.repeat.interval === 1 && c.repeat.weekdays.length === 1
  const title = courses[c.courseId] || t('untitledCourse')
  const changes = exceptions[c.id] ?? 0
  const detail = [c.instructors.map((p) => p.name).join(', '), c.languages.map((l) => languageName(l)).join(' · '), placeLine].filter(Boolean).join(' · ')
  return (
    <ListRow onOpen={() => onOpen(c)} label={t('openClass', { name: title, time: timeRange(c.startTime, c.endTime) })}>
      <span className="text-[0.9375rem] leading-6 font-semibold text-foreground">{timeRange(c.startTime, c.endTime)}</span>
      <span className="text-[0.9375rem] leading-6 text-foreground">{title}</span>
      {plain ? null : <span className="text-sm leading-5 text-muted-foreground">{repeatText(c)}</span>}
      {detail ? <span className="text-sm leading-5 text-muted-foreground">{detail}</span> : null}
      <span className="flex flex-wrap items-start gap-1.5">
        <ModePill mode={c.attendanceMode} />
        {changes > 0 ? <Pill tone="highlight">{t('changes', { count: changes })}</Pill> : null}
      </span>
    </ListRow>
  )
}

/**
 * The weekly timetable. Computers: a grid — one row per place, one column per
 * weekday that has classes; a cell lists its classes. Phones: one list per
 * weekday. Nothing here changes data: opening a class is the parent's job.
 */
export function TimetableGrid(props: Shared) {
  const t = useTranslations('clientDashboard.courses.timetable')
  const { weekdayName } = useScheduleFormat()
  const { classes, places, courses, exceptions, onOpen, onlyDay } = props
  const days = onlyDay ? [onlyDay] : weekdaysWithClasses(classes)
  const rows = groupByPlace(classes, places)
  const byTime = (a: ClassView, b: ClassView) => a.startTime.localeCompare(b.startTime)

  const columns: DataTableColumn<PlaceRow<ClassView>>[] = [
    {
      key: 'place',
      header: t('grid.place'),
      width: 'w-44',
      render: (row) => <span className="text-[0.9375rem] leading-6 font-semibold text-foreground">{row.name || t('grid.noPlace')}</span>,
    },
    ...days.map(
      (day): DataTableColumn<PlaceRow<ClassView>> => ({
        key: `day-${day}`,
        header: weekdayName(day),
        width: 'min-w-52',
        render: (row) => {
          const here = row.items.filter((c) => c.weekdays.includes(day)).sort(byTime)
          if (!here.length) return <span className="text-sm text-muted-foreground">—</span>
          return (
            <ul className="flex flex-col gap-2">
              {here.map((c) => (
                <ClassItem key={c.id} c={c} courses={courses} exceptions={exceptions} onOpen={onOpen} />
              ))}
            </ul>
          )
        },
      })
    ),
  ]

  return (
    <>
      <div className="hidden md:block">
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.token || 'none'} label={t('grid.label')} minWidth={days.length > 4 ? 'min-w-[64rem]' : 'min-w-[44rem]'} stickyLeadingColumns={1} />
      </div>
      <div className="space-y-5 md:hidden">
        {days.map((day) => (
          <section key={day} aria-label={weekdayName(day)} className="space-y-2">
            <h2 className="text-[1.0625rem] leading-7 font-semibold text-foreground">{weekdayName(day)}</h2>
            <ul className="flex flex-col gap-3">
              {classes
                .filter((c) => c.weekdays.includes(day))
                .sort(byTime)
                .map((c) => (
                  <ClassItem key={c.id} c={c} courses={courses} exceptions={exceptions} onOpen={onOpen} placeLine={places.find((p) => p.token === c.placeToken)?.name} />
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
