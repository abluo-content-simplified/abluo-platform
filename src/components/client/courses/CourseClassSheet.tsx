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
import { LanguagePicker } from '@/components/app/ui/LanguagePicker'
import { ToggleChips } from '@/components/app/ui/ToggleChips'
import {
  ORDINAL_OPTIONS,
  applyRepeatKey,
  canEndOn,
  canStartOn,
  classLanguages,
  defaultStartsOn,
  repeatDraftOf,
  repeatKeyOf,
  repeatKeys,
  ruleOfDraft,
  snapDates,
  textOf,
  timeOptions,
  timesOrdered,
  todayIn,
  type RepeatDraft,
} from './schedule-model'
import { TeacherField, WEEKDAYS, useScheduleErrorText, useScheduleFormat } from './schedule-bits'

type Draft = RepeatDraft & {
  startTime: string
  endTime: string
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
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1)
const ORDINAL_KEYS = {
  1: 'ordinalFirst',
  2: 'ordinalSecond',
  3: 'ordinalThird',
  4: 'ordinalFourth',
  [-1]: 'ordinalLast',
} as const

/** The form's starting values; `adjusted` when a stored date did not fit the class days and moved. */
function initialDraft(cls: ClassView | null, site: ScheduleSite, editions: EditionView[], defaultEditionId: string): { draft: Draft; adjusted: boolean } {
  if (cls) {
    const repeat = repeatDraftOf(cls.repeat, cls.startsOn ?? '')
    const rule = ruleOfDraft(repeat)
    const snap = rule
      ? snapDates(rule, cls.startsOn ?? '', cls.endsOn ?? '')
      : {
          startsOn: cls.startsOn ?? '',
          endsOn: cls.endsOn ?? '',
          adjusted: false,
        }
    return {
      adjusted: snap.adjusted,
      draft: {
        ...repeat,
        startTime: cls.startTime,
        endTime: cls.endTime ?? '',
        placeToken: cls.placeToken,
        instructors: cls.instructors,
        languages: cls.languages,
        mode: cls.attendanceMode,
        meetingRoomId: cls.meetingRoomId ?? '',
        editionId: cls.editionId ?? '',
        startsOn: snap.startsOn,
        endsOn: snap.endsOn,
      },
    }
  }
  const today = todayIn(editingZone(site.timeZone))
  const edition = editions.find((e) => e.id === defaultEditionId)
  const startsOn = defaultStartsOn(edition, today)
  return {
    adjusted: false,
    draft: {
      ...repeatDraftOf({ kind: 'weekly', weekdays: [weekdayNumber(startsOn)], interval: 1 }, startsOn),
      startTime: '18:00',
      endTime: '19:00',
      placeToken: '',
      instructors: [],
      languages: classLanguages([site.defaultLocale]),
      mode: 'inPerson',
      meetingRoomId: '',
      editionId: defaultEditionId,
      startsOn,
      endsOn: '',
    },
  }
}

