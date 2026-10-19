'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { PortableTextBlock } from '@portabletext/editor'
import { useRouter } from '@/i18n/navigation'
import type { FaqEntryValue, FaqSetSnapshot, FaqSetState, FaqSetUsage } from '@/lib/api/faq-sets'
import {
  discardFaqSetDraftAction,
  duplicateFaqSetAction,
  faqSetLifecycleAction,
  getFaqSetAction,
  openFaqSetForEditAction,
  patchFaqSetDraftAction,
  publishFaqSetDraftAction,
} from '@/app/[locale]/(client)/[tenant]/faq-sets/actions'
import { useAutosave } from '@/lib/client/autosave/use-autosave'
import type { PendingSet } from '@/lib/client/autosave/journal'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { SaveNotice } from '@/components/app/ui/SaveNotice'
import { SavePill } from '@/components/app/ui/SavePill'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import { dropIndex, usePointerDrag } from '@/components/app/ui/use-pointer-drag'
import { useUndo } from '@/components/app/ui/use-undo'
import { FaqQuestionCard, isTranslated } from './FaqQuestionCard'
import { FaqSetActivitySheet } from './FaqSetActivitySheet'
import { FAQ_ICONS, FAQ_UI_LIMITS, FaqStateBadge, UsedInList, useLanguageName, useUsedInSummary } from './faq-bits'
import { useFaqLinkTools } from './use-faq-link-tools'

/** A fresh, valid `_key` (the server keeps it: /^[A-Za-z0-9_-]{1,64}$/). */
function newKey(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  } catch {
    return Math.random().toString(36).slice(2, 14)
  }
}

function moveIndex<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

type Confirm = 'publish' | 'discard' | 'delete' | 'deletePermanently' | null

/**
 * The FAQ set editor (ADR-037 D9) — one page, autosaved to the draft
 * (platform rule: incomplete drafts always save; there is no Save button).
 *
 *   name · optional public title per language · internal note
 *   questions as cards: question + answer (restricted rich text, D12), add,
 *   remove (with Undo), drag or ArrowUp / ArrowDown to reorder
 *   a language switch over the site's languages; "Not translated" per card
 *   Used in (pages and posts showing the set) + the shared-content warning
 *   Publish · Discard changes · Duplicate · Archive / Restore · Delete · Activity
 *
 * The first edit of a published set opens its draft (openFaqSetForEditAction,
 * from the browser — never on GET). Every change of the list sends the whole
 * `items` list (the server rebuilds and sanitizes it).
 *
 * `mode="embedded"` (the post editor's FAQ sheet, Builder C): no back link,
 * no lifecycle menu and no Publish (the post's publish offers "Publish the FAQ
 * set too"); a Done button flushes and calls `onSaved`, then `onClose`.
 */
