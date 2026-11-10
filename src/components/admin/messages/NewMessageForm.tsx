'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { sendNewMessageAction } from '@/app/[locale]/(admin)/messages/message-actions'
import { AttachmentPicker } from '@/components/app/ui/AttachmentPicker'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
import { CheckboxCard } from '@/components/app/ui/CheckboxCard'
import { Chip } from '@/components/app/ui/Chip'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { RadioList } from '@/components/app/ui/RadioList'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { fitScreenshots } from '@/lib/client/ticket-upload'
import { CLIENT_UPLOAD_BUDGET_BYTES } from '@/lib/support-tickets/client-form'
import type { DirectorySite } from '@/lib/messages/directory'
import { MESSAGE_FILE_TYPES, MESSAGE_LIMITS, messageErrorKey, planConversations, type ConversationMode, type Recipient } from '@/lib/messages/model'
import { LinkChooser } from './LinkChooser'

/**
 * New Message (ADR-050 D3/D4). Pick people (only those with active access,
 * grouped by site), choose Separate (default, never remembered) or One shared
 * conversation (one site only, with the "everyone sees all replies" warning
 * and a "Send to everyone (N)" button), then subject, text, files and
 * dashboard links.
 */
export function NewMessageForm({ sites, linkTargets, preset }: { sites: DirectorySite[]; linkTargets: string[]; preset: Recipient[] }) {
  const t = useTranslations('admin.messages.new')
  const tc = useTranslations('app.messages')
  const tRoles = useTranslations('app.roles')
  const router = useRouter()
  const [q, setQ] = useState('')
  const [recipients, setRecipients] = useState<Recipient[]>(preset)
  const [mode, setMode] = useState<ConversationMode>('individual')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [links, setLinks] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ recipients?: string; subject?: string; body?: string }>({})
  const mb = Math.round(MESSAGE_LIMITS.imageBytesMax / (1024 * 1024))

  const key = (r: Recipient) => `${r.projectId}:${r.userId}`
  const chosen = new Set(recipients.map(key))
  const personOf = (r: Recipient) => {
    const site = sites.find((s) => s.id === r.projectId)
    const p = site?.people.find((x) => x.userId === r.userId)
    return { site: site?.name ?? '', name: p?.name || p?.email || '' }
  }
  const siteCount = new Set(recipients.map((r) => r.projectId)).size
  const sharedPossible = siteCount === 1 && recipients.length > 1
  const effectiveMode: ConversationMode = mode === 'shared' && sharedPossible ? 'shared' : 'individual'
  const names = recipients.map((r) => personOf(r).name)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return sites
    return sites
      .map((s) => (s.name.toLowerCase().includes(needle) ? s : { ...s, people: s.people.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(needle)) }))
      .filter((s) => s.people.length > 0)
  }, [sites, q])

  const toggle = (r: Recipient, on: boolean) => setRecipients((prev) => (on ? [...prev.filter((x) => key(x) !== key(r)), r] : prev.filter((x) => key(x) !== key(r))))

  const sendLabel =
    effectiveMode === 'shared' ? t('sendToEveryone', { count: recipients.length }) : recipients.length > 1 ? t('sendSeparately', { count: recipients.length }) : t('send')

  async function send() {
    if (pending) return
    const errs: typeof fieldErrors = {}
    const plan = planConversations(effectiveMode, recipients)
    if (!plan.ok) errs.recipients = tc(`errors.${plan.error}`)
    if (!subject.trim()) errs.subject = tc('errors.subjectRequired')
    if (!body.trim()) errs.body = tc('errors.bodyRequired')
    setFieldErrors(errs)
    if (Object.keys(errs).length) return
    setPending(true)
    setError(null)
    try {
      const ready = await fitScreenshots(files, CLIENT_UPLOAD_BUDGET_BYTES)
      if (!ready) {
        setError(tc('errors.uploadTooLarge'))
        setPending(false)
        return
      }
      const form = new FormData()
      form.set('mode', effectiveMode)
      form.set('recipients', JSON.stringify(recipients))
      form.set('subject', subject)
      form.set('body', body)
      form.set('links', JSON.stringify(links))
      for (const f of ready) form.append('files', f)
      const result = await sendNewMessageAction(form)
      if (result.ok) {
        router.push(result.value.ids.length === 1 ? `/messages/${result.value.ids[0]}` : '/messages')
        return
      }
      setError(tc(`errors.${messageErrorKey(result.reason, result.field)}`))
    } catch {
      setError(tc('errors.error'))
    }
    setPending(false)
  }

  return (
    <>
      <BackLink href="/messages" label={t('back')} />
      <PageHeader title={t('title')} />
      <p className="text-sm leading-5 text-muted-foreground">{t('intro')}</p>

      <div className="flex max-w-[42rem] flex-col gap-6">
        <Panel as="section" aria-labelledby="recipients-heading">
          <h2 id="recipients-heading" className="text-[0.9375rem] leading-6 font-semibold">
            {t('recipients', { count: recipients.length })}
          </h2>
          {recipients.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-start gap-2">
              {recipients.map((r) => {
                const p = personOf(r)
                return (
                  <Chip key={key(r)} selected removable aria-label={t('removeRecipient', { name: p.name })} onClick={() => toggle(r, false)}>
                    {p.name} · {p.site}
                  </Chip>
                )
              })}
            </div>
          ) : null}
          {fieldErrors.recipients ? <p className="mt-2 text-sm leading-5 text-destructive">{fieldErrors.recipients}</p> : null}
          <Field label={t('findPeople')} className="mt-4">
            {(p) => <TextInput {...p} type="search" value={q} placeholder={t('findPlaceholder')} onChange={(e) => setQ(e.target.value)} />}
          </Field>
          <div className="mt-4 flex max-h-[28rem] flex-col gap-5 overflow-y-auto">
            {filtered.length === 0 ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('noPeople')}</p> : null}
            {filtered.map((s) => (
              <section key={s.id} aria-label={s.name} className="flex flex-col gap-2">
                <h3 className="text-sm leading-5 font-semibold text-muted-foreground">{s.name}</h3>
                {s.people.map((p) => {
                  const r = { projectId: s.id, userId: p.userId }
                  return (
                    <CheckboxCard
                      key={p.userId}
                      label={p.name || p.email}
                      description={[p.name ? p.email : null, tRoles.has(p.role) ? tRoles(p.role) : p.role].filter(Boolean).join(' · ')}
                      checked={chosen.has(key(r))}
                      onChange={(on) => toggle(r, on)}
                    />
                  )
                })}
              </section>
            ))}
          </div>
        </Panel>

        {recipients.length > 1 ? (
          <Panel as="section">
            <RadioList
              legend={t('mode.legend')}
              name="mode"
              value={effectiveMode}
              onChange={setMode}
              options={[
                { value: 'individual', label: t('mode.individual'), description: t('mode.individualHelp') },
                {
                  value: 'shared',
                  label: t('mode.shared'),
                  description: sharedPossible ? t('mode.sharedHelp') : t('mode.sharedOneSite'),
                  disabled: !sharedPossible,
                },
              ]}
            />
            {effectiveMode === 'shared' ? (
              <Notice tone="info" title={t('mode.warningTitle')} className="mt-3">
                {t('mode.warning', { names: names.join(', ') })}
              </Notice>
            ) : null}
          </Panel>
        ) : null}

        <Panel as="section" className="flex flex-col gap-4">
          <Field label={t('subject')} error={fieldErrors.subject}>
            {(p) => <TextInput {...p} value={subject} maxLength={MESSAGE_LIMITS.subjectMax} onChange={(e) => setSubject(e.target.value)} />}
          </Field>
          <Field label={t('body')} hint={t('bodyHint')} error={fieldErrors.body}>
            {(p) => <TextArea {...p} rows={8} value={body} maxLength={MESSAGE_LIMITS.bodyMax} onChange={(e) => setBody(e.target.value)} />}
          </Field>
          <AttachmentPicker
            acceptPaste
            files={files}
            onChange={setFiles}
            max={MESSAGE_LIMITS.attachmentsMax}
            maxBytes={MESSAGE_LIMITS.imageBytesMax}
            accept={MESSAGE_FILE_TYPES}
            disabled={pending}
            labels={{
              add: tc('picker.add'),
              hint: tc('picker.hint', { max: MESSAGE_LIMITS.attachmentsMax, size: mb }),
              remove: (name) => tc('picker.remove', { name }),
              problem: (p) => tc(`picker.problem.${p.kind}`, { name: p.name, size: mb, max: MESSAGE_LIMITS.attachmentsMax }),
            }}
          />
          <LinkChooser targets={linkTargets} value={links} onChange={setLinks} disabled={pending} />
        </Panel>

        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-wrap items-start justify-end gap-2">
          <Button variant="primary" size="lg" disabled={pending} aria-busy={pending || undefined} onClick={() => void send()}>
            {pending ? tc('sending') : sendLabel}
          </Button>
        </div>
      </div>
    </>
  )
}
