'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { listOccurrencesAction, updateOccurrenceAction } from '@/app/[locale]/(client)/[tenant]/courses/schedule-actions'
import type { ClassView, OccurrenceView, PersonRef, ScheduleSite, UpdateOccurrenceRequest } from '@/lib/api/course-schedule'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { Pill } from '@/components/app/ui/list/cells'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { Select } from '@/components/app/ui/Select'
import { Skeleton } from '@/components/app/ui/Skeleton'
import { LanguageTextFields, TeacherField, useRepeatText, useScheduleErrorText, useScheduleFormat } from './schedule-bits'
import { textOf, timeOptions, timesOrdered } from './schedule-model'

const PAGE = 8

/** What one action changes on a date. */
type Patch = Partial<Omit<UpdateOccurrenceRequest, 'seriesId' | 'occurrenceId' | 'expectedVersion'>>

type Edit = { kind: 'substitute' | 'time' | 'note'; key: number; occurrence: OccurrenceView }

/**
 * One class's upcoming dates (8 at a time, "Show more"), each with Cancel /
 * Restore, Substitute, Change time and Note. Every action saves at once and
 * changes only that date — the class itself stays as it is.
 */
export function TimetableClassSheet({
  cls,
  title,
  placeLine,
  projectSlug,
  site,
  canWrite,
  onClose,
  onChanged,
}: {
  cls: ClassView | null
  title: string
  placeLine: string
  projectSlug: string
  site: ScheduleSite
  canWrite: boolean
  onClose: () => void
  /** A date changed: the parent refreshes its counts. */
  onChanged: () => void
}) {
  const t = useTranslations('clientDashboard.courses.timetable.dates')
  const errorText = useScheduleErrorText()
  const { dayLabel, timeRange } = useScheduleFormat()
  const repeatText = useRepeatText()
  const [rows, setRows] = useState<OccurrenceView[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [count, setCount] = useState(PAGE)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [editCount, setEditCount] = useState(0)
  const seriesId = cls?.id ?? null

  const load = useCallback(
    async (n: number) => {
      if (!seriesId) return
      const r = await listOccurrencesAction({ projectSlug, seriesId, count: n })
      if (!r.ok) {
        setError(errorText(r.error))
        return
      }
      setError(null)
      setRows(r.occurrences)
      setHasMore(r.hasMore)
    },
    [projectSlug, seriesId, errorText]
  )

  // A different class starts again from the first page.
  useEffect(() => {
    setRows(null)
    setCount(PAGE)
    setEdit(null)
    if (seriesId) void load(PAGE)
  }, [seriesId, load])

  async function update(o: OccurrenceView, patch: Patch): Promise<string | null> {
    if (!cls) return null
    const r = await updateOccurrenceAction({ projectSlug, update: { seriesId: cls.id, occurrenceId: o.id, expectedVersion: o.version, ...patch } })
    if (!r.ok) return errorText(r.error)
    await load(count)
    onChanged()
    return null
  }

  async function toggleCancel(o: OccurrenceView) {
    setBusyId(o.id)
    const message = await update(o, { cancelled: !o.cancelled })
    setBusyId(null)
    if (message) setError(message)
  }

  const showMore = async () => {
    const next = count + PAGE
    setCount(next)
    await load(next)
  }

  const open = (kind: Edit['kind'], occurrence: OccurrenceView) => {
    setEditCount((n) => n + 1)
    setEdit({ kind, key: editCount + 1, occurrence })
  }

  return (
    <>
      <SidePanel open={cls !== null} title={title} subtitle={cls ? `${repeatText(cls)} · ${timeRange(cls.startTime, cls.endTime)}${placeLine ? ` · ${placeLine}` : ''}` : undefined} closeLabel={t('close')} onClose={onClose}>
        <div className="space-y-3">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {rows === null && !error ? (
            <div aria-busy="true" aria-label={t('loading')} className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24 w-full" shape="block" />
              ))}
            </div>
          ) : null}
          {rows && rows.length === 0 ? <EmptyState titleAs="p" compact title={t('empty')} /> : null}
          {rows && rows.length ? (
            <ul className="flex flex-col gap-3">
              {rows.map((o) => (
                <Panel as="li" key={o.id} className="space-y-3">
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    <span className="text-[0.9375rem] leading-6 font-semibold text-foreground">{dayLabel(o.date)}</span>
                    <span className="text-[0.9375rem] leading-6 text-foreground">{timeRange(o.startTime, o.endTime)}</span>
                  </div>
                  {o.cancelled || o.substituted || o.isModified || o.note ? (
                    <div className="flex flex-wrap items-start gap-1.5">
                      {o.cancelled ? <Pill tone="muted">{t('status.cancelled')}</Pill> : null}
                      {o.substituted ? <Pill tone="highlight">{t('status.substitute', { names: o.instructors.map((p) => p.name).join(', ') || t('status.nobody') })}</Pill> : null}
                      {o.isModified && !o.cancelled ? <Pill tone="highlight">{t('status.moved')}</Pill> : null}
                    </div>
                  ) : null}
                  {o.note && textOf(o.note, site.defaultLocale) ? <p className="text-sm leading-5 text-muted-foreground">{textOf(o.note, site.defaultLocale)}</p> : null}
                  {canWrite ? (
                    <div className="flex flex-wrap items-start gap-2">
                      <Button variant="secondary" disabled={busyId === o.id} onClick={() => void toggleCancel(o)}>
                        {o.cancelled ? t('restore') : t('cancel')}
                      </Button>
                      <Button variant="quiet" onClick={() => open('substitute', o)}>
                        {t('substitute')}
                      </Button>
                      <Button variant="quiet" onClick={() => open('time', o)}>
                        {t('changeTime')}
                      </Button>
                      <Button variant="quiet" onClick={() => open('note', o)}>
                        {o.note ? t('editNote') : t('addNote')}
                      </Button>
                    </div>
                  ) : null}
                </Panel>
              ))}
            </ul>
          ) : null}
          {hasMore ? (
            <Button variant="secondary" onClick={() => void showMore()}>
              {t('showMore')}
            </Button>
          ) : null}
        </div>
      </SidePanel>

      <BottomSheet
        open={edit !== null}
        title={edit ? t(`edit.${edit.kind}.title`, { date: dayLabel(edit.occurrence.date) }) : ''}
        onClose={() => setEdit(null)}
      >
        {edit ? (
          <DateEditor
            key={edit.key}
            edit={edit}
            cls={cls}
            projectSlug={projectSlug}
            site={site}
            onSave={async (patch) => {
              const message = await update(edit.occurrence, patch)
              if (!message) setEdit(null)
              return message
            }}
          />
        ) : null}
      </BottomSheet>
    </>
  )
}