/** 1 = Monday … 7 = Sunday of an ISO day. */
const weekdayNumber = (day: string) => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1

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
  const { weekdayName, interval } = useScheduleFormat()
  const [start] = useState(() => initialDraft(cls, site, editions, defaultEditionId))
  const [d, setD] = useState<Draft>(start.draft)
  const [adjusted, setAdjusted] = useState(start.adjusted)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Applies a change; when the days of the class changed, the dates move to the days that still fit (and the form says so). */
  const set = (patch: Partial<Draft>) => {
    const next = { ...d, ...patch }
    // A newly chosen term: a first date outside it moves to the term's start (then to the next class day).
    const newTerm = 'editionId' in patch ? editions.find((e) => e.id === next.editionId) : undefined
    if (newTerm && next.startsOn && (next.startsOn < newTerm.startsOn || next.startsOn > newTerm.endsOn)) next.startsOn = newTerm.startsOn
    const rule = ruleOfDraft(next)
    if (rule) {
      const snap = snapDates(rule, next.startsOn, next.endsOn, 'startsOn' in patch && !newTerm)
      next.startsOn = snap.startsOn
      next.endsOn = snap.endsOn
      if (snap.adjusted) setAdjusted(true)
    }
    setD(next)
  }
  const rule = ruleOfDraft(d)
  const once = d.kind === 'once'
  const disabled = !canEdit || busy
  // The site's languages come first; any other ISO 639-1 language can be added (lessons are not tied to the website's languages).
  const siteLanguages = classLanguages(site.languages)
  const ordered = timesOrdered(d.startTime, d.endTime)
  const term = editions.find((e) => e.id === d.editionId)
  const outsideTerm = !!term && !!d.startsOn && (d.startsOn < term.startsOn || d.startsOn > term.endsOn)
  const datesOk = !outsideTerm && !!rule && !!d.startsOn && canStartOn(rule, d.startsOn) && (once || !d.endsOn || canEndOn(rule, d.endsOn, d.startsOn))
  const needsRoom = d.mode !== 'inPerson'
  const placeKnown = !d.placeToken || places.some((p) => p.token === d.placeToken)
  const editionLabel = (e: EditionView) => textOf(e.label, site.defaultLocale) || e.startsOn

  async function save() {
    if (!canEdit || busy || !rule) return
    setBusy(true)
    setError(null)
    const r = await saveClassAction({
      projectSlug,
      class: {
        seriesId: cls?.id ?? null,
        courseId,
        editionId: d.editionId || null,
        repeat: rule ?? undefined,
        startTime: d.startTime,
        endTime: d.endTime || null,
        startsOn: d.startsOn,
        endsOn: once ? null : d.endsOn || null,
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
        <Field label={t('sheet.repeat')}>
          {(p) => (
            <Select {...p} value={repeatKeyOf(d)} disabled={disabled} onChange={(e) => set(applyRepeatKey(d, e.target.value))}>
              {repeatKeys(d).map((key) => (
                <option key={key} value={key}>
                  {key === 'once'
                    ? t('sheet.repeatOnce')
                    : key === 'monthlyWeekday'
                      ? t('sheet.repeatMonthlyWeekday')
                      : key === 'monthlyDay'
                        ? t('sheet.repeatMonthlyDay')
                        : interval(Number(key.slice(7)))}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {d.kind === 'monthlyDay' ? (
          <Field label={t('sheet.monthDay')} hint={t('sheet.monthDayHint')} hintBelow>
            {(p) => (
              <Select {...p} value={String(d.monthDay)} disabled={disabled} onChange={(e) => set({ monthDay: Number(e.target.value) })}>
                {MONTH_DAYS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {d.kind === 'monthlyWeekday' ? (
          <>
            <Field label={t('sheet.ordinal')}>
              {(p) => (
                <Select {...p} value={String(d.ordinal)} disabled={disabled} onChange={(e) => set({ ordinal: Number(e.target.value) as Draft['ordinal'] })}>
                  {ORDINAL_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {t(`sheet.${ORDINAL_KEYS[o]}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('sheet.weekday')}>
              {(p) => (
                <Select {...p} value={String(d.monthWeekday)} disabled={disabled} onChange={(e) => set({ monthWeekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((n) => (
                    <option key={n} value={n}>
                      {weekdayName(n)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        ) : null}
      </div>

      {d.kind === 'weekly' ? (
        <div className="space-y-2">
          <p className="text-[0.9375rem] font-medium text-foreground">{t('sheet.days')}</p>
          <ToggleChips
            label={t('sheet.days')}
            options={WEEKDAYS.map((n) => ({
              value: String(n),
              label: weekdayName(n, 'short'),
            }))}
            value={d.weekdays.map(String)}
            onChange={(next) =>
              set({
                weekdays: disabled ? d.weekdays : next.map(Number).sort((a, b) => a - b),
              })
            }
          />
          {d.weekdays.length === 0 ? <p className="text-sm leading-5 text-destructive">{t('sheet.daysNeeded')}</p> : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
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

      <TeacherField
        projectSlug={projectSlug}
        label={t('sheet.teachers')}
        labels={{
          empty: t('sheet.teachersEmpty'),
          add: t('sheet.teachersAdd'),
          title: t('sheet.teachersTitle'),
        }}
        value={d.instructors}
        onChange={(instructors) => set({ instructors })}
        disabled={disabled}
      />

      <div className="space-y-2">
        <p className="text-[0.9375rem] font-medium text-foreground">{t('sheet.languages')}</p>
        <LanguagePicker label={t('sheet.languages')} suggested={siteLanguages} value={d.languages} max={6} disabled={disabled} onChange={(next) => set({ languages: next })} />
      </div>

      <div className="space-y-2">
        <p className="text-[0.9375rem] font-medium text-foreground">{t('sheet.mode')}</p>
        <SegmentedControl
          label={t('sheet.mode')}
          appearance="soft"
          value={d.mode}
          onChange={(mode: AttendanceMode) => set({ mode })}
          options={MODES.map((m) => ({
            value: m,
            label: t(`mode.${m}`),
            disabled,
          }))}
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
        <Field label={once ? t('sheet.onDate') : t('sheet.startsOn')} hint={once ? undefined : t('sheet.startsOnHint')} hintBelow error={outsideTerm ? t('errors.outsideTerm') : undefined}>
          {(p) => (
            <DatePicker
              {...p}
              value={d.startsOn}
              min={term?.startsOn}
              max={term?.endsOn}
              disabled={disabled}
              isDisabled={rule ? (day) => !canStartOn(rule, day) : undefined}
              onChange={(startsOn) => set({ startsOn })}
              title={once ? t('sheet.onDate') : t('sheet.startsOn')}
            />
          )}
        </Field>
        {once ? null : (
          <Field label={t('sheet.endsOn')} hint={t('sheet.endsOnHint')} hintBelow error={!d.endsOn || d.endsOn >= d.startsOn ? undefined : t('sheet.endBeforeStartDay')}>
            {(p) => (
              <DatePicker
                {...p}
                value={d.endsOn}
                min={d.startsOn || undefined}
                isDisabled={rule && d.startsOn ? (day) => !canEndOn(rule, day, d.startsOn) : undefined}
                clearable
                disabled={disabled}
                onChange={(endsOn) => set({ endsOn })}
                title={t('sheet.endsOn')}
                placeholder={t('sheet.noEndDate')}
              />
            )}
          </Field>
        )}
      </div>
      {adjusted ? <Notice tone="info">{t('sheet.datesAdjusted')}</Notice> : null}

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
