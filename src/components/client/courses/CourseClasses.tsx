'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { endClassAction, listClassesAction } from '@/app/[locale]/(client)/[tenant]/courses/schedule-actions'
import type { ClassView, ClassesScreen, SaveClassResult } from '@/lib/api/course-schedule'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { Pill } from '@/components/app/ui/list/cells'
import { Notice } from '@/components/app/ui/Notice'
import { Toast } from '@/components/app/ui/Toast'
import { CourseClassSheet, type ClassSheetState } from './CourseClassSheet'
import { ModePill, placeName, useClassTitle, useScheduleErrorText, useScheduleFormat } from './schedule-bits'

/**
 * The Classes panel of the course editor (ADR-045): this course's weekly
 * classes — day and time, place, teachers, languages, in person / online /
 * hybrid, online room — one row each; add and edit in a sheet; "End
 * this class" asks first. Mounted through the editor's `classes` prop. Without
 * `canEdit` (courses.schedule.write) the panel only shows the classes.
 */
export function CourseClasses({
  projectSlug,
  courseId,
  initial,
  canEdit,
  publishFirst = false,
}: {
  projectSlug: string
  /** The course's permanent publicId (what classes belong to). */
  courseId: string
  initial: ClassesScreen
  canEdit: boolean
  /** The viewer could edit classes, but the course is not published yet: say so instead of offering "Add". */
  publishFirst?: boolean
}) {
  const t = useTranslations('clientDashboard.courses.classes')
  const errorText = useScheduleErrorText()
  const classTitle = useClassTitle()
  const { languageName } = useScheduleFormat()
  const [screen, setScreen] = useState(initial)
  const [sheet, setSheet] = useState<ClassSheetState | null>(null)
  const [opened, setOpened] = useState(0)
  const [ending, setEnding] = useState<ClassView | null>(null)
  const [busy, setBusy] = useState(false)
  const [endError, setEndError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'status' | 'error' } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { site, classes, places, rooms } = screen

  const flash = useCallback((message: string, tone: 'status' | 'error' = 'status') => {
    setToast({ message, tone })
    window.setTimeout(() => setToast((cur) => (cur?.message === message ? null : cur)), 5000)
  }, [])

  const reload = useCallback(async () => {
    const r = await listClassesAction({ projectSlug, courseId })
    if (r.ok) {
      setScreen(r.screen)
      setLoadError(null)
    } else setLoadError(errorText(r.error))
  }, [projectSlug, courseId, errorText])

  const open = (cls: ClassView | null) => {
    setOpened((n) => n + 1)
    setSheet({ key: opened + 1, cls })
  }

  async function onSaved(result: SaveClassResult) {
    setSheet(null)
    await reload()
    if (result.keptEdited > 0) flash(t('saved.keptEdited', { count: result.keptEdited }))
    else if (result.truncated) flash(t('saved.truncated'))
    else flash(t('saved.done'))
  }

  async function confirmEnd() {
    if (!ending) return
    setBusy(true)
    setEndError(null)
    const r = await endClassAction({ projectSlug, seriesId: ending.id, expectedVersion: ending.version })
    setBusy(false)
    if (!r.ok) {
      setEndError(errorText(r.error))
      return
    }
    setEnding(null)
    setSheet(null)
    await reload()
    flash(t('end.done'))
  }

  return (
    <div className="space-y-3">
      {loadError ? <Notice tone="error">{loadError}</Notice> : null}
      {publishFirst ? <Notice tone="info">{t('publishFirst')}</Notice> : null}

      {classes.length === 0 ? (
        <EmptyState
          titleAs="p"
          title={t('empty.title')}
          body={canEdit ? t('empty.body') : t('empty.readOnly')}
          action={
            canEdit ? (
              <Button variant="primary" onClick={() => open(null)}>
                {t('add')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {classes.map((c) => {
              const place = placeName(places, c.placeToken)
              return (
                <ListRow
                  key={c.id}
                  onOpen={() => open(c)}
                  label={t('openClass', { name: classTitle(c) })}
                  menu={
                    canEdit
                      ? {
                          label: t('menu', { name: classTitle(c) }),
                          items: [
                            { key: 'edit', label: t('edit'), onSelect: () => open(c) },
                            { key: 'end', label: t('end.action'), destructive: true, separated: true, onSelect: () => { setEndError(null); setEnding(c) } },
                          ],
                        }
                      : undefined
                  }
                >
                  <span className="text-[0.9375rem] leading-6 font-semibold text-foreground">{classTitle(c)}</span>
                  <span className="text-sm leading-5 text-muted-foreground">
                    {[place, c.instructors.map((p) => p.name).join(', '), c.languages.map(languageName).join(' · ')].filter(Boolean).join(' · ') || t('noDetails')}
                  </span>
                  <span className="flex flex-wrap items-start gap-1.5">
                    <ModePill mode={c.attendanceMode} />
                    {c.attendanceMode !== 'inPerson' && c.meetingRoomLabel ? <Pill tone="outline">{c.meetingRoomLabel}</Pill> : null}
                  </span>
                </ListRow>
              )
            })}
          </ul>
          {canEdit ? (
            <Button variant="secondary" onClick={() => open(null)}>
              {t('add')}
            </Button>
          ) : null}
        </>
      )}

      <CourseClassSheet
        state={sheet}
        onClose={() => setSheet(null)}
        projectSlug={projectSlug}
        courseId={courseId}
        site={site}
        places={places}
        rooms={rooms}
        canEdit={canEdit}
        onSaved={(r) => void onSaved(r)}
        onEnd={(c) => {
          setEndError(null)
          setEnding(c)
        }}
      />
      <ConfirmDialog
        open={ending !== null}
        title={t('end.title', { name: ending ? classTitle(ending) : '' })}
        body={t('end.body')}
        confirmLabel={t('end.confirm')}
        busy={busy}
        error={endError}
        onConfirm={() => void confirmEnd()}
        onCancel={() => {
          setEnding(null)
          setEndError(null)
        }}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}
