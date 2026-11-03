'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { PersonSnapshot, PersonState, PersonUsage } from '@/lib/api/persons'
import {
  anonymisePersonAction,
  discardPersonDraftAction,
  getPersonAction,
  movePersonContactAction,
  openPersonForEditAction,
  personLifecycleAction,
  publishPersonDraftAction,
  savePersonDraftAction,
  savePersonPrivateAction,
  searchPersonLinkTargetsAction,
} from '@/app/[locale]/(client)/[tenant]/people/actions'
import { useAutosave } from '@/lib/client/autosave/use-autosave'
import type { PendingSet } from '@/lib/client/autosave/journal'
import { contactsSignature, publishBlockers, savableContacts, type ContactRow } from '@/lib/client/person-editor'
import { siteHostsForProject } from '@/lib/links/link-target'
import type { LinkTools } from '@/components/client/editor/BodyEditor'
import type { PickerTerm } from '@/components/client/taxonomy/term-picker-model'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { SaveNotice } from '@/components/app/ui/SaveNotice'
import { SavePill } from '@/components/app/ui/SavePill'
import { Tabs, tabPanelProps } from '@/components/app/ui/Tabs'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { PersonAnonymiseDialog } from './PersonAnonymiseDialog'
import { AboutTab, ContactTab, ProfileTab, WebsiteTab } from './PersonEditorTabs'
import { PersonStateBadge, UsedInList, useLanguageName, useUsageSummary } from './person-bits'
import { EDITOR_TABS, type EditorApi, type EditorTab, type PersonValues, type PrivateUi } from './person-editor-types'

function valuesOf(s: PersonSnapshot): PersonValues {
  return {
    firstName: s.firstName,
    lastName: s.lastName,
    displayName: s.displayName,
    honorific: s.honorific,
    jobTitle: s.jobTitle,
    shortBio: s.shortBio,
    slug: s.slug,
    bio: s.bio,
    groups: s.groups,
    photo: s.photo,
    languages: s.languages,
    website: s.website,
    qualifications: s.qualifications,
    visibility: s.visibility,
    contacts: s.contacts.map((c): ContactRow => ({ _key: c._key, kind: c.kind, value: c.value, label: c.label, preferred: c.preferred, visibility: c.visibility })),
  }
}

type Confirm = 'discard' | 'delete' | 'deletePermanently' | 'anonymise' | null

/**
 * The person editor (ADR-043 D8) — one page, four tabs, autosaved to the draft
 * (platform rule: incomplete drafts always save; there is no Save button).
 *
 *   Profile       photo · names · honorific and job title per language · groups · short bio (+ Shorten)
 *   About         long bio (restricted rich text, as FAQ answers) · languages spoken · qualifications
 *   Contact       public and private contact methods (move between them) · website · birthday · notes
 *   On the website  hidden / team list / own page, and the page address per language
 *
 * "Used in" (pages, posts, events and schedules showing the person) sits beside
 * the tabs. Publish · Discard changes · Archive / Restore (Owner) · Anonymise
 * (Owner) · Delete (Owner, only when nothing shows the person) are in the page's
 * header and ⋯ menu.
 *
 * The public profile goes through the draft (savePersonDraft); private contacts,
 * birthday and notes are saved directly to Supabase (savePersonPrivate) a moment
 * after typing, and a contact moved between public and private goes through
 * movePersonContact. The first edit of a published person opens its draft (from
 * the browser — never on GET). Archived people are read-only until restored;
 * anonymised people cannot be edited at all.
 */
