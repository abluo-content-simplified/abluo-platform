'use client'

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { sendNewMessageAction } from '@/app/[locale]/(admin)/messages/message-actions'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { Chip } from '@/components/app/ui/Chip'
import { Field } from '@/components/app/ui/Field'
import { FilterBar, FilterSearch, FilterSelect } from '@/components/app/ui/FilterBar'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { RadioList } from '@/components/app/ui/RadioList'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { DataTable } from '@/components/app/ui/list/DataTable'
import { CellText } from '@/components/app/ui/list/cells'
import { fitScreenshots } from '@/lib/client/ticket-upload'
import { CLIENT_UPLOAD_BUDGET_BYTES } from '@/lib/support-tickets/client-form'
import type { DirectorySite } from '@/lib/messages/directory'
import { MESSAGE_LIMITS, messageErrorKey, planConversations, type ConversationMode, type Recipient } from '@/lib/messages/model'
import { EMPTY_EXTRAS, MessageExtras, type MessageExtrasValue } from './MessageExtras'

/** One row of the people list: a person on one site. */
type Row = { key: string; projectId: string; site: string; userId: string; name: string; email: string; role: string }

/**
 * New Message (ADR-050 D3/D4), on the full page width: on the left the people
 * list (name, email, role, site — only people with active access) with a
 * search and a site filter, and "select all" for what is shown; on the right
 * how to send (Separate by default, never remembered, or One shared
 * conversation on one site with its warning), subject, text, files (upload,
 * paste or Media Library) and links (dashboard or website page).
 */
