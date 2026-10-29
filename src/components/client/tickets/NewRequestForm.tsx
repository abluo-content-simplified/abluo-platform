'use client'

import { useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { createTicketAction } from '@/app/[locale]/(client)/[tenant]/support/ticket-actions'
import { AttachmentPicker } from '@/components/app/ui/AttachmentPicker'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { fitScreenshots } from '@/lib/client/ticket-upload'
import { CLIENT_UPLOAD_BUDGET_BYTES, ticketErrorKey, validateNewRequest, type NewRequestErrors } from '@/lib/support-tickets/client-form'
import { ATTACHMENT_MIME_TYPES, TICKET_LIMITS } from '@/lib/support-tickets/model'

/**
 * "New Request": title, description, up to 3 screenshots, the sensitive-data
 * notice, Send. Phone first (one column, full-width Send). A submit token is
 * made once per form, so pressing Send twice — or retrying after a bad
 * connection — never creates two requests (ADR-039 D14). Where the person was
 * (`from`) and, after a closed request, which one this follows (`relatedTo`)
 * go with it as context for Abluo Support.
 */
export function NewRequestForm({ projectSlug, from, relatedTo, initialTitle = '', initialBody = '' }: { projectSlug: string; from?: string; relatedTo?: string; initialTitle?: string; initialBody?: string }) {
  const t = useTranslations('clientDashboard.supportTickets')
  const locale = useLocale()
  const router = useRouter()
  const [token] = useState(() => crypto.randomUUID())
  const [title, setTitle] = useState(initialTitle)
  const [body, setBody] = useState(initialBody)
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<NewRequestErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const bodyLeft = TICKET_LIMITS.bodyMax - body.length
  const mb = Math.round(TICKET_LIMITS.attachmentBytesMax / (1024 * 1024))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    const found = validateNewRequest({ title, body, files })
    setErrors(found)
    setFailure(null)
    if (Object.keys(found).length) {
      if (found.files === 'tooLarge') setFailure(t('errors.uploadTooLarge'))
      return
    }
    const form = new FormData()
    form.set('title', title)
    form.set('body', body)
    form.set('submitToken', token)
    form.set('viewport', `${window.innerWidth}x${window.innerHeight}`)
    form.set('userAgent', navigator.userAgent)
    form.set('interfaceLocale', locale)
    if (from) form.set('from', from)
    if (relatedTo) form.set('relatedTo', relatedTo)
    setPending(true)
    try {
      const ready = await fitScreenshots(files, CLIENT_UPLOAD_BUDGET_BYTES)
      if (!ready) {
        setFailure(t('errors.uploadTooLarge'))
        setPending(false)
        return
      }
      for (const f of ready) form.append('files', f)
      const result = await createTicketAction(projectSlug, form)
      if (result.ok) {
        router.push(`/${projectSlug}/support/${result.value.id}`)
        return
      }
      setFailure(t(`errors.${ticketErrorKey(result.reason, result.field)}`))
    } catch {
      setFailure(t('errors.error'))
    }
    setPending(false)
  }

  return (
    <>
      <BackLink href={`/${projectSlug}/support`} label={t('new.back')} />
      <PageHeader title={t('new.title')} />
      <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-5">
        {relatedTo ? <Notice tone="info">{t('new.related', { reference: relatedTo })}</Notice> : null}
        <Field label={t('new.titleLabel')} error={errors.title ? t(`errors.${errors.title}`) : undefined}>
          {(p) => <TextInput {...p} value={title} maxLength={TICKET_LIMITS.titleMax} placeholder={t('new.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} disabled={pending} autoComplete="off" />}
        </Field>
        <Field label={t('new.bodyLabel')} hint={t('new.bodyHint')} error={errors.body ? t(`errors.${errors.body}`) : undefined}>
          {(p) => <TextArea {...p} value={body} rows={6} onChange={(e) => setBody(e.target.value)} disabled={pending} />}
        </Field>
        {bodyLeft <= 500 ? (
          <p aria-live="polite" className={`-mt-3 text-sm leading-5 ${bodyLeft < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {t('new.remaining', { count: bodyLeft })}
          </p>
        ) : null}
        <Field label={t('new.screenshotsLabel')} error={errors.files === 'tooMany' ? t('errors.tooManyAttachments') : undefined}>
          {() => (
            <div className="mt-1.5">
              <AttachmentPicker
                files={files}
                onChange={setFiles}
                max={TICKET_LIMITS.attachmentsMax}
                maxBytes={TICKET_LIMITS.attachmentBytesMax}
                accept={ATTACHMENT_MIME_TYPES}
                disabled={pending}
                labels={{
                  add: t('picker.add'),
                  hint: t('picker.hint', { max: TICKET_LIMITS.attachmentsMax, size: mb }),
                  remove: (name) => t('picker.remove', { name }),
                  problem: (p) => t(`picker.problem.${p.kind}`, { name: p.name, size: mb, max: TICKET_LIMITS.attachmentsMax }),
                }}
              />
            </div>
          )}
        </Field>
        <Notice tone="info">{t('new.sensitiveNotice')}</Notice>
        {failure ? <Notice tone="error">{failure}</Notice> : null}
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full md:w-auto md:self-start">
          {pending ? t('new.sending') : t('new.send')}
        </Button>
      </form>
    </>
  )
}
