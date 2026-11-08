'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { timetableAction } from '@/app/[locale]/(client)/[tenant]/courses/schedule-actions'
import type { ClassView, TimetableScreen } from '@/lib/api/course-schedule'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Toast } from '@/components/app/ui/Toast'
import { TimetableClassSheet } from './TimetableClassSheet'
import { TimetableFilters } from './TimetableFilters'
import { TimetableGrid } from './TimetableGrid'
import { TimetableHolidays } from './TimetableHolidays'
import { TimetableRooms } from './TimetableRooms'
import { placeName, useScheduleErrorText } from './schedule-bits'
import {
  ANY,
  DEFAULT_TIMETABLE_FILTERS,
  filterClasses,
  filterOptions,
  parseTimetableFilters,
  sanitizeFilters,
  timetableFiltersToParams,
  type TimetableFilters as Filters,
} from './timetable-filter'

/**
 * The Timetable page (ADR-045): all the site's active weekly classes as a grid
 * (computers) or a list per weekday (phones); a class opens its upcoming dates,
 * where a single date can be cancelled, taught by someone else, moved or noted.
 * Below: Holidays, and — for the owner — Online rooms. There are no terms on
 * this screen: every class has its own first and last date. Writing needs
 * `canWrite` (courses.schedule.write); the server re-checks every action.
 */
export function Timetable({ projectSlug, initial, canWrite }: { projectSlug: string; initial: TimetableScreen; canWrite: boolean }) {
  const t = useTranslations('clientDashboard.courses.timetable')
  const errorText = useScheduleErrorText()
  const [screen, setScreen] = useState(initial)
  const { site, classes, closures, places, rooms, courses, exceptions } = screen
  const [openClass, setOpenClass] = useState<ClassView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'status' | 'error' } | null>(null)

  const flash = useCallback((message: string, tone: 'status' | 'error' = 'status') => {
    setToast({ message, tone })
    window.setTimeout(() => setToast((cur) => (cur?.message === message ? null : cur)), 5000)
  }, [])

  const refresh = useCallback(async () => {
    const r = await timetableAction({ projectSlug })
    if (r.ok) {
      setScreen(r.screen)
      setLoadError(null)
    } else setLoadError(errorText(r.error))
  }, [projectSlug, errorText])

  const shown = classes
  // Search + filters (kept in the URL, like the other lists); options come from the classes.
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [rawFilters, setFilters] = useState<Filters>(() => parseTimetableFilters(new URLSearchParams(searchParams.toString())))
  const options = useMemo(() => filterOptions(shown, places), [shown, places])
  const hasUnplaced = useMemo(() => shown.some((c) => !c.placeToken), [shown])
  const filters = useMemo(() => sanitizeFilters(rawFilters, options, hasUnplaced), [rawFilters, options, hasUnplaced])
  const matching = useMemo(() => filterClasses(shown, courses, filters), [shown, courses, filters])
  const updateFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    const qs = timetableFiltersToParams(next).toString()
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname)
  }
  const resetFilters = () => updateFilters({ ...DEFAULT_TIMETABLE_FILTERS })
  const header = <PageHeader title={t('title')} />

  return (
    <div className="space-y-5">
      <BackLink href={`/${projectSlug}/courses`} label={t('back')} />
      {header}
      {loadError ? <Notice tone="error">{loadError}</Notice> : null}

      {shown.length === 0 ? (
        <EmptyState titleAs="h2" title={t('empty.title')} body={t('empty.body')} />
      ) : (
        <>
          <TimetableFilters filters={filters} update={updateFilters} reset={resetFilters} options={options} hasUnplaced={hasUnplaced} resultCount={matching.length} total={shown.length} />
          {matching.length === 0 ? (
            <EmptyState titleAs="h2" title={t('filters.noMatch')} action={<Button onClick={resetFilters}>{t('filters.clear')}</Button>} />
          ) : (
            <TimetableGrid classes={matching} places={places} courses={courses} exceptions={exceptions} onlyDay={filters.day === ANY ? undefined : Number(filters.day)} onOpen={setOpenClass} />
          )}
        </>
      )}

      <TimetableHolidays projectSlug={projectSlug} site={site} closures={closures} canWrite={canWrite} onChanged={refresh} flash={flash} />
      {screen.canManageRooms ? <TimetableRooms projectSlug={projectSlug} rooms={rooms} onChanged={refresh} flash={flash} /> : null}

      <TimetableClassSheet
        cls={openClass}
        title={openClass ? courses[openClass.courseId] || t('untitledCourse') : ''}
        placeLine={openClass ? placeName(places, openClass.placeToken) : ''}
        places={places}
        projectSlug={projectSlug}
        site={site}
        canWrite={canWrite}
        onClose={() => setOpenClass(null)}
        onChanged={() => void refresh()}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}
