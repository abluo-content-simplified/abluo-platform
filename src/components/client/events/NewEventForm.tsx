'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { createEventAction } from '@/app/[locale]/(client)/[tenant]/agenda/actions'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { EVENT_BUTTON, EVENT_ICONS, EVENT_INPUT, EVENT_LABEL, EVENT_PRIMARY, inputToIso } from './event-bits'

/** "New event": its name and when it starts. Everything else is filled in on the event's page. */
export function NewEventForm({ projectSlug }: { projectSlug: string }) {
  const t = useTranslations('clientDashboard.events.new')
  const te = useTranslations('clientDashboard.events.errors')
  const router = useRouter()
  const titleId = useId()
  const startId = useId()
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `/${projectSlug}/agenda`
  const startIso = inputToIso(start)
  const ready = title.trim().length > 0 && !!startIso

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await createEventAction({ projectSlug, title, startDate: startIso! })
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
      <Link
        href={base}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {EVENT_ICONS.back}
        {t('back')}
      </Link>
      <div className="-mt-3">
        <PageHeader title={t('title')} />
      </div>
      <p className="-mt-3 text-[0.9375rem] leading-6 text-muted-foreground">{t('helper')}</p>
      <div>
        <label htmlFor={titleId} className={EVENT_LABEL}>
          {t('name')}
        </label>
        <input id={titleId} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder={t('namePlaceholder')} className={EVENT_INPUT} autoFocus />
      </div>
      <div>
        <label htmlFor={startId} className={EVENT_LABEL}>
          {t('start')}
        </label>
        <input id={startId} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={EVENT_INPUT} />
      </div>
      {error ? (
        <p role="alert" className="text-[0.9375rem] leading-6 text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!ready || busy} className={EVENT_PRIMARY}>
          {busy ? t('creating') : t('create')}
        </button>
        <Link href={base} className={EVENT_BUTTON}>
          {t('cancel')}
        </Link>
      </div>
    </form>
  )
}
