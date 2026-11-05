'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { saveEditionAction } from '@/app/[locale]/(client)/[tenant]/courses/schedule-actions'
import type { EditionView, ScheduleSite } from '@/lib/api/course-schedule'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { DatePicker } from '@/components/app/ui/DatePicker'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { LanguageTextFields, useScheduleErrorText } from './schedule-bits'
import { todayIn } from './schedule-model'

export type TermSheetState = { key: number; edition: EditionView | null }

/** Create or edit a term: its name per language, first and last day. Changing the dates moves or ends the classes of the term. */
export function TimetableTermSheet({
  state,
  onClose,
  projectSlug,
  site,
  onSaved,
  onDelete,
}: {
  state: TermSheetState | null
  onClose: () => void
  projectSlug: string
  site: ScheduleSite
  onSaved: (id: string) => void
  onDelete: (edition: EditionView) => void
}) {
  const t = useTranslations('clientDashboard.courses.timetable.term')
  return (
    <BottomSheet open={state !== null} title={state?.edition ? t('editTitle') : t('newTitle')} onClose={onClose}>
      {state ? <TermForm key={state.key} edition={state.edition} projectSlug={projectSlug} site={site} onSaved={onSaved} onDelete={onDelete} /> : null}
    </BottomSheet>
  )
}

function TermForm({
  edition,
  projectSlug,
  site,
  onSaved,
  onDelete,
}: {
  edition: EditionView | null
  projectSlug: string
  site: ScheduleSite
  onSaved: (id: string) => void
  onDelete: (edition: EditionView) => void
}) {
  const t = useTranslations('clientDashboard.courses.timetable.term')
  const errorText = useScheduleErrorText()
  const [label, setLabel] = useState<Record<string, string>>(edition?.label ?? {})
  const [startsOn, setStartsOn] = useState(edition?.startsOn ?? todayIn(editingZone(site.timeZone)))
  const [endsOn, setEndsOn] = useState(edition?.endsOn ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const named = !!(label[site.defaultLocale] ?? '').trim()
  const datesOk = !!startsOn && !!endsOn && endsOn >= startsOn

  async function save() {
    if (busy) return
    setBusy(true)
    setError(null)
    const r = await saveEditionAction({ projectSlug, id: edition?.id ?? null, label, startsOn, endsOn, expectedVersion: edition?.version ?? null, timeZone: editingZone(site.timeZone) })
    setBusy(false)
    if (!r.ok) {
      setError(errorText(r.error))
      return
    }
    onSaved(r.id)
  }

  return (
    <form
      className="flex flex-col gap-4 pt-2"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <LanguageTextFields languages={site.languages} value={label} onChange={setLabel} label={t('name')} disabled={busy} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('startsOn')}>{(p) => <DatePicker {...p} value={startsOn} disabled={busy} onChange={setStartsOn} title={t('startsOn')} />}</Field>
        <Field label={t('endsOn')} error={!endsOn || endsOn >= startsOn ? undefined : t('endBeforeStart')}>
          {(p) => <DatePicker {...p} value={endsOn} min={startsOn || undefined} disabled={busy} onChange={setEndsOn} title={t('endsOn')} />}
        </Field>
      </div>
      {edition ? <p className="text-sm leading-5 text-muted-foreground">{t('datesHint')}</p> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" variant="primary" size="lg" disabled={busy || !named || !datesOk}>
          {busy ? t('saving') : t('save')}
        </Button>
        {edition ? (
          <Button variant="destructive" size="lg" disabled={busy} onClick={() => onDelete(edition)}>
            {t('delete')}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
