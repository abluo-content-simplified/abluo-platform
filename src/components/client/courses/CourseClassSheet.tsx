'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { saveClassAction } from '@/app/[locale]/(client)/[tenant]/courses/schedule-actions'
import type { ClassView, PersonRef, PlaceOption, RoomView, EditionView, SaveClassResult, ScheduleSite } from '@/lib/api/course-schedule'
import type { AttendanceMode } from '@/lib/scheduling/types'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { DatePicker } from '@/components/app/ui/DatePicker'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { Select } from '@/components/app/ui/Select'
import { ToggleChips } from '@/components/app/ui/ToggleChips'
import { classLanguages, defaultStartsOn, textOf, timeOptions, timesOrdered, todayIn } from './schedule-model'
import { TeacherField, WEEKDAYS, useScheduleErrorText, useScheduleFormat } from './schedule-bits'

type Draft = {
  weekday: number
  startTime: string
  endTime: string
  interval: number
  placeToken: string
  instructors: PersonRef[]
  languages: string[]
  mode: AttendanceMode
  meetingRoomId: string
  editionId: string
  startsOn: string
  endsOn: string
}

const MODES: AttendanceMode[] = ['inPerson', 'online', 'mixed']
const INTERVALS = [1, 2, 3, 4]

function initialDraft(cls: ClassView | null, site: ScheduleSite, editions: EditionView[], defaultEditionId: string): Draft {
  if (cls) {
    return {
      weekday: cls.weekday,
      startTime: cls.startTime,
      endTime: cls.endTime ?? '',
      interval: cls.interval,
      placeToken: cls.placeToken,
      instructors: cls.instructors,
      languages: cls.languages,
      mode: cls.attendanceMode,
      meetingRoomId: cls.meetingRoomId ?? '',
      editionId: cls.editionId ?? '',
      startsOn: cls.startsOn ?? '',
      endsOn: cls.endsOn ?? '',
    }
  }
  const today = todayIn(editingZone(site.timeZone))
  const edition = editions.find((e) => e.id === defaultEditionId)
  return {
    weekday: 1,
    startTime: '18:00',
    endTime: '19:00',
    interval: 1,
    placeToken: '',
    instructors: [],
    languages: classLanguages([site.defaultLocale]),
    mode: 'inPerson',
    meetingRoomId: '',
    editionId: defaultEditionId,
    startsOn: defaultStartsOn(edition, today),
    endsOn: '',
  }
}

export type ClassSheetState = { key: number; cls: ClassView | null }

/**
 * Add or edit one weekly class of a course, in a bottom sheet (the Classes
 * panel). Without `canEdit` it only shows the class. The server re-checks
 * everything; this form only keeps the obvious mistakes from being sent.
 */
export function CourseClassSheet({
  state,
  onClose,
  projectSlug,
  courseId,
  site,
  editions,
  places,
  rooms,
  defaultEditionId,
  canEdit,
  onSaved,
  onEnd,
}: {
  state: ClassSheetState | null
  onClose: () => void
  projectSlug: string
  courseId: string
  site: ScheduleSite
  editions: EditionView[]
  places: PlaceOption[]
  rooms: RoomView[]
  defaultEditionId: string
  canEdit: boolean
  onSaved: (result: SaveClassResult) => void
  /** "End this class" for an existing class. */
  onEnd: (cls: ClassView) => void
}) {
  const t = useTranslations('clientDashboard.courses.classes')
  return (
    <BottomSheet open={state !== null} title={state?.cls ? t('sheet.editTitle') : t('sheet.addTitle')} onClose={onClose} size="lg">
      {state ? (
        <ClassForm
          key={state.key}
          cls={state.cls}
          projectSlug={projectSlug}
          courseId={courseId}
          site={site}
          editions={editions}
          places={places}
          rooms={rooms}
          defaultEditionId={defaultEditionId}
          canEdit={canEdit}
          onSaved={onSaved}
          onEnd={onEnd}
        />
      ) : null}
    </BottomSheet>
  )
}

