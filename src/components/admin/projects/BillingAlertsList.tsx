'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { Field } from '@/components/app/ui/Field'
import { Panel } from '@/components/app/ui/Panel'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { TextArea } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import { Pill } from '@/components/app/ui/list/cells'
import { acknowledgeBillingAlertAction, resolveBillingAlertAction } from '@/lib/admin/billing/alert-actions'
import { formatMoney } from '@/lib/admin/billing/card'
import type { BillingAlertView } from '@/lib/admin/billing/alerts'
import type { BillingActionResult } from '@/lib/admin/billing/types'
import { formatDateTime } from '@/lib/i18n/date-locale'
import { useDateLocale } from '@/lib/i18n/date-locale-context'

/** The alerts of one project with Acknowledge / Resolve (note required). */
export function BillingAlertsList({ alerts, canAct, heading }: { alerts: BillingAlertView[]; canAct: boolean; heading: string }) {
  const t = useTranslations('admin.billing.alerts')
  const dateLocale = useDateLocale()
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState<BillingAlertView | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const stamp = (iso: string) => formatDateTime(dateLocale, new Date(iso), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Rome' })

  function done(message: string) {
    setResolving(null)
    setNote('')
    setToast(message)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 4000)
    router.refresh()
  }
  async function run(id: string, action: () => Promise<BillingActionResult>, onOk: () => void, onField?: () => void) {
    setBusyId(id)
    setError(null)
    let r: BillingActionResult
    try {
      r = await action()
    } catch {
      r = { ok: false, error: 'failed' }
    }
    setBusyId(null)
    if (r.ok) return onOk()
    if (r.error === 'invalid' && onField) return onField()
    setError(t(`errors.${r.error}`))
  }

  return (
    <>
      <SectionHeading id="billing-alerts-heading" title={heading} />
      <p className="text-sm leading-5 text-muted-foreground">{t('body')}</p>
      <ul className="flex flex-col gap-3">
        {alerts.map((a) => (
          <li key={a.id}>
            <Panel tone={a.status === 'open' ? 'danger' : 'card'}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t(`kind.${a.kind}`)}</span>
                <Pill tone={a.status === 'open' ? 'highlight' : 'muted'}>{t(`status.${a.status}`)}</Pill>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {a.amountCents !== null && a.currency ? `${formatMoney(a.amountCents, a.currency, dateLocale)} · ` : ''}
                {t('detected', { date: stamp(a.createdAt) })}
                {a.acknowledgedAt ? ` · ${t('acknowledgedOn', { date: stamp(a.acknowledgedAt) })}` : ''}
              </p>
              {canAct ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.status === 'open' ? (
                    <Button variant="secondary" disabled={busyId === a.id} onClick={() => void run(a.id, () => acknowledgeBillingAlertAction({ alertId: a.id }), () => done(t('toast.acknowledged')))}>
                      {t('acknowledge')}
                    </Button>
                  ) : null}
                  <Button
                    variant="primary"
                    disabled={busyId === a.id}
                    onClick={() => {
                      setNote('')
                      setNoteError(null)
                      setError(null)
                      setResolving(a)
                    }}
                  >
                    {t('resolve')}
                  </Button>
                </div>
              ) : null}
            </Panel>
          </li>
        ))}
      </ul>
      {error && !resolving ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <ConfirmDialog
        open={resolving !== null}
        title={t('resolveTitle')}
        body={t('resolveBody')}
        confirmLabel={t('resolveConfirm')}
        busy={busyId !== null}
        error={error}
        onConfirm={() => {
          if (!resolving) return
          if (note.trim() === '') return setNoteError(t('noteRequired'))
          void run(resolving.id, () => resolveBillingAlertAction({ alertId: resolving.id, note }), () => done(t('toast.resolved')), () => setNoteError(t('noteRequired')))
        }}
        onCancel={() => {
          setResolving(null)
          setError(null)
        }}
      >
        <Field label={t('note')} error={noteError ?? undefined}>
          {(p) => <TextArea {...p} rows={3} maxLength={2000} value={note} onChange={(e) => (setNote(e.target.value), setNoteError(null))} />}
        </Field>
      </ConfirmDialog>
      <Toast message={toast} />
    </>
  )
}