export function FaqSetEditor({
  projectSlug,
  initial,
  mode,
  canWrite = true,
  canDelete = false,
  onSaved,
  onClose,
}: {
  projectSlug: string
  initial: FaqSetSnapshot
  mode: 'page' | 'embedded'
  /** faq.set.write (the server re-checks). Without it the editor is read-only. */
  canWrite?: boolean
  /** faq.set.delete: may delete an archived set permanently. */
  canDelete?: boolean
  /** Embedded: called after Done once everything is saved. */
  onSaved?: (set: { id: string; name: string; count: number; state: FaqSetState; firstQuestions: string[] }) => void
  onClose?: () => void
}) {
  const t = useTranslations('clientDashboard.faq.editor')
  const te = useTranslations('clientDashboard.faq.errors')
  const tl = useTranslations('app.lifecycle')
  const router = useRouter()
  const languageName = useLanguageName()
  const summarize = useUsedInSummary()
  const id = initial.id
  const page = mode === 'page'
  const listHref = `/${projectSlug}/faq-sets`

  const languages = initial.site.languages.length ? initial.site.languages : [initial.site.defaultLocale]
  const d = initial.site.defaultLocale || languages[0]

  // ── State ──────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<{ state: FaqSetState; hasDraft: boolean; isPublished: boolean; usedIn: FaqSetUsage[] }>({
    state: initial.state,
    hasDraft: initial.hasDraft,
    isPublished: initial.isPublished,
    usedIn: initial.usedIn,
  })
  const [name, setName] = useState(initial.name)
  const [note, setNote] = useState(initial.note)
  const [title, setTitle] = useState<Record<string, string>>(initial.title)
  const [items, setItems] = useState<FaqEntryValue[]>(initial.items)
  const itemsRef = useRef(initial.items)
  const [lang, setLang] = useState(d)
  const [generation, setGeneration] = useState(0)
  /** A server draft exists (decides whether the next save must open one first). */
  const hasDraftRef = useRef(initial.hasDraft)

  const archived = status.state === 'archived'
  const editable = canWrite && !archived
  const links = useFaqLinkTools(projectSlug, editable ? lang : null)

  const apply = useCallback((s: FaqSetSnapshot) => {
    hasDraftRef.current = s.hasDraft
    setStatus({ state: s.state, hasDraft: s.hasDraft, isPublished: s.isPublished, usedIn: s.usedIn })
    setName(s.name)
    setNote(s.note)
    setTitle(s.title)
    itemsRef.current = s.items
    setItems(s.items)
    setGeneration((g) => g + 1)
  }, [])

  // ── Autosave ───────────────────────────────────────────────────────────────
  const send = useCallback(
    async (input: { rev: string; set: PendingSet }) => {
      let rev = input.rev
      if (!hasDraftRef.current || !rev) {
        // A published set: the first change opens its draft (an exact copy).
        const opened = await openFaqSetForEditAction({ projectSlug, id })
        if (!opened.ok) return { ok: false, error: opened.error } as const
        rev = opened.rev
        hasDraftRef.current = true
      }
      const r = await patchFaqSetDraftAction({ projectSlug, id, rev, set: input.set })
      return r.ok ? ({ ok: true, rev: r.rev } as const) : ({ ok: false, error: r.error } as const)
    },
    [projectSlug, id]
  )
  /** Set once useAutosave exists (below): a reload must hand the server's revision to the engine. */
  const adoptRevRef = useRef<(rev: string) => void>(() => {})
  const reload = useCallback(async () => {
    const r = await getFaqSetAction({ projectSlug, id })
    if (r.ok) {
      apply(r.set)
      // Archive / restore / discard change the draft's revision: without this
      // the next autosave would be refused as "edited elsewhere".
      if (r.set.rev) adoptRevRef.current(r.set.rev)
    }
    return r.ok
  }, [projectSlug, id, apply])
  /** A tab closed mid-save is replayed by the engine; once it lands, show what the server now holds. */
  const [replayed, setReplayed] = useState(false)
  const onReady = useCallback((r: PendingSet | null) => {
    if (r && Object.keys(r).length) setReplayed(true)
  }, [])
  const autosave = useAutosave({ draftId: `faqSet:${id}`, rev: initial.rev, send, onReady })
  adoptRevRef.current = autosave.adoptRev
  const flushEngine = autosave.flush
  useEffect(() => {
    if (!replayed) return
    let live = true
    void (async () => {
      if ((await flushEngine()) && live) await reload()
    })()
    return () => {
      live = false
    }
  }, [replayed, flushEngine, reload])

  /** Every change goes through here: shown at once, autosaved after a pause. */
  const save = (set: PendingSet) => {
    if (!editable) return
    setStatus((s) => (s.hasDraft ? s : { ...s, hasDraft: true, state: s.isPublished ? 'changes' : 'draft' }))
    autosave.set(set)
  }
  const saveItems = (next: FaqEntryValue[]) => {
    itemsRef.current = next
    setItems(next)
    save({ items: next })
  }
  const patchItem = (key: string, fn: (e: FaqEntryValue) => FaqEntryValue) => saveItems(itemsRef.current.map((e) => (e._key === key ? fn(e) : e)))

  // ── Questions ──────────────────────────────────────────────────────────────
  const { toast, show } = useUndo()
  const listRef = useRef<HTMLOListElement>(null)
  const full = items.length >= FAQ_UI_LIMITS.items
  const addQuestion = () => {
    if (full) return
    const entry: FaqEntryValue = { _key: newKey(), question: {}, answer: {} }
    saveItems([...itemsRef.current, entry])
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLInputElement>(`[data-drag-key="${entry._key}"] input`)?.focus())
  }
  const removeQuestion = (key: string) => {
    const before = itemsRef.current
    const gone = before.find((e) => e._key === key)
    saveItems(before.filter((e) => e._key !== key))
    const label = gone?.question[lang]?.trim() || gone?.question[d]?.trim() || ''
    show({
      message: label ? t('removed', { question: label }) : t('removedUntitled'),
      tone: 'status',
      undo: () => {
        saveItems(before)
        show(null)
      },
    }, 8000)
  }
  const drag = usePointerDrag((key, over) => {
    const list = itemsRef.current
    const to = dropIndex(list.map((e) => e._key), key, over)
    if (to !== null) saveItems(moveIndex(list, list.findIndex((e) => e._key === key), to))
  })

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [activity, setActivity] = useState(false)

  const errorText = (code: string, usedIn?: FaqSetUsage[]) =>
    code === 'in_use' && usedIn?.length ? te('in_use', { places: summarize(usedIn) }) : te.has(code) ? te(code) : te('failed')
  /** Everything typed is on the server (or say why not). */
  const flushed = async (): Promise<boolean> => {
    if (await autosave.flush()) return true
    setNotice(te(autosave.currentState() === 'conflict' ? 'conflict' : 'offline'))
    return false
  }

  const answered = items.filter((e) => e.question[d]?.trim()).length
  const publishReason = !editable ? null : !status.hasDraft ? t('publishReason.upToDate') : answered === 0 ? t('publishReason.empty', { language: languageName(d) }) : null
  const shared = status.usedIn.length > 1
  const sharedText = t('shared', { count: status.usedIn.length, places: summarize(status.usedIn) })

  async function publish() {
    if (busy || publishReason) return
    setBusy(true)
    setPublishing(true)
    setNotice(null)
    setConfirmError(null)
    try {
      if (!(await flushed())) return
      const r = await publishFaqSetDraftAction({ projectSlug, id, rev: autosave.currentRev() })
      if (!r.ok) {
        const text = errorText(r.error, r.detail?.usedIn)
        if (confirm) setConfirmError(text)
        else setNotice(text)
        return
      }
      hasDraftRef.current = false
      await autosave.discard()
      setStatus((s) => ({ ...s, hasDraft: false, isPublished: true, state: 'published' }))
      setConfirm(null)
      show({ message: shared ? t('publishedShared') : t('published'), tone: 'status' })
      router.refresh()
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
      setPublishing(false)
    }
  }

  async function runConfirm() {
    if (!confirm || busy) return
    if (confirm === 'publish') return publish()
    setBusy(true)
    setConfirmError(null)
    try {
      if (confirm === 'discard') {
        await autosave.flush()
        const r = await discardFaqSetDraftAction({ projectSlug, id, rev: autosave.currentRev() })
        if (!r.ok) return setConfirmError(errorText(r.error))
        await autosave.discard()
        await reload()
        setConfirm(null)
        show({ message: t('discarded'), tone: 'status' })
        return
      }
      const op = confirm === 'delete' ? 'deleteDraft' : 'deletePermanently'
      const r = await faqSetLifecycleAction({ projectSlug, id, op })
      if (!r.ok) return setConfirmError(errorText(r.error, r.detail?.usedIn))
      await autosave.discard()
      setConfirm(null)
      if (page) router.push(listHref)
      else onClose?.()
    } catch {
      setConfirmError(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  async function lifecycle(op: 'archive' | 'restore') {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      if (op === 'archive' && !(await flushed())) return
      const r = await faqSetLifecycleAction({ projectSlug, id, op })
      if (!r.ok) return setNotice(errorText(r.error, r.detail?.usedIn))
      await reload()
      show({ message: op === 'archive' ? t('archived') : t('restored'), tone: 'status' })
      router.refresh()
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  async function duplicate() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      if (!(await flushed())) return
      const r = await duplicateFaqSetAction({ projectSlug, id, name: t('copyOf', { name: name.trim() || t('untitled') }).slice(0, FAQ_UI_LIMITS.name) })
      if (!r.ok) return setNotice(errorText(r.error))
      router.push(`/${projectSlug}/faq-sets/${r.id}`)
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  async function done() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      if (!(await flushed())) return
      onSaved?.({
        id,
        name: name.trim(),
        count: itemsRef.current.length,
        state: status.state,
        firstQuestions: itemsRef.current.map((e) => e.question[d]?.trim() ?? '').filter(Boolean).slice(0, 2),
      })
      onClose?.()
    } finally {
      setBusy(false)
    }
  }

  const lifecycleItems: CardMenuItem[] = !(canWrite && page)
    ? []
    : archived
      ? [
          { key: 'restore', label: tl('actions.restore'), onSelect: () => void lifecycle('restore') },
          ...(canDelete
            ? [{ key: 'deletePermanently', label: tl('actions.deletePermanently'), onSelect: () => setConfirm('deletePermanently'), destructive: true, separated: true }]
            : []),
        ]
      : status.isPublished
        ? [{ key: 'archive', label: tl('actions.archive'), onSelect: () => void lifecycle('archive') }]
        : [{ key: 'delete', label: tl('actions.delete'), onSelect: () => setConfirm('delete'), destructive: true, separated: true }]
  const menu: CardMenuItem[] = [
    ...(editable && status.isPublished && status.hasDraft ? [{ key: 'discard', label: t('menu.discard'), onSelect: () => setConfirm('discard') }] : []),
    ...(canWrite && page ? [{ key: 'duplicate', label: t('menu.duplicate'), onSelect: () => void duplicate() }] : []),
    { key: 'activity', label: t('menu.activity'), onSelect: () => setActivity(true) },
    ...lifecycleItems,
  ]

  // ── Render ─────────────────────────────────────────────────────────────────
  const displayName = name.trim() || t('untitled')
  const publishButton = editable && page ? (
    <Button
      variant="primary"
      disabled={busy || !!publishReason}
      aria-describedby={publishReason ? 'faq-publish-reason' : undefined}
      onClick={() => (shared ? setConfirm('publish') : void publish())}
    >
      {publishing ? t('publishing') : t('publish')}
    </Button>
  ) : null

  const usedInPanel = (
    <Panel as="section" aria-labelledby="faq-used-in" className="space-y-3">
      <h2 id="faq-used-in" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
        {t('usedInTitle')} <span className="font-normal text-muted-foreground tabular-nums">· {status.usedIn.length}</span>
      </h2>
      <UsedInList usedIn={status.usedIn} projectSlug={projectSlug} />
    </Panel>
  )

  return (
    <div className="space-y-5">
      {page ? (
        <>
          <BackLink href={listHref} label={t('back')} />
          <div className="-mt-3">
            <PageHeader
              title={displayName}
              actions={
                <>
                  {editable ? <SavePill state={autosave.state} onReload={() => window.location.reload()} /> : null}
                  {publishButton}
                  <CardMenu label={t('menu.label')} items={menu} />
                </>
              }
            />
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="min-w-0 pt-2 text-lg leading-7 font-semibold text-foreground">{displayName}</h2>
          <div className="flex items-center gap-2">
            {editable ? <SavePill state={autosave.state} /> : null}
            <CardMenu label={t('menu.label')} items={menu} />
            <Button variant="primary" disabled={busy} onClick={() => void done()}>
              {t('done')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col items-start gap-2">
        <FaqStateBadge state={status.state} />
        {publishReason && page ? (
          <p id="faq-publish-reason" className="text-sm leading-5 text-muted-foreground">
            {publishReason}
          </p>
        ) : null}
      </div>

      {editable ? (
        <SaveNotice
          state={autosave.state}
          rejected={autosave.rejected.map((p) => (p === 'items' ? 'other' : p))}
          onRetry={autosave.retry}
          onReload={() => window.location.reload()}
        />
      ) : null}
      {archived ? (
        <Notice
          tone="info"
          title={t('archivedTitle')}
          action={canWrite && page ? <Button onClick={() => void lifecycle('restore')}>{tl('actions.restore')}</Button> : undefined}
        >
          {t('archivedBody')}
        </Notice>
      ) : !canWrite ? (
        <Notice tone="info">{t('readOnly')}</Notice>
      ) : null}
      {shared && !archived ? <Notice tone="info" title={t('sharedTitle')}>{sharedText}</Notice> : null}
      {notice ? (
        <Notice tone="error" onDismiss={() => setNotice(null)} dismissLabel={t('dismiss')}>
          {notice}
        </Notice>
      ) : null}

      <div className={page ? 'grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]' : 'space-y-5'}>
        <div className="min-w-0 space-y-5">
          <Panel as="section" aria-labelledby="faq-about" className="space-y-4">
            <h2 id="faq-about" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
              {t('aboutTitle')}
            </h2>
            <Field label={t('name')} hint={t('nameHint')}>
              {(p) => (
                <TextInput
                  {...p}
                  value={name}
                  readOnly={!editable}
                  maxLength={FAQ_UI_LIMITS.name}
                  onChange={(e) => {
                    setName(e.target.value)
                    save({ internalName: e.target.value })
                  }}
                />
              )}
            </Field>
            <Field label={t('publicTitle', { language: languageName(lang) })} hint={t('publicTitleHint')}>
              {(p) => (
                <TextInput
                  {...p}
                  value={title[lang] ?? ''}
                  readOnly={!editable}
                  maxLength={FAQ_UI_LIMITS.title}
                  placeholder={lang !== d ? title[d] || undefined : undefined}
                  onChange={(e) => {
                    const v = e.target.value
                    setTitle((x) => ({ ...x, [lang]: v }))
                    save({ [`title.${lang}`]: v })
                  }}
                />
              )}
            </Field>
            <Field label={t('note')} hint={t('noteHint')}>
              {(p) => (
                <TextArea
                  {...p}
                  rows={2}
                  value={note}
                  readOnly={!editable}
                  maxLength={FAQ_UI_LIMITS.note}
                  onChange={(e) => {
                    setNote(e.target.value)
                    save({ note: e.target.value })
                  }}
                />
              )}
            </Field>
          </Panel>

          <section aria-labelledby="faq-questions" className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="faq-questions" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
                  {t('questionsTitle')} <span className="font-normal text-muted-foreground tabular-nums">· {items.length}</span>
                </h2>
                <p className="text-sm leading-5 text-muted-foreground">{t('questionsHint')}</p>
              </div>
              {languages.length > 1 ? (
                <SegmentedControl
                  label={t('language')}
                  appearance="soft"
                  value={lang}
                  onChange={setLang}
                  options={languages.map((l) => {
                    const missing = items.some((e) => !isTranslated(e, l))
                    return { value: l, label: missing ? t('languageMissing', { language: l.toUpperCase() }) : l.toUpperCase() }
                  })}
                />
              ) : null}
            </div>

            {items.length === 0 ? (
              <EmptyState
                titleAs="p"
                title={t('noQuestions')}
                body={editable ? t('noQuestionsBody') : undefined}
                action={
                  editable ? (
                    <Button variant="primary" onClick={addQuestion}>
                      {FAQ_ICONS.plus}
                      {t('addFirst')}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ol ref={listRef} className="flex flex-col gap-4" aria-label={t('questionsTitle')}>
                {items.map((entry, n) => (
                  <FaqQuestionCard
                    key={entry._key}
                    entry={entry}
                    index={n}
                    total={items.length}
                    locale={lang}
                    defaultLocale={d}
                    languageName={languageName}
                    readOnly={!editable}
                    links={links}
                    generation={generation}
                    drag={drag.gripProps(entry._key)}
                    edge={drag.edge(entry._key)}
                    dragging={drag.dragging === entry._key}
                    rowProps={drag.rowProps(entry._key)}
                    onQuestion={(value) => patchItem(entry._key, (e) => ({ ...e, question: { ...e.question, [lang]: value } }))}
                    onAnswer={(value: PortableTextBlock[]) => patchItem(entry._key, (e) => ({ ...e, answer: { ...e.answer, [lang]: value } }))}
                    onRemove={() => removeQuestion(entry._key)}
                    onMove={(dir) => saveItems(moveIndex(itemsRef.current, n, n + dir))}
                  />
                ))}
              </ol>
            )}

            {editable && items.length > 0 ? (
              <div className="flex flex-col items-start gap-1">
                <Button onClick={addQuestion} disabled={full} aria-describedby={full ? 'faq-add-reason' : undefined}>
                  {FAQ_ICONS.plus}
                  {t('add')}
                </Button>
                {full ? (
                  <p id="faq-add-reason" className="text-sm leading-5 text-muted-foreground">
                    {t('full', { max: FAQ_UI_LIMITS.items })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        {usedInPanel}
      </div>

      <ConfirmDialog
        open={confirm === 'publish' || confirm === 'discard' || confirm === 'delete'}
        title={confirm === 'publish' ? t('confirm.publishTitle') : confirm === 'discard' ? t('confirm.discardTitle') : t('confirm.deleteTitle', { name: displayName })}
        body={confirm === 'publish' ? sharedText : confirm === 'discard' ? t('confirm.discardBody') : t('confirm.deleteBody')}
        confirmLabel={confirm === 'publish' ? t('publish') : confirm === 'discard' ? t('confirm.discard') : tl('actions.delete')}
        busy={busy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onCancel={() => {
          setConfirm(null)
          setConfirmError(null)
        }}
      />
      <DeletePermanentlyDialog
        open={confirm === 'deletePermanently'}
        titles={[displayName]}
        busy={busy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onCancel={() => {
          setConfirm(null)
          setConfirmError(null)
        }}
      />
      <FaqSetActivitySheet open={activity} onClose={() => setActivity(false)} projectSlug={projectSlug} setId={id} />
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t('undo') : undefined} onAction={toast?.undo} />
    </div>
  )
}
