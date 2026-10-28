'use client'

import { useId, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { TextInput } from '@/components/app/ui/TextInput'
import { addFormRecipientAction, removeFormRecipientAction, type FormRecipientActionError } from '@/app/[locale]/(client)/[tenant]/settings/actions'
import type { SaveState } from '@/lib/client/autosave/engine'
import { MAX_EMAIL_LENGTH, MAX_RECIPIENTS_PER_TOPIC, addRecipient, sameEmail } from '@/lib/notifications/form-recipients'
import type { FormNotificationsView, NoticeOutcome, RecipientGroupView } from '@/lib/notifications/form-recipients-service'

type Pending = { groupKey: string; email: string } | null

/**
 * Settings → Form notifications (Tom, 2026-10-28). Each form (notification
 * topic) the project has, with the addresses that receive its messages. Owner
 * and Site admin add or remove addresses; everyone else sees the list. The
 * last address of a form can go, but only after a clear warning: then nobody
 * gets an email for that form (messages still arrive in the dashboard).
 */
export function FormNotifications({
  projectSlug,
  initial,
  editable,
  onSaveState,
}: {
  projectSlug: string
  initial: FormNotificationsView | null
  editable: boolean
  onSaveState: (s: SaveState) => void
}) {
  const t = useTranslations('clientDashboard.settings.formNotifications')
  const locale = useLocale()
  const headingId = useId()
  const [view, setView] = useState<FormNotificationsView | null>(initial)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [confirmLast, setConfirmLast] = useState<Pending>(null)
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)

  const errorText = (e: FormRecipientActionError): string => {
    if (e === 'invalid_email') return t('errors.invalidEmail')
    if (e === 'duplicate') return t('errors.duplicate')
    if (e === 'too_many') return t('errors.tooMany', { max: MAX_RECIPIENTS_PER_TOPIC })
    if (e === 'conflict') return t('errors.conflict')
    if (e === 'forbidden' || e === 'unauthenticated' || e === 'not_editable') return t('errors.forbidden')
    return t('errors.failed')
  }

  const noticeText = (n: NoticeOutcome, email: string): string | null =>
    n === 'sent' ? t('added.sent', { email }) : n === 'not_production' ? t('added.preview', { email }) : n === 'failed' ? t('added.notSent', { email }) : null

  async function run(op: 'add' | 'remove', group: RecipientGroupView, email: string) {
    if (!view || !group.key) return
    setBusy(true)
    setMessage(null)
    onSaveState('saving')
    const input = { projectSlug, locale, rev: view.rev, groupKey: group.key, email }
    const r = op === 'add' ? await addFormRecipientAction(input) : await removeFormRecipientAction(input)
    setBusy(false)
    if (r.ok) {
      setView(r.view)
      onSaveState('saved')
      if (op === 'add') {
        setDrafts((d) => ({ ...d, [group.key!]: '' }))
        const text = noticeText(r.notice, email.trim().toLowerCase())
        if (text) setMessage({ tone: 'info', text })
      }
      return true
    }
    onSaveState(r.error === 'conflict' ? 'conflict' : 'error')
    if (op === 'add') setErrors((e) => ({ ...e, [group.key!]: errorText(r.error) }))
    else setMessage({ tone: 'error', text: errorText(r.error) })
    return false
  }

  function submitAdd(group: RecipientGroupView, e: FormEvent) {
    e.preventDefault()
    if (!group.key || busy) return
    const value = drafts[group.key] ?? ''
    // Same rules as the server, checked first so a typo never leaves the page.
    const check = addRecipient(group.emails, value)
    if (!check.ok) {
      setErrors((x) => ({ ...x, [group.key!]: errorText(check.error) }))
      return
    }
    void run('add', group, value)
  }

  function askRemove(group: RecipientGroupView, email: string) {
    if (!group.key || busy) return
    if (group.emails.length === 1) setConfirmLast({ groupKey: group.key, email })
    else void run('remove', group, email)
  }

  const groupName = (g: RecipientGroupView) => (g.allForms ? t('allForms') : (g.label ?? g.topic))
  const confirmGroup = confirmLast && view ? view.groups.find((g) => g.key === confirmLast.groupKey) ?? null : null

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionHeading id={headingId} title={t('title')} />
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <p className="text-sm text-muted-foreground">{t('previewNote')}</p>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {!view || view.groups.length === 0 ? (
        <EmptyState compact titleAs="p" title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {view.groups.map((g, i) => {
            const id = g.key ?? `g${i}`
            const canEdit = editable && g.editable
            const full = g.emails.length >= MAX_RECIPIENTS_PER_TOPIC
            return (
              <Panel as="li" key={id}>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-base font-semibold break-words">{groupName(g)}</h3>
                    {g.allForms ? <p className="text-sm text-muted-foreground">{t('allFormsNote')}</p> : null}
                    {g.paused ? <p className="text-sm text-muted-foreground">{t('paused')}</p> : null}
                  </div>

                  {g.emails.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('nobody')}</p>
                  ) : (
                    <ul className="flex flex-col gap-1" aria-label={t('listLabel', { form: groupName(g) })}>
                      {g.emails.map((email) => (
                        <li key={email} className="flex min-h-11 items-center justify-between gap-3">
                          <span className="min-w-0 text-[0.9375rem] leading-6 break-all">{email}</span>
                          {canEdit ? (
                            <Button variant="quiet" disabled={busy} aria-label={t('removeNamed', { email })} onClick={() => askRemove(g, email)}>
                              {t('remove')}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}

                  {canEdit && !full ? (
                    <form className="flex flex-col gap-2 sm:flex-row sm:items-start" noValidate onSubmit={(e) => submitAdd(g, e)}>
                      <Field label={t('addLabel')} hint={t('limit', { max: MAX_RECIPIENTS_PER_TOPIC })} error={errors[id]} className="sm:flex-1">
                        {(p) => (
                          <TextInput
                            {...p}
                            type="email"
                            inputMode="email"
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            maxLength={MAX_EMAIL_LENGTH}
                            placeholder={t('addPlaceholder')}
                            value={drafts[id] ?? ''}
                            onChange={(e) => {
                              setDrafts((d) => ({ ...d, [id]: e.target.value }))
                              if (errors[id]) setErrors((x) => ({ ...x, [id]: '' }))
                            }}
                          />
                        )}
                      </Field>
                      <Button type="submit" variant="secondary" className="sm:mt-7" disabled={busy || !(drafts[id] ?? '').trim()}>
                        {t('add')}
                      </Button>
                    </form>
                  ) : null}
                  {canEdit && full ? <p className="text-sm text-muted-foreground">{t('full', { max: MAX_RECIPIENTS_PER_TOPIC })}</p> : null}
                </div>
              </Panel>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirmLast !== null}
        title={t('lastTitle')}
        body={confirmGroup ? t('lastBody', { email: confirmLast!.email, form: groupName(confirmGroup) }) : ''}
        confirmLabel={t('lastConfirm')}
        busy={busy}
        onCancel={() => setConfirmLast(null)}
        onConfirm={async () => {
          const target = confirmLast
          if (!target || !confirmGroup) return
          const group = confirmGroup
          setConfirmLast(null)
          if (!group.emails.some((e) => sameEmail(e, target.email))) return
          await run('remove', group, target.email)
        }}
      />
    </section>
  )
}