function ClassForm({
  cls,
  projectSlug,
  courseId,
  site,
  editions,
  places,
  rooms,
  defaultEditionId,
  canEdit,
  onSaved,
  onEnd,
}: {
  cls: ClassView | null
  projectSlug: string
  courseId: string
  site: ScheduleSite
  editions: EditionView[]
  places: PlaceOption[]
  rooms: RoomView[]
  defaultEditionId: string
  canEdit: boolean
  onSaved: (result: SaveClassResult) => void
  onEnd: (cls: ClassView) => void
}) {
  const t = useTranslations('clientDashboard.courses.classes')
  const errorText = useScheduleErrorText()
  const { weekdayName, languageName, interval } = useScheduleFormat()
  const [d, setD] = useState<Draft>(() => initialDraft(cls, site, editions, defaultEditionId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }))
  const disabled = !canEdit || busy
  const languages = classLanguages(site.languages)
  // A stored language that is not a site language stays visible, so editing never drops it silently.
  const languageOptions = [...new Set([...languages, ...d.languages])]
  const ordered = timesOrdered(d.startTime, d.endTime)
  const datesOk = !!d.startsOn && (!d.endsOn || d.endsOn >= d.startsOn)
  const needsRoom = d.mode !== 'inPerson'
  const placeKnown = !d.placeToken || places.some((p) => p.token === d.placeToken)
  const editionLabel = (e: EditionView) => textOf(e.label, site.defaultLocale) || e.startsOn

  async function save() {
    if (!canEdit || busy) return
    setBusy(true)
    setError(null)
    const r = await saveClassAction({
      projectSlug,
      class: {
        seriesId: cls?.id ?? null,
        courseId,
        editionId: d.editionId || null,
        weekday: d.weekday,
        interval: d.interval,
        startTime: d.startTime,
        endTime: d.endTime || null,
        startsOn: d.startsOn,
        endsOn: d.endsOn || null,
        placeToken: d.placeToken,
        attendanceMode: d.mode,
        instructorPublicIds: d.instructors.map((p) => p.publicId),
        languages: d.languages,
        meetingRoomId: needsRoom && d.meetingRoomId ? d.meetingRoomId : null,
        expectedVersion: cls?.version ?? null,
        timeZone: editingZone(site.timeZone),
      },
    })
    setBusy(false)
    if (!r.ok) {
      setError(errorText(r.error))
      return
    }
    onSaved(r)
  }

  return (
    <form
      className="flex flex-col gap-4 pt-2"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      {!canEdit ? <Notice tone="info">{t('sheet.readOnly')}</Notice> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('sheet.weekday')}>
          {(p) => (
            <Select {...p} value={String(d.weekday)} disabled={disabled} onChange={(e) => set({ weekday: Number(e.target.value) })}>
              {WEEKDAYS.map((n) => (
                <option key={n} value={n}>
                  {weekdayName(n)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('sheet.repeat')}>
          {(p) => (
            <Select {...p} value={String(d.interval)} disabled={disabled} onChange={(e) => set({ interval: Number(e.target.value) })}>
              {INTERVALS.map((n) => (
                <option key={n} value={n}>
                  {interval(n)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('sheet.from')}>
          {(p) => (
            <Select {...p} value={d.startTime} disabled={disabled} onChange={(e) => set({ startTime: e.target.value })}>
              {timeOptions(d.startTime).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('sheet.until')} error={ordered ? undefined : t('sheet.endBeforeStart')}>
          {(p) => (
            <Select {...p} value={d.endTime} disabled={disabled} onChange={(e) => set({ endTime: e.target.value })}>
              <option value="">{t('sheet.noEnd')}</option>
              {timeOptions(d.endTime).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field label={t('sheet.place')}>
        {(p) => (
          <Select {...p} value={d.placeToken} disabled={disabled} onChange={(e) => set({ placeToken: e.target.value })}>
            <option value="">{t('sheet.noPlace')}</option>
            {places.map((o) => (
              <option key={o.token} value={o.token}>
                {o.name}
              </option>
            ))}
            {placeKnown ? null : <option value={d.placeToken}>{t('sheet.unknownPlace')}</option>}
          </Select>
        )}
      </Field>

      <TeacherField projectSlug={projectSlug} label={t('sheet.teachers')} value={d.instructors} onChange={(instructors) => set({ instructors })} disabled={disabled} />

      {languageOptions.length ? (
        <div className="space-y-2">
          <p className="text-[0.9375rem] font-medium text-foreground">{t('sheet.languages')}</p>
          <ToggleChips
            label={t('sheet.languages')}
            options={languageOptions.map((l) => ({ value: l, label: languageName(l) }))}
            value={d.languages}
            onChange={(next) => set({ languages: disabled ? d.languages : next })}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-[0.9375rem] font-medium text-foreground">{t('sheet.mode')}</p>
        <SegmentedControl
          label={t('sheet.mode')}
          appearance="soft"
          value={d.mode}
          onChange={(mode: AttendanceMode) => set({ mode })}
          options={MODES.map((m) => ({ value: m, label: t(`mode.${m}`), disabled }))}
        />
      </div>

      {needsRoom ? (
        <Field label={t('sheet.room')} hint={rooms.length ? undefined : t('sheet.noRooms')}>
          {(p) => (
            <Select {...p} value={d.meetingRoomId} disabled={disabled || !rooms.length} onChange={(e) => set({ meetingRoomId: e.target.value })}>
              <option value="">{t('sheet.noRoom')}</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}

      <Field label={t('sheet.term')}>
        {(p) => (
          <Select {...p} value={d.editionId} disabled={disabled} onChange={(e) => set({ editionId: e.target.value })}>
            <option value="">{t('sheet.noTerm')}</option>
            {editions.map((e) => (
              <option key={e.id} value={e.id}>
                {editionLabel(e)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('sheet.startsOn')} hint={t('sheet.startsOnHint')}>
          {(p) => <DatePicker {...p} value={d.startsOn} disabled={disabled} onChange={(startsOn) => set({ startsOn })} title={t('sheet.startsOn')} />}
        </Field>
        <Field label={t('sheet.endsOn')} hint={t('sheet.endsOnHint')} error={!d.endsOn || d.endsOn >= d.startsOn ? undefined : t('sheet.endBeforeStartDay')}>
          {(p) => <DatePicker {...p} value={d.endsOn} min={d.startsOn || undefined} clearable disabled={disabled} onChange={(endsOn) => set({ endsOn })} title={t('sheet.endsOn')} placeholder={t('sheet.noEndDate')} />}
        </Field>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}

      {canEdit ? (
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="submit" variant="primary" size="lg" disabled={busy || !ordered || !datesOk} aria-busy={busy || undefined}>
            {busy ? t('sheet.saving') : t('sheet.save')}
          </Button>
          {cls ? (
            <Button variant="destructive" size="lg" disabled={busy} onClick={() => onEnd(cls)}>
              {t('end.action')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}
