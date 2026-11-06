'use client'

import { useCallback, useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { formatDateTime } from '@/lib/i18n/date-locale'
import { useDateLocale } from '@/lib/i18n/date-locale-context'
import { searchTeachersAction, type ScheduleActionError } from '@/app/[locale]/(client)/[tenant]/courses/schedule-actions'
import type { ClassView, PersonRef, PlaceOption } from '@/lib/api/course-schedule'
import { describeClassRepeat } from '@/lib/scheduling/repeat-label'
import type { AttendanceMode } from '@/lib/scheduling/types'
import { Field } from '@/components/app/ui/Field'
import { PersonPicker, type PersonPickerLabels, type PersonPickerPerson } from '@/components/app/ui/PersonPicker'
import { Pill, type PillTone } from '@/components/app/ui/list/cells'
import { TextInput } from '@/components/app/ui/TextInput'

/** Monday-first weekday numbers, as the scheduling layer stores them. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

const MODE_TONE: Record<AttendanceMode, PillTone> = { inPerson: 'muted', online: 'highlight', mixed: 'outline' }

/** Names and dates in the viewer's language (24-hour times are shown as the "HH:mm" they are stored as). */
export function useScheduleFormat() {
  const uiLocale = useLocale()
  const dateLocale = useDateLocale()
  const t = useTranslations('clientDashboard.courses.classes')
  return useMemo(() => {
    const weekdayName = (weekday: number, style: 'long' | 'short' = 'long') => formatDateTime(dateLocale, Date.UTC(2024, 0, weekday, 12), { weekday: style, timeZone: 'UTC' })
    /** "Tue 3 Nov" for a site-local day. */
    const dayLabel = (day: string, withYear = false) => {
      const ms = Date.parse(`${day}T12:00:00Z`)
      if (Number.isNaN(ms)) return day
      return formatDateTime(dateLocale, ms, { weekday: 'short', day: 'numeric', month: 'short', ...(withYear && { year: 'numeric' }), timeZone: 'UTC' })
    }
    const shortDay = (day: string) => {
      const ms = Date.parse(`${day}T12:00:00Z`)
      return Number.isNaN(ms) ? day : formatDateTime(dateLocale, ms, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    }
    const languageName = (code: string) => {
      try {
        return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) ?? code.toUpperCase()
      } catch {
        return code.toUpperCase()
      }
    }
    const timeRange = (start: string, end: string | null) => (end ? `${start}–${end}` : start)
    const modeLabel = (mode: AttendanceMode) => t(`mode.${mode}`)
    const interval = (n: number) => t('repeat', { count: n })
    return { weekdayName, dayLabel, shortDay, languageName, timeRange, modeLabel, interval }
  }, [uiLocale, dateLocale, t])
}

/** The attendance badge of a class. */
export function ModePill({ mode }: { mode: AttendanceMode }) {
  const { modeLabel } = useScheduleFormat()
  return <Pill tone={MODE_TONE[mode]}>{modeLabel(mode)}</Pill>
}

/** An action error code as the person reads it. */
export function useScheduleErrorText() {
  const te = useTranslations('clientDashboard.courses.errors')
  const t = useTranslations('clientDashboard.courses.classes.errors')
  return useCallback(
    (code: ScheduleActionError): string => {
      if (code === 'in_use') return t('inUse')
      if (code === 'outside_term') return t('outsideTerm')
      if (code === 'missing_title') return t('missingName')
      if (code === 'unauthenticated' || code === 'forbidden') return te('forbidden')
      return te(code)
    },
    [te, t]
  )
}

/** The name of a place token ('' = none) among the options. */
export function placeName(places: PlaceOption[], token: string): string {
  return places.find((p) => p.token === token)?.name ?? ''
}

/** Teachers for a class or one date: the PersonPicker fed by this course module's own search (needs courses.schedule.write only). */
export function TeacherField({
  projectSlug,
  label,
  labels,
  value,
  onChange,
  disabled,
}: {
  projectSlug: string
  label: string
  /** Wording for the field (empty text, add button, sheet title); omitted = the generic "people" wording. */
  labels?: PersonPickerLabels
  value: PersonRef[]
  onChange: (next: PersonRef[]) => void
  disabled?: boolean
}) {
  const search = useCallback(
    async (query: string): Promise<PersonPickerPerson[]> => {
      const r = await searchTeachersAction({ projectSlug, query, limit: 20 })
      if (!r.ok) throw new Error(r.error)
      return r.items.map((p) => ({ id: p.publicId, name: p.name, photoUrl: p.photoUrl, jobTitle: p.jobTitle }))
    },
    [projectSlug]
  )
  return (
    <PersonPicker
      label={label}
      labels={labels}
      value={value.map((p) => ({ id: p.publicId, name: p.name }))}
      onChange={(next) => onChange(next.map((p) => ({ publicId: p.id, name: p.name })))}
      search={search}
      max={50}
      disabled={disabled}
    />
  )
}

/** One text input per site language (the first is the main one and required by the caller). */
export function LanguageTextFields({
  languages,
  value,
  onChange,
  label,
  disabled,
  maxLength = 200,
}: {
  languages: string[]
  value: Record<string, string>
  onChange: (next: Record<string, string>) => void
  /** Field label; with several languages it is followed by the language's name. */
  label: string
  disabled?: boolean
  maxLength?: number
}) {
  const { languageName } = useScheduleFormat()
  return (
    <>
      {languages.map((lang) => (
        <Field key={lang} label={languages.length > 1 ? `${label} (${languageName(lang)})` : label}>
          {(p) => <TextInput {...p} value={value[lang] ?? ''} maxLength={maxLength} disabled={disabled} onChange={(e) => onChange({ ...value, [lang]: e.target.value })} />}
        </Field>
      ))}
    </>
  )
}

/** How a class repeats in words ("Every Thursday", "Last Sunday of the month", "Once, 12 December"), in the viewer's language; the weekday alone for a rule scheduling does not know. */
export function useRepeatText() {
  const uiLocale = useLocale()
  const { weekdayName } = useScheduleFormat()
  return useCallback(
    (c: Pick<ClassView, 'rule' | 'weekday' | 'startsOn'>) => describeClassRepeat(c.rule, uiLocale, { date: c.startsOn, withYear: true }) || weekdayName(c.weekday),
    [uiLocale, weekdayName]
  )
}

/** Title of a class for lists: how it repeats, and the time. */
export function useClassTitle() {
  const { timeRange } = useScheduleFormat()
  const repeatText = useRepeatText()
  return (c: Pick<ClassView, 'rule' | 'weekday' | 'startsOn' | 'startTime' | 'endTime'>) => `${repeatText(c)} · ${timeRange(c.startTime, c.endTime)}`
}
