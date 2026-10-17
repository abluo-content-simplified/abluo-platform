'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { createEventAction } from '@/app/[locale]/(client)/[tenant]/agenda/actions'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { FieldError, FieldLabel } from '@/components/app/ui/FieldLabel'
import { TextInput } from '@/components/app/ui/TextInput'
import { DateTimePicker } from '@/components/app/ui/DateTimePicker'
import { editingZone } from '@/components/app/lifecycle/zoned-time'

/** "New event": its name and when it starts (in the site's time zone). Everything else is filled in on the event's page. */
export function NewEventForm({ projectSlug, timeZone }: { projectSlug: string; timeZone: string | null }) {
  const t = useTranslations('clientDashboard.events.new')
  const te = useTranslations('clientDashboard.events.errors')
  const router = useRouter()
  const titleId = useId()
  const startId = useId()
  const zone = editingZone(timeZone)
  const [title, setTitle] = useState('')
  const [start, setStart] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `/${projectSlug}/agenda`
  const ready = title.trim().length > 0 && !!start

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await createEventAction({ projectSlug, title, startDate: start! })
      if (!r.ok) return setError(te(['missing_title', 'invalid_value', 'too_large', 'forbidden'].includes(r.error) ? r.error : 'failed'))
      router.replace(`${base}/${r.id}`)
    } catch {
      setError(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void create(e)} className="max-w-xl space-y-5">
      <BackLink href={base} label={t('back')} />
      <div className="-mt-3">
        <PageHeader title={t('title')} />
      </div>
      <p className="-mt-3 text-[0.9375rem] leading-6 text-muted-foreground">{t('helper')}</p>
      <div>
        <FieldLabel htmlFor={titleId}>{t('name')}</FieldLabel>
        <TextInput id={titleId} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder={t('namePlaceholder')} autoFocus />
      </div>
      <div>
        <FieldLabel htmlFor={startId}>{t('start')}</FieldLabel>
        <DateTimePicker id={startId} title={t('start')} value={start} onChange={setStart} zone={zone} allowPast />
      </div>
      <FieldError>{error}</FieldError>
      {!ready ? <p className="text-sm text-muted-foreground">{t('needs')}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" type="submit" disabled={!ready || busy}>
          {busy ? t('creating') : t('create')}
        </Button>
        <ButtonLink variant="secondary" href={base}>
          {t('cancel')}
        </ButtonLink>
      </div>
    </form>
  )
}
