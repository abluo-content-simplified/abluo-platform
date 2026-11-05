'use client'

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { removeEditionAction, timetableAction } from '@/app/[locale]/(client)/[tenant]/courses/schedule-actions'
import type { ClassView, EditionView, TimetableScreen } from '@/lib/api/course-schedule'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Select } from '@/components/app/ui/Select'
import { Toast } from '@/components/app/ui/Toast'
import { TimetableClassSheet } from './TimetableClassSheet'
import { TimetableGrid } from './TimetableGrid'
import { TimetableHolidays } from './TimetableHolidays'
import { TimetableRooms } from './TimetableRooms'
import { TimetableTermSheet, type TermSheetState } from './TimetableTermSheet'
import { placeName, useScheduleErrorText, useScheduleFormat } from './schedule-bits'
import { currentEditionId, textOf, todayIn } from './schedule-model'

/** Every class, whatever its term / classes that belong to no term. */
const ALL = 'all'
const NONE = 'none'

/**
 * The Timetable page (ADR-045): the site's weekly classes of one term as a grid
 * (computers) or a list per weekday (phones); a class opens its upcoming dates,
 * where a single date can be cancelled, taught by someone else, moved or noted.
 * Below: Holidays, and — for the owner — Online rooms. Terms are created and
 * edited from the header. Writing needs `canWrite` (courses.schedule.write);
 * the server re-checks every action.
 */
export function Timetable({ projectSlug, initial, canWrite }: { projectSlug: string; initial: TimetableScreen; canWrite: boolean }) {
  const t = useTranslations('clientDashboard.courses.timetable')
  const errorText = useScheduleErrorText()
  const { shortDay } = useScheduleFormat()
  const [screen, setScreen] = useState(initial)
  const { site, classes, editions, closures, places, rooms, courses, exceptions } = screen
  const [term, setTerm] = useState(() => (initial.editions.length ? currentEditionId(initial.editions, todayIn(editingZone(initial.site.timeZone))) : ALL))
  const [openClass, setOpenClass] = useState<ClassView | null>(null)
  const [termSheet, setTermSheet] = useState<TermSheetState | null>(null)
  const [termKey, setTermKey] = useState(0)
  const [deleting, setDeleting] = useState<EditionView | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
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

  const hasUntermed = classes.some((c) => c.editionId === null)
  const selected: EditionView | undefined = editions.find((e) => e.id === term)
  const shown = useMemo(() => {
    if (term === ALL) return classes
    if (term === NONE) return classes.filter((c) => c.editionId === null)
    return classes.filter((c) => c.editionId === term)
  }, [classes, term])
  const editionName = (e: EditionView) => textOf(e.label, site.defaultLocale) || shortDay(e.startsOn)

  const newTerm = () => {
    setTermKey((n) => n + 1)
    setTermSheet({ key: termKey + 1, edition: null })
  }
  const editTerm = (edition: EditionView) => {
    setTermKey((n) => n + 1)
    setTermSheet({ key: termKey + 1, edition })
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    setDeleteError(null)
    const r = await removeEditionAction({ projectSlug, id: deleting.id, expectedVersion: deleting.version })
    setBusy(false)
    if (!r.ok) {
      setDeleteError(errorText(r.error))
      return
    }
    setDeleting(null)
    setTermSheet(null)
    setTerm(ALL)
    await refresh()
    flash(t('term.deleted'))
  }

  const header = (
    <PageHeader
      title={t('title')}
      actions={
        <>
          {editions.length > 0 || hasUntermed ? (
            <Select aria-label={t('term.select')} controlSize="md" value={term} onChange={(e) => setTerm(e.target.value)} className="min-w-44">
              {editions.map((e) => (
                <option key={e.id} value={e.id}>
                  {editionName(e)}
                </option>
              ))}
              {hasUntermed && editions.length > 0 ? <option value={NONE}>{t('term.none')}</option> : null}
              <option value={ALL}>{t('term.all')}</option>
            </Select>
          ) : null}
          {canWrite && selected ? (
            <Button variant="quiet" onClick={() => editTerm(selected)}>
              {t('term.edit')}
            </Button>
          ) : null}
          {canWrite ? (
            <Button variant="secondary" onClick={newTerm}>
              {t('term.new')}
            </Button>
          ) : null}
        </>
      }
    />
  )

  return (
    <div className="space-y-5">
      <BackLink href={`/${projectSlug}/courses`} label={t('back')} />
      {header}
      {selected ? <p className="-mt-2 text-sm leading-5 text-muted-foreground">{t('term.range', { from: shortDay(selected.startsOn), to: shortDay(selected.endsOn) })}</p> : null}
      {loadError ? <Notice tone="error">{loadError}</Notice> : null}

      {shown.length === 0 ? (
        <EmptyState titleAs="h2" title={t('empty.title')} body={classes.length === 0 ? t('empty.body') : t('empty.termBody')} />
      ) : (
        <TimetableGrid classes={shown} places={places} courses={courses} exceptions={exceptions} onOpen={setOpenClass} />
      )}

      <TimetableHolidays projectSlug={projectSlug} site={site} closures={closures} canWrite={canWrite} onChanged={refresh} flash={flash} />
      {screen.canManageRooms ? <TimetableRooms projectSlug={projectSlug} rooms={rooms} onChanged={refresh} flash={flash} /> : null}

      <TimetableClassSheet
        cls={openClass}
        title={openClass ? courses[openClass.courseId] || t('untitledCourse') : ''}
        placeLine={openClass ? placeName(places, openClass.placeToken) : ''}
        projectSlug={projectSlug}
        site={site}
        canWrite={canWrite}
        onClose={() => setOpenClass(null)}
        onChanged={() => void refresh()}
      />
      <TimetableTermSheet
        state={termSheet}
        onClose={() => setTermSheet(null)}
        projectSlug={projectSlug}
        site={site}
        onSaved={async (id) => {
          setTermSheet(null)
          await refresh()
          setTerm(id)
          flash(t('term.saved'))
        }}
        onDelete={(e) => {
          setDeleteError(null)
          setDeleting(e)
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t('term.deleteTitle', { name: deleting ? editionName(deleting) : '' })}
        body={t('term.deleteBody')}
        confirmLabel={t('term.delete')}
        busy={busy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setDeleting(null)
          setDeleteError(null)
        }}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}