export function NewMessageForm({ sites, linkTargets, preset }: { sites: DirectorySite[]; linkTargets: string[]; preset: Recipient[] }) {
  const t = useTranslations('admin.messages.new')
  const tc = useTranslations('app.messages')
  const tRoles = useTranslations('app.roles')
  const router = useRouter()
  const [q, setQ] = useState('')
  const [siteFilter, setSiteFilter] = useState(sites.length === 1 ? sites[0].id : '')
  const [recipients, setRecipients] = useState<Recipient[]>(preset)
  const [mode, setMode] = useState<ConversationMode>('individual')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [extras, setExtrasState] = useState<MessageExtrasValue>(EMPTY_EXTRAS)
  const setExtras = useCallback((v: MessageExtrasValue) => setExtrasState(v), [])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ recipients?: string; subject?: string; body?: string }>({})

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

  const rows = useMemo<Row[]>(
    () => sites.flatMap((s) => s.people.map((p) => ({ key: `${s.id}:${p.userId}`, projectId: s.id, site: s.name, userId: p.userId, name: p.name, email: p.email, role: p.role }))),
    [sites],
  )
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => (!siteFilter || r.projectId === siteFilter) && (!needle || `${r.name} ${r.email} ${r.site}`.toLowerCase().includes(needle)))
  }, [rows, q, siteFilter])
  const shownChosen = shown.filter((r) => chosen.has(r.key)).length
  const allState: 'none' | 'some' | 'all' = shownChosen === 0 ? 'none' : shownChosen === shown.length ? 'all' : 'some'
  const roleLabel = (role: string) => (tRoles.has(role) ? tRoles(role) : role)
  const onlySite = siteCount === 1 ? recipients[0].projectId : null

  const toggle = (r: Recipient, on: boolean) => setRecipients((prev) => (on ? [...prev.filter((x) => key(x) !== key(r)), r] : prev.filter((x) => key(x) !== key(r))))
  const toggleShown = (on: boolean) =>
    setRecipients((prev) => {
      const keys = new Set(shown.map((r) => r.key))
      const rest = prev.filter((x) => !keys.has(key(x)))
      return on ? [...rest, ...shown.map((r) => ({ projectId: r.projectId, userId: r.userId }))] : rest
    })

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
      const ready = await fitScreenshots(extras.files, CLIENT_UPLOAD_BUDGET_BYTES)
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
      form.set('links', JSON.stringify(extras.links))
      form.set('library', JSON.stringify(extras.library))
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

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel as="section" aria-labelledby="recipients-heading" className="flex min-w-0 flex-col gap-4">
          <h2 id="recipients-heading" className="text-[0.9375rem] leading-6 font-semibold">
            {t('recipients', { count: recipients.length })}
          </h2>
          {recipients.length > 0 ? (
            <div className="flex flex-wrap items-start gap-2">
              {recipients.map((r) => {
                const p = personOf(r)
                return (
                  <span key={key(r)} title={`${p.name} · ${p.site}`} className="inline-flex max-w-full min-w-0">
                    <Chip selected removable aria-label={t('removeRecipient', { name: `${p.name} (${p.site})` })} onClick={() => toggle(r, false)}>
                      <span className="block max-w-[14rem] truncate">{p.name}</span>
                    </Chip>
                  </span>
                )
              })}
            </div>
          ) : (
            <p className="text-sm leading-5 text-muted-foreground">{t('pickHint')}</p>
          )}
          {fieldErrors.recipients ? <p className="text-sm leading-5 text-destructive">{fieldErrors.recipients}</p> : null}

          <FilterBar label={t('filtersLabel')}>
            <FilterSearch value={q} onChange={setQ} label={t('findPeople')} placeholder={t('findPlaceholder')} />
            {sites.length > 1 ? (
              <FilterSelect
                label={t('siteFilter')}
                value={siteFilter}
                onChange={setSiteFilter}
                sizing="w-full min-w-0 sm:w-[16rem] sm:flex-none"
                options={[{ value: '', label: t('allSites') }, ...sites.map((s) => ({ value: s.id, label: s.name }))]}
              />
            ) : null}
          </FilterBar>

          {shown.length === 0 ? (
            <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('noPeople')}</p>
          ) : (
            <div className="max-h-[32rem] overflow-y-auto rounded-xl">
              <DataTable
                rows={shown}
                rowKey={(r) => r.key}
                label={t('peopleTable')}
                minWidth="min-w-[36rem]"
                onRowClick={(r) => toggle({ projectId: r.projectId, userId: r.userId }, !chosen.has(r.key))}
                selection={{
                  selected: chosen,
                  onToggle: (id, on) => {
                    const r = shown.find((x) => x.key === id)
                    if (r) toggle({ projectId: r.projectId, userId: r.userId }, on)
                  },
                  allState,
                  onToggleAll: toggleShown,
                  rowLabel: (r) => t('selectPerson', { name: r.name || r.email, site: r.site }),
                  allLabel: siteFilter ? t('selectAllSite', { count: shown.length }) : t('selectAllShown', { count: shown.length }),
                }}
                columns={[
                  { key: 'name', header: t('columns.name'), width: 'min-w-40', render: (r) => <CellText primary={r.name || r.email} clamp={1} /> },
                  { key: 'email', header: t('columns.email'), width: 'min-w-48', render: (r) => <CellText primary={r.email} clamp={1} /> },
                  { key: 'role', header: t('columns.role'), width: 'min-w-28', render: (r) => <CellText primary={roleLabel(r.role)} clamp={1} /> },
                  { key: 'site', header: t('columns.site'), width: 'min-w-40', render: (r) => <CellText primary={r.site} clamp={2} /> },
                ]}
              />
            </div>
          )}
          <p className="text-sm leading-5 text-muted-foreground">{t('showing', { shown: shown.length, total: rows.length })}</p>
        </Panel>

        <div className="flex min-w-0 flex-col gap-6">
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
            <MessageExtras
              projectId={onlySite}
              noSiteReason={siteCount > 1 ? t('severalSites') : t('noRecipientYet')}
              linkTargets={linkTargets}
              value={extras}
              onChange={setExtras}
              disabled={pending}
            />
          </Panel>

          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ButtonLink variant="secondary" size="lg" href="/messages">
              {t('cancel')}
            </ButtonLink>
            <Button variant="primary" size="lg" disabled={pending} aria-busy={pending || undefined} onClick={() => void send()}>
              {pending ? tc('sending') : sendLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