export function PersonEditor({
  projectSlug,
  initial,
  groupTerms,
  canWrite = true,
  canArchive = false,
  canDelete = false,
  canAnonymise = false,
  canAddGroup = false,
}: {
  projectSlug: string
  initial: PersonSnapshot
  groupTerms: PickerTerm[]
  /** people.person.write (the server re-checks). Without it the editor is read-only. */
  canWrite?: boolean
  canArchive?: boolean
  canDelete?: boolean
  canAnonymise?: boolean
  canAddGroup?: boolean
}) {
  const t = useTranslations('clientDashboard.persons.editor')
  const te = useTranslations('clientDashboard.persons.errors')
  const tl = useTranslations('app.lifecycle')
  const ta = useTranslations('clientDashboard.persons.anonymise')
  const router = useRouter()
  const languageName = useLanguageName()
  const summarize = useUsageSummary()
  const idBase = useId()
  const id = initial.id
  const listHref = `/${projectSlug}/people`

  const languages = initial.site.languages.length ? initial.site.languages : [initial.site.defaultLocale]
  const d = initial.site.defaultLocale || languages[0]

  // ── State ──────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<{ state: PersonState; hasDraft: boolean; isPublished: boolean; usedIn: PersonUsage[]; anonymised: boolean }>({
    state: initial.state,
    hasDraft: initial.hasDraft,
    isPublished: initial.isPublished,
    usedIn: initial.usedIn,
    anonymised: Boolean(initial.anonymisedAt),
  })
  const [values, setValues] = useState<PersonValues>(() => valuesOf(initial))
  const valuesRef = useRef(values)
  const [tab, setTab] = useState<EditorTab>('profile')
  const [lang, setLang] = useState(d)
  const [generation, setGeneration] = useState(0)
  /** A server draft exists (decides whether the next save must open one first). */
  const hasDraftRef = useRef(initial.hasDraft)

  const archived = status.state === 'archived'
  const editable = canWrite && !archived && !status.anonymised

  // Private details (Supabase).
  const privAvailable = initial.private.available
  const [priv, setPriv] = useState<PrivateUi>({
    available: privAvailable,
    birthday: initial.private.available ? (initial.private.birthday ?? '') : '',
    notes: initial.private.available ? initial.private.notes : '',
    state: 'idle',
  })
  const privVersion = useRef<number | null>(initial.private.available ? initial.private.version : null)
  const privPending = useRef<{ birthday?: string | null; notes?: string; contacts?: unknown }>({})
  const privTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const privChain = useRef<Promise<boolean>>(Promise.resolve(true))
  const lastPub = useRef(contactsSignature(savableContacts(values.contacts, 'public')))
  const lastPriv = useRef(contactsSignature(savableContacts(values.contacts, 'private')))

  const links = useMemo<LinkTools | undefined>(() => {
    if (!editable) return undefined
    const call = async (input: { query?: string; ids?: string[] }) => {
      const res = await searchPersonLinkTargetsAction({ projectSlug, locale: lang, ...input })
      return res.ok ? res.results : null
    }
    return { siteHosts: siteHostsForProject(projectSlug), searchPages: (query) => call({ query }), describePages: (ids) => call({ ids }) }
  }, [projectSlug, lang, editable])

  const apply = useCallback((s: PersonSnapshot) => {
    hasDraftRef.current = s.hasDraft
    setStatus({ state: s.state, hasDraft: s.hasDraft, isPublished: s.isPublished, usedIn: s.usedIn, anonymised: Boolean(s.anonymisedAt) })
    const next = valuesOf(s)
    valuesRef.current = next
    setValues(next)
    lastPub.current = contactsSignature(savableContacts(next.contacts, 'public'))
    lastPriv.current = contactsSignature(savableContacts(next.contacts, 'private'))
    if (s.private.available) {
      privVersion.current = s.private.version
      setPriv((p) => ({ ...p, birthday: s.private.available ? (s.private.birthday ?? '') : '', notes: s.private.available ? s.private.notes : '' }))
    }
    setGeneration((g) => g + 1)
  }, [])

  // ── Autosave (public profile → draft) ──────────────────────────────────────
  const send = useCallback(
    async (input: { rev: string; set: PendingSet }) => {
      let rev = input.rev
      if (!hasDraftRef.current || !rev) {
        // A published person: the first change opens the draft (an exact copy).
        const opened = await openPersonForEditAction({ projectSlug, id })
        if (!opened.ok) return { ok: false, error: opened.error } as const
        rev = opened.rev
        hasDraftRef.current = true
      }
      const r = await savePersonDraftAction({ projectSlug, id, rev, set: input.set })
      return r.ok ? ({ ok: true, rev: r.rev } as const) : ({ ok: false, error: r.error } as const)
    },
    [projectSlug, id]
  )
  /** Set once useAutosave exists (below): a reload must hand the server's revision to the engine. */
  const adoptRevRef = useRef<(rev: string) => void>(() => {})
  const reload = useCallback(async () => {
    const r = await getPersonAction({ projectSlug, id })
    if (r.ok) {
      apply(r.person)
      // Archive / restore / discard change the draft's revision: without this
      // the next autosave would be refused as "edited elsewhere".
      if (r.person.rev) adoptRevRef.current(r.person.rev)
    }
    return r.ok
  }, [projectSlug, id, apply])
  /** A tab closed mid-save is replayed by the engine; once it lands, show what the server now holds. */
  const [replayed, setReplayed] = useState(false)
  const onReady = useCallback((r: PendingSet | null) => {
    if (r && Object.keys(r).length) setReplayed(true)
  }, [])
  const autosave = useAutosave({ draftId: `person:${id}`, rev: initial.rev, send, onReady })
  const adoptRev = autosave.adoptRev
  useEffect(() => {
    adoptRevRef.current = adoptRev
  }, [adoptRev])
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

  /** Every public change goes through here: shown at once, autosaved after a pause. */
  const save = (set: PendingSet) => {
    if (!editable) return
    setStatus((s) => (s.hasDraft ? s : { ...s, hasDraft: true, state: s.isPublished ? 'changes' : 'draft' }))
    autosave.set(set)
  }

  // ── Private details: saved directly, a moment after typing ─────────────────
  const [notice, setNotice] = useState<string | null>(null)
  const errorText = (code: string, usedIn?: PersonUsage[]) =>
    code === 'in_use' && usedIn?.length ? te('in_use_where', { places: summarize(usedIn) }) : te.has(code) ? te(code) : te('failed')

  const flushPrivate = useCallback((): Promise<boolean> => {
    if (privTimer.current) clearTimeout(privTimer.current)
    privTimer.current = null
    privChain.current = privChain.current.then(async () => {
      const patch = privPending.current
      if (!Object.keys(patch).length) return true
      privPending.current = {}
      try {
        const r = await savePersonPrivateAction({ projectSlug, id, version: privVersion.current, ...patch })
        if (!r.ok) {
          privPending.current = { ...patch, ...privPending.current }
          setPriv((p) => ({ ...p, state: 'error' }))
          setNotice(errorText(r.error))
          return false
        }
        privVersion.current = r.version
        setPriv((p) => ({ ...p, state: Object.keys(privPending.current).length ? 'saving' : 'saved' }))
        return true
      } catch {
        privPending.current = { ...patch, ...privPending.current }
        setPriv((p) => ({ ...p, state: 'error' }))
        setNotice(te('failed'))
        return false
      }
    })
    return privChain.current
    // errorText only reads translations
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug, id])
  const queuePrivate = (patch: { birthday?: string | null; notes?: string; contacts?: unknown }) => {
    if (!editable || !privAvailable) return
    privPending.current = { ...privPending.current, ...patch }
    setPriv((p) => ({ ...p, state: 'saving' }))
    if (privTimer.current) clearTimeout(privTimer.current)
    privTimer.current = setTimeout(() => void flushPrivate(), 800)
  }
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void flushPrivate()
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onHidden)
      void flushPrivate()
    }
  }, [flushPrivate])

  // ── Changes from the tabs ──────────────────────────────────────────────────
  const { toast, show } = useUndo()
  const change = (patch: Partial<PersonValues>, set?: PendingSet) => {
    if (!editable) return
    const next = { ...valuesRef.current, ...patch }
    valuesRef.current = next
    setValues(next)
    if (set) save(set)
  }
  /** Each side of the contact list is saved on its own path, and only when what it would save has changed. */
  const syncContacts = (rows: ContactRow[]) => {
    const pub = savableContacts(rows, 'public')
    const sigPub = contactsSignature(pub)
    if (sigPub !== lastPub.current) {
      lastPub.current = sigPub
      save({ contacts: pub })
    }
    if (privAvailable) {
      const priv2 = savableContacts(rows, 'private')
      const sigPriv = contactsSignature(priv2)
      if (sigPriv !== lastPriv.current) {
        lastPriv.current = sigPriv
        queuePrivate({ contacts: priv2 })
      }
    }
  }
  const changeContacts = (rows: ContactRow[]) => {
    if (!editable) return
    const previous = valuesRef.current.contacts
    const next = { ...valuesRef.current, contacts: rows }
    valuesRef.current = next
    setValues(next)
    syncContacts(rows)
    const removed = previous.filter((c) => !rows.some((r) => r._key === c._key) && c.value.trim())
    if (removed.length === 1 && rows.length === previous.length - 1) {
      const gone = removed[0]
      show(
        {
          message: t('contact.removed', { value: gone.value }),
          tone: 'status',
          undo: () => {
            changeContacts(previous)
            show(null)
          },
        },
        8000
      )
    }
  }

  const [moving, setMoving] = useState(false)
  async function moveContact(key: string, to: 'public' | 'private') {
    if (moving || !editable) return
    setMoving(true)
    setNotice(null)
    try {
      if (!(await flushed())) return
      if (!(await flushPrivate())) return
      if (to === 'public' && !hasDraftRef.current) {
        const opened = await openPersonForEditAction({ projectSlug, id })
        if (!opened.ok) return setNotice(errorText(opened.error))
        hasDraftRef.current = true
        autosave.adoptRev(opened.rev)
      }
      const r = await movePersonContactAction({ projectSlug, id, rev: autosave.currentRev(), key, to, privateVersion: privVersion.current })
      if (!r.ok) return setNotice(errorText(r.error))
      if (r.rev) autosave.adoptRev(r.rev)
      privVersion.current = r.privateVersion
      const rows = valuesRef.current.contacts.map((c) => (c._key === key ? { ...c, visibility: to } : c))
      valuesRef.current = { ...valuesRef.current, contacts: rows }
      setValues(valuesRef.current)
      lastPub.current = contactsSignature(savableContacts(rows, 'public'))
      lastPriv.current = contactsSignature(savableContacts(rows, 'private'))
      if (to === 'public') setStatus((s) => ({ ...s, hasDraft: true, state: s.isPublished ? 'changes' : 'draft' }))
      show({ message: to === 'public' ? t('contact.movedPublic') : t('contact.movedPrivate'), tone: 'status' })
    } catch {
      setNotice(te('failed'))
    } finally {
      setMoving(false)
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  /** Everything typed is on the server (or say why not). */
  const flushed = async (): Promise<boolean> => {
    if (await autosave.flush()) return true
    setNotice(te(autosave.currentState() === 'conflict' ? 'conflict' : 'offline'))
    return false
  }

  const displayName = status.anonymised ? t('anonymisedName') : (values.displayName.trim() || `${values.firstName} ${values.lastName}`.trim()) || t('untitled')
  const blockers = publishBlockers({ visibility: values.visibility, slug: values.slug, defaultLocale: d, firstName: values.firstName, lastName: values.lastName })
  const publishReason = !editable ? null : !status.hasDraft ? t('publishReason.upToDate') : null
  const goToBlocker = (b: (typeof blockers)[number]) => {
    setTab('website')
    setLang(b.locale)
    requestAnimationFrame(() => document.getElementById('person-slug')?.focus())
  }

  async function publish() {
    if (busy || publishReason || blockers.length) return
    setBusy(true)
    setPublishing(true)
    setNotice(null)
    try {
      if (!(await flushed())) return
      if (!(await flushPrivate())) return
      const r = await publishPersonDraftAction({ projectSlug, id, rev: autosave.currentRev() })
      if (!r.ok) {
        if (r.error === 'missing_slug') setTab('website')
        return setNotice(errorText(r.error, r.detail?.usedIn))
      }
      hasDraftRef.current = false
      await autosave.discard()
      setStatus((s) => ({ ...s, hasDraft: false, isPublished: true, state: 'published' }))
      show({ message: status.usedIn.length ? t('publishedUsed', { count: status.usedIn.length }) : t('published'), tone: 'status' })
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
    setBusy(true)
    setConfirmError(null)
    try {
      if (confirm === 'discard') {
        await autosave.flush()
        const r = await discardPersonDraftAction({ projectSlug, id, rev: autosave.currentRev() })
        if (!r.ok) return setConfirmError(errorText(r.error))
        await autosave.discard()
        await reload()
        setConfirm(null)
        show({ message: t('discarded'), tone: 'status' })
        return
      }
      if (confirm === 'anonymise') {
        await flushPrivate()
        const r = await anonymisePersonAction({ projectSlug, id })
        if (!r.ok) return setConfirmError(errorText(r.error))
        await autosave.discard()
        await reload()
        setConfirm(null)
        show({ message: ta('done', { name: displayName }), tone: 'status' })
        router.refresh()
        return
      }
      const op = confirm === 'delete' ? 'deleteDraft' : 'deletePermanently'
      const r = await personLifecycleAction({ projectSlug, id, op })
      if (!r.ok) return setConfirmError(errorText(r.error, r.detail?.usedIn))
      await autosave.discard()
      setConfirm(null)
      router.push(listHref)
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
      const r = await personLifecycleAction({ projectSlug, id, op })
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

  const lifecycleItems: CardMenuItem[] = []
  if (canArchive && !status.anonymised) {
    // eslint-disable-next-line react-hooks/refs -- the handler runs on click, not during render
    if (archived) lifecycleItems.push({ key: 'restore', label: tl('actions.restore'), onSelect: () => void lifecycle('restore') })
    // eslint-disable-next-line react-hooks/refs -- the handler runs on click, not during render
    else if (status.isPublished) lifecycleItems.push({ key: 'archive', label: tl('actions.archive'), onSelect: () => void lifecycle('archive') })
  }
  if (canAnonymise && !status.anonymised) lifecycleItems.push({ key: 'anonymise', label: t('menu.anonymise'), onSelect: () => setConfirm('anonymise'), separated: true })
  if (canDelete) {
    if (archived || status.anonymised) lifecycleItems.push({ key: 'deletePermanently', label: tl('actions.deletePermanently'), onSelect: () => setConfirm('deletePermanently'), destructive: true, separated: !canAnonymise || status.anonymised })
    else if (!status.isPublished) lifecycleItems.push({ key: 'delete', label: tl('actions.delete'), onSelect: () => setConfirm('delete'), destructive: true, separated: !canAnonymise })
  }
  const menu: CardMenuItem[] = [
    ...(editable && status.isPublished && status.hasDraft ? [{ key: 'discard', label: t('menu.discard'), onSelect: () => setConfirm('discard') }] : []),
    ...lifecycleItems,
  ]

  // ── Render ─────────────────────────────────────────────────────────────────
  const publishButton = editable ? (
    <Button
      variant="primary"
      disabled={busy || !!publishReason || blockers.length > 0}
      aria-describedby={publishReason || blockers.length ? 'person-publish-reason' : undefined}
      onClick={() => void publish()}
    >
      {publishing ? t('publishing') : t('publish')}
    </Button>
  ) : null

  const api: EditorApi & { setLang: (l: string) => void } = {
    projectSlug,
    languages,
    d,
    lang,
    setLang,
    languageName,
    editable,
    values,
    generation,
    change,
    links,
    groupTerms,
    canAddGroup,
    priv,
    setBirthday: (birthday) => {
      setPriv((p) => ({ ...p, birthday }))
      queuePrivate({ birthday: birthday || null })
    },
    setNotes: (notes) => {
      setPriv((p) => ({ ...p, notes }))
      queuePrivate({ notes })
    },
    changeContacts,
    moveContact: (key, to) => void moveContact(key, to),
    moving,
    setTab,
    showToast: (message, tone = 'status') => show({ message, tone }),
  }

  const tabItems = EDITOR_TABS.map((x) => ({ id: x, label: t(`tabs.${x}`) }))

  return (
    <div className="space-y-5">
      <BackLink href={listHref} label={t('back')} />
      <div className="-mt-3">
        <PageHeader
          title={displayName}
          actions={
            <>
              {editable ? <SavePill state={autosave.state} onReload={() => window.location.reload()} /> : null}
              {publishButton}
              {menu.length ? <CardMenu label={t('menu.label')} items={menu} /> : null}
            </>
          }
        />
      </div>

      <div className="flex flex-col items-start gap-2">
        <PersonStateBadge state={status.state} />
        {editable && (publishReason || blockers.length) ? (
          <div id="person-publish-reason" className="text-sm leading-5 text-muted-foreground">
            {blockers.length ? (
              <p className="flex flex-wrap items-center gap-x-1">
                <span>{t('publishBlocked')}</span>
                {blockers.map((b) => (
                  <Button key={b.id} variant="link" className="text-sm" onClick={() => goToBlocker(b)}>
                    {t('blockers.slug', { language: languageName(b.locale) })}
                  </Button>
                ))}
              </p>
            ) : (
              <p>{publishReason}</p>
            )}
          </div>
        ) : null}
      </div>

      {editable ? (
        <SaveNotice state={autosave.state} rejected={autosave.rejected.map(() => 'other')} onRetry={autosave.retry} onReload={() => window.location.reload()} />
      ) : null}
      {status.anonymised ? (
        <Notice tone="info" title={t('anonymisedTitle')}>
          {t('anonymisedBody')}
        </Notice>
      ) : archived ? (
        <Notice
          tone="info"
          title={t('archivedTitle')}
          action={canArchive ? <Button onClick={() => void lifecycle('restore')}>{tl('actions.restore')}</Button> : undefined}
        >
          {t('archivedBody')}
        </Notice>
      ) : !canWrite ? (
        <Notice tone="info">{t('readOnly')}</Notice>
      ) : null}
      {notice ? (
        <Notice tone="error" onDismiss={() => setNotice(null)} dismissLabel={t('dismiss')}>
          {notice}
        </Notice>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <Tabs label={t('tabsLabel')} idBase={idBase} items={tabItems} value={tab} onChange={(x) => setTab(x as EditorTab)} />
          <div {...tabPanelProps(idBase, tab)}>
            {tab === 'profile' ? <ProfileTab api={api} /> : null}
            {tab === 'about' ? <AboutTab api={api} /> : null}
            {tab === 'contact' ? <ContactTab api={api} /> : null}
            {tab === 'website' ? <WebsiteTab api={api} /> : null}
          </div>
        </div>

        <Panel as="section" aria-labelledby="person-used-in" className="space-y-3">
          <h2 id="person-used-in" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
            {t('usedInTitle')} <span className="font-normal text-muted-foreground tabular-nums">· {status.usedIn.length}</span>
          </h2>
          <UsedInList usedIn={status.usedIn} projectSlug={projectSlug} />
        </Panel>
      </div>

      <ConfirmDialog
        open={confirm === 'discard' || confirm === 'delete'}
        title={confirm === 'discard' ? t('confirm.discardTitle') : t('confirm.deleteTitle', { name: displayName })}
        body={confirm === 'discard' ? t('confirm.discardBody') : t('confirm.deleteBody')}
        confirmLabel={confirm === 'discard' ? t('confirm.discard') : tl('actions.delete')}
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
      <PersonAnonymiseDialog
        open={confirm === 'anonymise'}
        name={displayName}
        busy={busy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onCancel={() => {
          setConfirm(null)
          setConfirmError(null)
        }}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t('undo') : undefined} onAction={toast?.undo} />
    </div>
  )
}