function DateEditor({
  edit,
  cls,
  projectSlug,
  site,
  onSave,
}: {
  edit: Edit
  cls: ClassView | null
  projectSlug: string
  site: ScheduleSite
  onSave: (patch: Patch) => Promise<string | null>
}) {
  const t = useTranslations('clientDashboard.courses.timetable.dates')
  const o = edit.occurrence
  const [teachers, setTeachers] = useState<PersonRef[]>(o.instructors)
  const [start, setStart] = useState(o.startTime)
  const [end, setEnd] = useState(o.endTime ?? '')
  const [note, setNote] = useState<Record<string, string>>(o.note ?? {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(patch: Patch) {
    setBusy(true)
    setError(null)
    const message = await onSave(patch)
    setBusy(false)
    if (message) setError(message)
  }

  return (
    <form
      className="flex flex-col gap-4 pt-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (edit.kind === 'substitute') void submit({ instructorPublicIds: teachers.map((p) => p.publicId) })
        else if (edit.kind === 'time') void submit({ time: { date: o.date, startTime: start, endTime: end || null } })
        else void submit({ note })
      }}
    >
      {edit.kind === 'substitute' ? (
        <>
          <p className="text-sm leading-5 text-muted-foreground">{t('edit.substitute.hint', { names: cls?.instructors.map((p) => p.name).join(', ') || t('status.nobody') })}</p>
          <TeacherField projectSlug={projectSlug} label={t('edit.substitute.field')} value={teachers} onChange={setTeachers} disabled={busy} />
        </>
      ) : null}
      {edit.kind === 'time' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('edit.time.from')}>
            {(p) => (
              <Select {...p} value={start} disabled={busy} onChange={(e) => setStart(e.target.value)}>
                {timeOptions(start).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('edit.time.until')} error={timesOrdered(start, end) ? undefined : t('edit.time.endBeforeStart')}>
            {(p) => (
              <Select {...p} value={end} disabled={busy} onChange={(e) => setEnd(e.target.value)}>
                <option value="">{t('edit.time.noEnd')}</option>
                {timeOptions(end).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : null}
      {edit.kind === 'note' ? (
        <>
          <p className="text-sm leading-5 text-muted-foreground">{t('edit.note.hint')}</p>
          <LanguageTextFields languages={site.languages} value={note} onChange={setNote} label={t('edit.note.field')} disabled={busy} maxLength={600} />
        </>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" variant="primary" size="lg" disabled={busy || (edit.kind === 'time' && !timesOrdered(start, end))}>
          {busy ? t('saving') : t('save')}
        </Button>
        {edit.kind === 'substitute' && o.substituted ? (
          <Button variant="secondary" size="lg" disabled={busy} onClick={() => void submit({ clearInstructors: true })}>
            {t('edit.substitute.reset')}
          </Button>
        ) : null}
        {edit.kind === 'note' && o.note ? (
          <Button variant="secondary" size="lg" disabled={busy} onClick={() => void submit({ clearNote: true })}>
            {t('edit.note.remove')}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
