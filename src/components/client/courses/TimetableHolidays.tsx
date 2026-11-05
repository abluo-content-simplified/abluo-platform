'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { removeClosureAction, saveClosureAction } from '@/app/[locale]/(client)/[tenant]/courses/schedule-actions'
import type { ClosureView, ScheduleSite } from '@/lib/api/course-schedule'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { DatePicker } from '@/components/app/ui/DatePicker'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Field } from '@/components/app/ui/Field'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { LanguageTextFields, useScheduleErrorText, useScheduleFormat } from './schedule-bits'
import { textOf, todayIn } from './schedule-model'

type SheetState = { key: number; closure: ClosureView | null }

/**
 * Holidays: days with no class (a label and a first and last day). Adding or
 * removing one regenerates the classes it touches. They apply to every term.
 */
export function TimetableHolidays({
  projectSlug,
  site,
  closures,
  canWrite,
  onChanged,
  flash,
}: {
  projectSlug: string
  site: ScheduleSite
  closures: ClosureView[]
  canWrite: boolean
  onChanged: () => Promise<void>
  flash: (message: string, tone?: 'status' | 'error') => void
}) {
  const t = useTranslations('clientDashboard.courses.timetable.holidays')
  const errorText = useScheduleErrorText()
  const { shortDay } = useScheduleFormat()
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [opened, setOpened] = useState(0)
  const open = (closure: ClosureView | null) => {
    setOpened((n) => n + 1)
    setSheet({ key: opened + 1, closure })
  }
  const range = (c: ClosureView) => (c.startsOn === c.endsOn ? shortDay(c.startsOn) : t('range', { from: shortDay(c.startsOn), to: shortDay(c.endsOn) }))

  async function remove(c: ClosureView) {
    const r = await removeClosureAction({ projectSlug, id: c.id })
    if (!r.ok) {
      flash(errorText(r.error), 'error')
      return
    }
    await onChanged()
    flash(t('removed'))
  }

  return (
    <Panel as="section" aria-labelledby="timetable-holidays-title" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="timetable-holidays-title" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
          {t('title')}
        </h2>
        {canWrite ? (
          <Button variant="secondary" onClick={() => open(null)}>
            {t('add')}
          </Button>
        ) : null}
      </div>
      <p className="text-sm leading-5 text-muted-foreground">{t('hint')}</p>
      {closures.length === 0 ? (
        <EmptyState titleAs="p" compact title={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {closures.map((c) => (
            <ListRow
              key={c.id}
              onOpen={() => open(c)}
              menu={canWrite ? { label: t('menu', { name: textOf(c.label, site.defaultLocale) }), items: [{ key: 'remove', label: t('remove'), destructive: true, onSelect: () => void remove(c) }] } : undefined}
            >
              <span className="text-[0.9375rem] leading-6 font-semibold text-foreground">{textOf(c.label, site.defaultLocale) || t('untitled')}</span>
              <span className="text-sm leading-5 text-muted-foreground">{range(c)}</span>
            </ListRow>
          ))}
        </ul>
      )}
      <BottomSheet open={sheet !== null} title={sheet?.closure ? t('editTitle') : t('addTitle')} onClose={() => setSheet(null)}>
        {sheet ? (
          <HolidayForm
            key={sheet.key}
            closure={sheet.closure}
            projectSlug={projectSlug}
            site={site}
            canWrite={canWrite}
            onSaved={async () => {
              setSheet(null)
              await onChanged()
              flash(t('saved'))
            }}
          />
        ) : null}
      </BottomSheet>
    </Panel>
  )
}

function HolidayForm({ closure, projectSlug, site, canWrite, onSaved }: { closure: ClosureView | null; projectSlug: string; site: ScheduleSite; canWrite: boolean; onSaved: () => Promise<void> }) {
  const t = useTranslations('clientDashboard.courses.timetable.holidays')
  const errorText = useScheduleErrorText()
  const today = todayIn(editingZone(site.timeZone))
  const [label, setLabel] = useState<Record<string, string>>(closure?.label ?? {})
  const [startsOn, setStartsOn] = useState(closure?.startsOn ?? today)
  const [endsOn, setEndsOn] = useState(closure?.endsOn ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const named = !!(label[site.defaultLocale] ?? '').trim()
  const datesOk = !!startsOn && !!endsOn && endsOn >= startsOn

  async function save() {
    if (busy || !canWrite) return
    setBusy(true)
    setError(null)
    const r = await saveClosureAction({ projectSlug, id: closure?.id ?? null, editionId: closure?.editionId ?? null, startsOn, endsOn, label })
    if (!r.ok) {
      setBusy(false)
      setError(errorText(r.error))
      return
    }
    await onSaved()
  }

  return (
    <form
      className="flex flex-col gap-4 pt-2"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <LanguageTextFields languages={site.languages} value={label} onChange={setLabel} label={t('name')} disabled={busy || !canWrite} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('from')}>{(p) => <DatePicker {...p} value={startsOn} disabled={busy || !canWrite} onChange={setStartsOn} title={t('from')} />}</Field>
        <Field label={t('to')} error={!endsOn || endsOn >= startsOn ? undefined : t('endBeforeStart')}>
          {(p) => <DatePicker {...p} value={endsOn} min={startsOn || undefined} disabled={busy || !canWrite} onChange={setEndsOn} title={t('to')} />}
        </Field>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {canWrite ? (
        <Button type="submit" variant="primary" size="lg" disabled={busy || !named || !datesOk}>
          {busy ? t('saving') : t('save')}
        </Button>
      ) : null}
    </form>
  )
}
