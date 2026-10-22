'use client'

import { useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/app/ui/Button'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { DateTimePicker } from '@/components/app/ui/DateTimePicker'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Field } from '@/components/app/ui/Field'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { Notice } from '@/components/app/ui/Notice'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { TextArea } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { LocalDate, Pill, type PillTone } from '@/components/app/ui/list/cells'
import { saveNoticeAction } from '@/app/[locale]/(admin)/whats-new/actions'
import type { SaveIntent } from '@/app/[locale]/(admin)/whats-new/actions'
import type { AdminNotice } from '@/lib/whats-new/notices-admin'
import { NOTICE_LIMITS, NOTICE_TONES, isNoticeActive, type NoticeError, type NoticeInput, type NoticeTone } from '@/lib/whats-new/notices'
import { pickLocalized, type LocalizedText, type ProductUpdateStatus, type WhatsNewLocale } from '@/lib/whats-new/model'

/**
 * Admin "Announcements" (migration 045): short notices shown as a banner on top
 * of the client dashboard between a start and an end time — planned
 * maintenance, a known issue. Message per language, tone (info can be closed
 * by the client, warning cannot), window, audience (modules; none ticked =
 * every client). Lives under the What's new list. Every write goes through the
 * admin server action (requireAbluoAdmin).
 */

type ModuleOption = { id: string; label: string }
type LanguageOption = { code: WhatsNewLocale; name: string }

/** Times are entered in the platform owner's zone. */
const ZONE = 'Europe/Rome'

const STATUS_TONE: Record<ProductUpdateStatus, PillTone> = { draft: 'outline', published: 'success', archived: 'muted' }
const HELP = 'mt-1 text-sm text-muted-foreground'

type Draft = NoticeInput
const EMPTY: Draft = { message: {}, tone: 'info', startsAt: null, endsAt: null, modules: [] }
const toDraft = (n: AdminNotice): Draft => ({ message: n.message, tone: n.tone, startsAt: n.startsAt, endsAt: n.endsAt, modules: n.modules })

export function AnnouncementsAdmin({
  notices: initial,
  modules,
  languages,
  missing,
}: {
  notices: AdminNotice[]
  modules: ModuleOption[]
  languages: LanguageOption[]
  /** Migration 045 is not applied yet. */
  missing: boolean
}) {
  const t = useTranslations('admin.announcements')
  const router = useRouter()
  const [notices, setNotices] = useState(initial)
  const [serverList, setServerList] = useState(initial)
  if (serverList !== initial) {
    setServerList(initial)
    setNotices(initial)
  }
  const [editing, setEditing] = useState<string | null>(null)
  const [session, setSession] = useState(0)
  const [toast, setToast] = useState<{ message: string; tone: 'status' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [now] = useState(() => Date.now())

  const show = (message: string, tone: 'status' | 'error' = 'status') => {
    setToast({ message, tone })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }
  const openEditor = (id: string) => {
    setSession((s) => s + 1)
    setEditing(id)
  }
  const current = editing && editing !== 'new' ? (notices.find((n) => n.id === editing) ?? null) : null
  const messageOf = (n: AdminNotice) => pickLocalized(n.message, 'en')?.text ?? ''

  const onSaved = (saved: AdminNotice, intent: SaveIntent) => {
    setNotices((list) => (list.some((n) => n.id === saved.id) ? list.map((n) => (n.id === saved.id ? saved : n)) : [saved, ...list]))
    setEditing(null)
    show(t(`toast.${intent === 'publish' ? 'published' : intent === 'archive' ? 'archived' : 'saved'}`))
    router.refresh()
  }

  const stateOf = (n: AdminNotice): string => {
    if (n.status !== 'published') return t(`status.${n.status}`)
    if (isNoticeActive(n.startsAt, n.endsAt, now)) return t('status.showing')
    return Date.parse(n.startsAt) > now ? t('status.scheduled') : t('status.ended')
  }

  return (
    <section aria-labelledby="announcements-heading" className="mt-10 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <SectionHeading id="announcements-heading" title={t('title')} />
        {!missing ? <Button onClick={() => openEditor('new')}>{t('newNotice')}</Button> : null}
      </div>
      <p className="text-sm text-muted-foreground">{t('description')}</p>

      {missing ? (
        <EmptyState title={t('missingTitle')} body={t('missingBody')} />
      ) : notices.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <ul aria-label={t('title')} className="flex flex-col gap-3">
          {notices.map((n) => (
            <ListRow key={n.id} onOpen={() => openEditor(n.id)}>
              <span className="line-clamp-2 text-[0.9375rem] leading-6 font-semibold text-foreground">{messageOf(n) || t('noMessage')}</span>
              <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Pill tone={STATUS_TONE[n.status]}>{stateOf(n)}</Pill>
                <Pill tone={n.tone === 'warning' ? 'highlight' : 'muted'}>{t(`tones.${n.tone}`)}</Pill>
                <span>
                  <LocalDate iso={n.startsAt} /> – <LocalDate iso={n.endsAt} />
                </span>
              </span>
            </ListRow>
          ))}
        </ul>
      )}

      <NoticeEditor
        key={session}
        open={editing !== null}
        notice={current}
        modules={modules}
        languages={languages}
        onClose={() => setEditing(null)}
        onSaved={onSaved}
        onError={(m) => show(m, 'error')}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </section>
  )
}

function NoticeEditor({
  open,
  notice,
  modules,
  languages,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean
  notice: AdminNotice | null
  modules: ModuleOption[]
  languages: LanguageOption[]
  onClose: () => void
  onSaved: (n: AdminNotice, intent: SaveIntent) => void
  onError: (message: string) => void
}) {
  const t = useTranslations('admin.announcements')
  const [draft, setDraft] = useState<Draft>(() => (notice ? toDraft(notice) : EMPTY))
  const [lang, setLang] = useState<WhatsNewLocale>(languages[0]?.code ?? 'en')
  const [errors, setErrors] = useState<string[]>([])
  const [pending, startTransition] = useTransition()
  const status: ProductUpdateStatus = notice?.status ?? 'draft'

  const setMessage = (value: string) => setDraft((d) => ({ ...d, message: { ...d.message, [lang]: value } as LocalizedText }))
  const toggleModule = (id: string, on: boolean) =>
    setDraft((d) => ({ ...d, modules: on ? [...new Set([...d.modules, id])] : d.modules.filter((m) => m !== id) }))

  const save = (intent: SaveIntent) =>
    startTransition(async () => {
      setErrors([])
      const res = await saveNoticeAction(notice?.id ?? null, intent, draft)
      if (res.ok) return onSaved(res.notice, intent)
      if (res.error === 'invalid') setErrors(res.errors.map((e: NoticeError) => t(`errors.${e}`)))
      else onError(t(`errors.${res.error}`))
    })

  const actions =
    status === 'published' ? (
      <>
        <Button variant="primary" disabled={pending} onClick={() => save('save')}>
          {t('actions.saveChanges')}
        </Button>
        <Button disabled={pending} onClick={() => save('archive')}>
          {t('actions.archive')}
        </Button>
      </>
    ) : (
      <>
        <Button variant="primary" disabled={pending} onClick={() => save('publish')}>
          {t('actions.publish')}
        </Button>
        <Button disabled={pending} onClick={() => save(status === 'archived' ? 'draft' : 'save')}>
          {status === 'archived' ? t('actions.moveToDraft') : t('actions.saveDraft')}
        </Button>
      </>
    )

  return (
    <SidePanel
      open={open}
      title={notice ? t('editTitle') : t('newTitle')}
      subtitle={notice ? t(`status.${status}`) : undefined}
      closeLabel={t('actions.close')}
      onClose={onClose}
      actions={actions}
    >
      <div className="space-y-6">
        {errors.length ? (
          <Notice tone="error">
            <ul className="space-y-1">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        <fieldset className="space-y-4">
          <FieldLabel as="legend">{t('fields.language')}</FieldLabel>
          <SegmentedControl
            label={t('fields.language')}
            appearance="chips"
            value={lang}
            onChange={setLang}
            options={languages.map((l) => ({ value: l.code, label: l.name }))}
          />
          <Field label={t('fields.message')} hint={t('fields.messageHelp')}>
            {(p) => <TextArea {...p} lang={lang} rows={4} value={draft.message[lang] ?? ''} maxLength={NOTICE_LIMITS.message} onChange={(e) => setMessage(e.target.value)} />}
          </Field>
        </fieldset>

        <div>
          <FieldLabel as="p">{t('fields.tone')}</FieldLabel>
          <p className={HELP}>{t('fields.toneHelp')}</p>
          <div className="mt-2">
            <SegmentedControl
              label={t('fields.tone')}
              appearance="chips"
              value={draft.tone}
              onChange={(tone: NoticeTone) => setDraft((d) => ({ ...d, tone }))}
              options={NOTICE_TONES.map((tone) => ({ value: tone, label: t(`tones.${tone}`) }))}
            />
          </div>
        </div>

        <div className="space-y-4">
          <Field label={t('fields.startsAt')}>
            {(p) => (
              <DateTimePicker id={p.id} value={draft.startsAt} zone={ZONE} allowPast onChange={(startsAt) => setDraft((d) => ({ ...d, startsAt }))} />
            )}
          </Field>
          <Field label={t('fields.endsAt')} hint={t('fields.endsAtHelp')}>
            {(p) => (
              <DateTimePicker id={p.id} value={draft.endsAt} zone={ZONE} after={draft.startsAt} onChange={(endsAt) => setDraft((d) => ({ ...d, endsAt }))} />
            )}
          </Field>
        </div>

        <fieldset>
          <FieldLabel as="legend">{t('fields.audience')}</FieldLabel>
          <p className={HELP}>{t('fields.audienceHelp')}</p>
          <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {modules.map((m) => (
              <li key={m.id}>
                <label className="flex cursor-pointer items-center gap-1 text-[0.9375rem] text-foreground">
                  <Checkbox checked={draft.modules.includes(m.id)} onChange={(on) => toggleModule(m.id, on)} aria-label={m.label} />
                  {m.label}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>
    </SidePanel>
  )
}
