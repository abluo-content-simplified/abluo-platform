'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { removeMeetingRoomAction, saveMeetingRoomAction } from '@/app/[locale]/(client)/[tenant]/courses/schedule-actions'
import type { RoomView } from '@/lib/api/course-schedule'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Field } from '@/components/app/ui/Field'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { TextInput } from '@/components/app/ui/TextInput'
import { useScheduleErrorText } from './schedule-bits'

type SheetState = { key: number; room: RoomView | null }

/**
 * Online rooms (Zoom and the like): a label, the join link, the meeting id and
 * the passcode. Only people with courses.meeting.manage get this panel (the
 * server sends the details to nobody else); everyone else still picks a room by
 * its label when they edit a class.
 */
export function TimetableRooms({
  projectSlug,
  rooms,
  onChanged,
  flash,
}: {
  projectSlug: string
  rooms: RoomView[]
  onChanged: () => Promise<void>
  flash: (message: string, tone?: 'status' | 'error') => void
}) {
  const t = useTranslations('clientDashboard.courses.timetable.rooms')
  const errorText = useScheduleErrorText()
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [opened, setOpened] = useState(0)
  const open = (room: RoomView | null) => {
    setOpened((n) => n + 1)
    setSheet({ key: opened + 1, room })
  }

  async function remove(r: RoomView) {
    const res = await removeMeetingRoomAction({ projectSlug, id: r.id, expectedVersion: r.version ?? 0 })
    if (!res.ok) {
      flash(errorText(res.error), 'error')
      return
    }
    await onChanged()
    flash(t('removed'))
  }

  return (
    <Panel as="section" aria-labelledby="timetable-rooms-title" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="timetable-rooms-title" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
          {t('title')}
        </h2>
        <Button variant="secondary" onClick={() => open(null)}>
          {t('add')}
        </Button>
      </div>
      <p className="text-sm leading-5 text-muted-foreground">{t('hint')}</p>
      {rooms.length === 0 ? (
        <EmptyState titleAs="p" compact title={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {rooms.map((r) => (
            <ListRow key={r.id} onOpen={() => open(r)} menu={{ label: t('menu', { name: r.label }), items: [{ key: 'remove', label: t('remove'), destructive: true, onSelect: () => void remove(r) }] }}>
              <span className="text-[0.9375rem] leading-6 font-semibold text-foreground">{r.label}</span>
              <span className="text-sm leading-5 break-all text-muted-foreground">{[r.meetingId, r.joinUrl].filter(Boolean).join(' · ') || t('noDetails')}</span>
            </ListRow>
          ))}
        </ul>
      )}
      <BottomSheet open={sheet !== null} title={sheet?.room ? t('editTitle') : t('addTitle')} onClose={() => setSheet(null)}>
        {sheet ? (
          <RoomForm
            key={sheet.key}
            room={sheet.room}
            projectSlug={projectSlug}
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

function RoomForm({ room, projectSlug, onSaved }: { room: RoomView | null; projectSlug: string; onSaved: () => Promise<void> }) {
  const t = useTranslations('clientDashboard.courses.timetable.rooms')
  const errorText = useScheduleErrorText()
  const [label, setLabel] = useState(room?.label ?? '')
  const [joinUrl, setJoinUrl] = useState(room?.joinUrl ?? '')
  const [meetingId, setMeetingId] = useState(room?.meetingId ?? '')
  const [passcode, setPasscode] = useState(room?.passcode ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const urlOk = !joinUrl.trim() || /^https:\/\//i.test(joinUrl.trim())

  async function save() {
    if (busy) return
    setBusy(true)
    setError(null)
    const r = await saveMeetingRoomAction({ projectSlug, id: room?.id ?? null, label, joinUrl, meetingId, passcode, expectedVersion: room ? (room.version ?? null) : null })
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
      <Field label={t('label')}>{(p) => <TextInput {...p} value={label} maxLength={80} disabled={busy} onChange={(e) => setLabel(e.target.value)} />}</Field>
      <Field label={t('joinUrl')} error={urlOk ? undefined : t('joinUrlHttps')}>
        {(p) => <TextInput {...p} type="url" inputMode="url" value={joinUrl} maxLength={2000} disabled={busy} onChange={(e) => setJoinUrl(e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('meetingId')}>{(p) => <TextInput {...p} value={meetingId} maxLength={40} disabled={busy} onChange={(e) => setMeetingId(e.target.value)} />}</Field>
        <Field label={t('passcode')}>{(p) => <TextInput {...p} value={passcode} maxLength={40} autoComplete="off" disabled={busy} onChange={(e) => setPasscode(e.target.value)} />}</Field>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" variant="primary" size="lg" disabled={busy || !label.trim() || !urlOk}>
        {busy ? t('saving') : t('save')}
      </Button>
    </form>
  )
}
