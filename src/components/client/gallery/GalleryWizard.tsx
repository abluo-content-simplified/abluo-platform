'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  createGalleryAction,
  deleteGalleryAction,
  discardGalleryDraftAction,
  getGalleryAction,
  openGalleryForEditAction,
  patchGalleryDraftAction,
  publishGalleryDraftAction,
} from '@/app/[locale]/(client)/[tenant]/galleries/actions'
import type { GalleryPhoto, GallerySnapshot } from '@/lib/api/gallery-drafts'
import { useAutosave } from '@/lib/client/autosave/use-autosave'
import type { PendingSet } from '@/lib/client/autosave/journal'
import { GALLERY_CONTENT, routePreDraft } from '@/lib/client/lazy-draft'
import { appendPhotos, applyPhotoSaved, itemsPatch, usagePages, usagePlaces } from '@/lib/client/gallery-editor'
import {
  canAdvanceGallery,
  canSaveGallery,
  clampIndex,
  firstUndescribed,
  galleryStartStep,
  galleryWizardSteps,
  type GallerySection,
  type GalleryWizardStep,
} from '@/lib/client/gallery-wizard'
import type { GalleryStatus } from '@/lib/api/gallery-status'
import { WizardFrame } from '@/components/client/create/WizardFrame'
import { ConfirmDialog } from '@/components/client/create/ConfirmDialog'
import type { LanguageChoice } from '@/components/client/create/steps/LanguagesStep'
import { PhotoAddStep, type AddedPhoto } from './wizard/PhotoAddStep'
import { PhotoDescribeStep, type DescribeChange } from './wizard/PhotoDescribeStep'
import {
  GalleryDoneStep,
  GalleryLanguagesStep,
  GalleryPreviewStep,
  GalleryReviewStep,
  NameStep,
  type GallerySite,
  type GalleryTexts,
} from './GallerySteps'

const SAVE_ERRORS = ['empty', 'conflict', 'offline', 'forbidden', 'failed']
/** After new photos are saved, fetch their full facts (revision, title, caption) once things settle. */
const REFRESH_AFTER_ADD_MS = 1500
/** Server limit: photos per gallery. */
const MAX_PHOTOS = 200
type Confirm = 'discard' | 'delete'

/**
 * The gallery wizard (Tom, gallery redo) — the blog wizard's flow on a
 * gallery, in the same WizardFrame: Name → Add photos → Describe photos (one
 * at a time) → Languages (multilingual sites) → Preview → Save → Done. An
 * existing gallery opens on the overview ("review") with Save.
 *
 * Lazy creation: "+ Add content" / "New gallery" open it with no document;
 * the first title or photo creates the draft (createGallery), then the URL
 * becomes /galleries/<id> without a reload. Until then the top-left is a
 * plain Close that leaves nothing behind.
 *
 * Photos: the list lives in a ref and every change sends the WHOLE latest
 * list through the one autosave engine (single request in flight, latest
 * value wins), so eight uploads finishing together stay eight. Photo texts
 * are saved on the Media Library asset by PhotoDescribeStep; Save waits for them.
 *
 * Routes (2026-10-07): `/galleries/new` (lazy creation; the URL becomes
 * `/galleries/<id>/edit`) and `/galleries/<id>/edit` (an existing gallery,
 * on its overview). The gallery's own page (`/galleries/<id>`) is the hub:
 * it opens one part directly (`initialSection`, optionally on one photo), and
 * "Done" / "Save & exit" bring you back to it (`exitHref`).
 */
export function GalleryWizard({
  projectSlug,
  initial,
  listHref,
  canDelete,
  status = null,
  exitHref,
  initialSection,
  initialPhotoKey,
}: {
  projectSlug: string
  /** The gallery as getGalleryDraft returns it; `id: ''` for a new one (nothing created yet). */
  initial: GallerySnapshot
  listHref: string
  /** Owner holding gallery delete (the server re-checks). */
  canDelete: boolean
  /** Where the gallery is used and what needs attention (overview, existing galleries only). */
  status?: GalleryStatus | null
  /** Where "Save & exit" / Close go (default `listHref`), e.g. the gallery's own page. */
  exitHref?: string
  /** Open one part of an existing gallery directly; "Done" then returns to `exitHref`. */
  initialSection?: GallerySection['id']
  /** With `initialSection: 'describe'`: the photo (item key) to open on. */
  initialPhotoKey?: string
}) {
  const t = useTranslations('clientDashboard.gallery.wizard')
  const tg = useTranslations('clientDashboard.gallery')
  const tc = useTranslations('clientDashboard.create')
  const router = useRouter()
  const d = initial.site.defaultLocale
  const site: GallerySite = useMemo(
    () => ({ projectSlug, defaultLocale: d, languages: initial.site.locales }),
    [projectSlug, d, initial.site.locales]
  )
  const steps = useMemo(() => galleryWizardSteps(site), [site])
  const isNew = !initial.live

  const [texts, setTexts] = useState<GalleryTexts>({ title: initial.title, description: initial.description })
  const [tags, setTags] = useState<string[]>(initial.tags)
  const [items, setItems] = useState<GalleryPhoto[]>(initial.items)
  const itemsRef = useRef<GalleryPhoto[]>(initial.items)
  /** Opened on one part from the gallery's page: "Done" goes back there instead of to the overview. */
  const direct = Boolean(initial.id && initialSection && (steps as string[]).includes(initialSection))
  const [step, setStep] = useState<GalleryWizardStep>(direct ? initialSection! : galleryStartStep(!initial.id))
  const [editing, setEditing] = useState(direct)
  const [describeAt, setDescribeAt] = useState(() => {
    if (!direct || initialSection !== 'describe') return 0
    const at = initialPhotoKey ? initial.items.findIndex((i) => i.key === initialPhotoKey) : -1
    return at >= 0 ? at : Math.max(0, firstUndescribed(initial.items, d))
  })
  const [choices, setChoices] = useState<Record<string, LanguageChoice>>(() =>
    Object.fromEntries(site.languages.filter((l) => l !== d).map((l) => [l, initial.title[l]?.trim() || initial.description[l]?.trim() ? 'write' : 'later']))
  )
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null)
  const pages = usagePages(initial.usedIn)
  const [pageId, setPageId] = useState<string | null>(pages[0]?.id ?? null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'status' | 'error'; text: string } | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const finished = useRef(false)

  /** The gallery's id; '' until the first title or photo creates it (lazy creation). */
  const idRef = useRef(initial.id)
  const [galleryId, setGalleryId] = useState(initial.id)
  const created = Boolean(galleryId)
  const hasDraftRef = useRef(initial.hasDraft)
  const [hasDraft, setHasDraft] = useState(initial.hasDraft)
  const heldRef = useRef<PendingSet>({})
  /** True once the first content went to the engine: from then on nothing is held (the engine creates the gallery). */
  const contentSentRef = useRef(Boolean(initial.id))
  const rekeyRef = useRef<(key: string) => Promise<void>>(async () => undefined)
  /** Starts temporary for a new gallery; moved to `gallery:<id>` (rekey) once it is created. */
  const [journalKey] = useState(() => (initial.id ? `gallery:${initial.id}` : `new-gallery:${Math.random().toString(36).slice(2)}`))
  /** Photo-text saves in flight (PhotoDescribeStep): Save waits for them. */
  const photoSaves = useRef<Promise<unknown>>(Promise.resolve())

  const markDraft = () => {
    hasDraftRef.current = true
    setHasDraft(true)
  }

  const send = useCallback(
    async (input: { rev: string; set: PendingSet }) => {
      let rev = input.rev
      if (!idRef.current) {
        // Lazy creation: the first content creates the gallery (with its title, when there is one).
        const first = input.set[`title.${d}`]
        const c = await createGalleryAction({ projectSlug, title: typeof first === 'string' ? first.trim().slice(0, 120) : undefined })
        if (!c.ok) return { ok: false, error: c.error === 'forbidden' || c.error === 'unauthenticated' ? c.error : 'failed' } as const
        idRef.current = c.id
        rev = c.rev
        // Move the journal from the temporary key to the real one, before the first patch.
        await rekeyRef.current(`gallery:${c.id}`)
        setGalleryId(c.id)
        markDraft()
        try {
          window.history.replaceState(window.history.state, '', window.location.pathname.replace(/\/new\/?$/, `/${c.id}/edit`) + window.location.search)
        } catch {
          /* ignore */
        }
      } else if (!hasDraftRef.current || !rev) {
        // A published gallery: the first change opens its draft (an exact copy).
        const opened = await openGalleryForEditAction({ projectSlug, id: idRef.current })
        if (!opened.ok) return { ok: false, error: opened.error } as const
        const fresh = await getGalleryAction({ projectSlug, id: idRef.current })
        if (!fresh.ok || !fresh.gallery.rev) return { ok: false, error: fresh.ok ? 'failed' : fresh.error } as const
        rev = fresh.gallery.rev
        markDraft()
      }
      const r = await patchGalleryDraftAction({ projectSlug, id: idRef.current, rev, set: input.set })
      return r.ok ? ({ ok: true, rev: r.rev } as const) : ({ ok: false, error: r.error } as const)
    },
    [projectSlug, d]
  )

  /** A tab closed mid-save is replayed by the engine; once it lands, show what the server now holds. */
  const [replayed, setReplayed] = useState(false)
  const onReady = useCallback((r: PendingSet | null) => {
    if (r && idRef.current) setReplayed(true)
  }, [])
  const autosave = useAutosave({ draftId: journalKey, rev: initial.rev, send, onReady })
  const { rekey } = autosave
  useEffect(() => {
    rekeyRef.current = rekey
  }, [rekey])
  const flushEngine = autosave.flush
  useEffect(() => {
    if (!replayed) return
    let live = true
    void (async () => {
      if (!(await flushEngine()) || !live) return
      const fresh = await getGalleryAction({ projectSlug, id: idRef.current })
      if (!fresh.ok || !live) return
      setTexts({ title: fresh.gallery.title, description: fresh.gallery.description })
      setTags(fresh.gallery.tags)
      itemsRef.current = fresh.gallery.items
      setItems(fresh.gallery.items)
      if (fresh.gallery.hasDraft) {
        hasDraftRef.current = true
        setHasDraft(true)
      }
    })()
    return () => {
      live = false
    }
  }, [replayed, flushEngine, projectSlug])

  /** Every change goes through here: held until the first content exists, then autosaved. */
  const update = useCallback(
    (set: PendingSet) => {
      if (finished.current) return
      if (idRef.current || contentSentRef.current) {
        // Anything still held goes along — a held change is never dropped.
        const held = heldRef.current
        heldRef.current = {}
        return autosave.set({ ...held, ...set })
      }
      const routed = routePreDraft(heldRef.current, set, GALLERY_CONTENT)
      heldRef.current = routed.held
      if (routed.send) {
        contentSentRef.current = true
        autosave.set(routed.send)
      }
    },
    [autosave]
  )

  const onText = (field: 'title' | 'description', locale: string, value: string) => {
    setTexts((s) => ({ ...s, [field]: { ...s[field], [locale]: value } }))
    update({ [`${field}.${locale}`]: value })
  }

  const onTags = (next: string[]) => {
    setTags(next)
    update({ tags: next })
  }

  // ── Photos ───────────────────────────────────────────────────────────────
  const setAll = (next: GalleryPhoto[]) => {
    itemsRef.current = next
    setItems(next)
  }
  const saveItems = (next: GalleryPhoto[]) => {
    setAll(next)
    update({ items: itemsPatch(next) })
  }
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshNewPhotos = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(async () => {
      if (!(await autosave.flush()) || !idRef.current) return
      const fresh = await getGalleryAction({ projectSlug, id: idRef.current })
      if (!fresh.ok) return
      const byAsset = new Map(fresh.gallery.items.map((p) => [p.assetId, p]))
      // Only photos the wizard hasn't heard about yet (rev ''): never undo typing in progress.
      setAll(itemsRef.current.map((i) => (i.rev ? i : { ...i, ...(byAsset.get(i.assetId) ?? {}), key: i.key })))
    }, REFRESH_AFTER_ADD_MS)
  }
  /** Each finished upload (or library batch) appends to the LATEST list — never a stale copy. */
  const onAdd = (photos: AddedPhoto[]) => {
    saveItems(appendPhotos(itemsRef.current, photos))
    refreshNewPhotos()
  }
  const onPhotoChange = useCallback((change: DescribeChange) => setAll(applyPhotoSaved(itemsRef.current, change)), [])
  /** "Name and tag all" saved: new names, tags and revisions on every photo it touched. */
  const onPhotosChanged = (changes: DescribeChange[]) => setAll(changes.reduce((list, c) => applyPhotoSaved(list, c), itemsRef.current))
  const onPhotoSaving = useCallback((job: Promise<unknown>) => {
    photoSaves.current = Promise.all([photoSaves.current, job.catch(() => undefined)])
  }, [])

  // ── Navigation ───────────────────────────────────────────────────────────
  const go = useCallback((next: GalleryWizardStep, opts: { editing?: boolean } = {}) => {
    setStep(next)
    setEditing(Boolean(opts.editing))
    setNotice(null)
    mainRef.current?.scrollTo?.({ top: 0 })
  }, [])

  const index = step === 'review' || step === 'done' ? -1 : steps.indexOf(step)
  const content = { ...texts, items }
  const current = items.length ? items[clampIndex(describeAt, items.length)] : null
  const describeIndex = clampIndex(describeAt, items.length)

  const openDescribe = (at: number, opts: { editing?: boolean } = {}) => {
    setDescribeAt(at)
    go('describe', opts)
  }

  const goNext = () => {
    // Descriptions can come later (Tom, wave B): Next never stops on an undescribed photo.
    if (step === 'describe' && describeIndex < items.length - 1) {
      setDescribeAt(describeIndex + 1)
      mainRef.current?.scrollTo?.({ top: 0 })
      return
    }
    if (editing) return leaveSection()
    const next = steps[index + 1]
    if (next === 'describe') return openDescribe(Math.max(0, firstUndescribed(items, d)))
    if (next) go(next)
  }
  const goBack = () => {
    if (step === 'describe' && describeIndex > 0) {
      setDescribeAt(describeIndex - 1)
      return
    }
    if (editing) return leaveSection()
    const prev = steps[index - 1]
    if (prev === 'describe') return openDescribe(items.length - 1)
    if (prev) go(prev)
  }
  /** "Describe later": leave the remaining photos as they are and move on. */
  const skipDescribe = () => {
    if (editing) return leaveSection()
    const next = steps[steps.indexOf('describe') + 1]
    if (next) go(next)
  }
  const openSection = (section: GallerySection['id']) =>
    section === 'describe' ? openDescribe(Math.max(0, firstUndescribed(items, d)), { editing: true }) : go(section, { editing: true })

  const saveAndExit = async () => {
    await photoSaves.current
    await autosave.flush()
    router.push(exitHref ?? listHref)
  }
  /** Nothing created yet: just leave (no gallery is made). */
  const closeEmpty = () => router.push(exitHref ?? listHref)
  /** "Done" on a part opened for editing: back to the overview, or to the gallery's page when it opened that part. */
  function leaveSection() {
    if (direct) void saveAndExit()
    else go('review')
  }
  /** The preview reads the saved draft: photo texts and gallery changes first. */
  const flushAll = useCallback(async () => {
    await photoSaves.current
    return autosave.flush()
  }, [autosave])
  const reload = async () => {
    await autosave.discard()
    window.location.reload()
  }

  // ── Save (publish) ───────────────────────────────────────────────────────
  const saveError = (code: string, count = 0) => tg(`publish.errors.${SAVE_ERRORS.includes(code) ? code : 'failed'}`, { count })

  async function save() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      await photoSaves.current
      const saved = await autosave.flush()
      if (!saved) return setNotice({ kind: 'error', text: saveError(autosave.currentState() === 'conflict' ? 'conflict' : 'offline') })
      const r = await publishGalleryDraftAction({ projectSlug, id: idRef.current, rev: autosave.currentRev() })
      if (!r.ok) {
        return setNotice({ kind: 'error', text: saveError(r.error, r.detail?.assetIds?.length ?? 0) })
      }
      finished.current = true
      await autosave.discard()
      go('done')
    } catch {
      setNotice({ kind: 'error', text: saveError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'failed') })
    } finally {
      setBusy(false)
    }
  }

  async function runConfirm() {
    if (!confirm || confirmBusy) return
    setConfirmBusy(true)
    setConfirmError(null)
    try {
      if (confirm === 'discard') {
        await photoSaves.current
        await autosave.flush()
        const r = await discardGalleryDraftAction({ projectSlug, id: idRef.current, rev: autosave.currentRev() })
        if (!r.ok) return setConfirmError(tg('confirm.failed'))
        finished.current = true
        await autosave.discard()
        window.location.reload()
        return
      }
      const r = await deleteGalleryAction({ projectSlug, id: idRef.current })
      if (!r.ok) {
        const where = usagePlaces(r.detail?.usedIn)
        return setConfirmError(r.error === 'in_use' && where ? tg('confirm.inUse', { places: where }) : tg('confirm.failed'))
      }
      finished.current = true
      await autosave.discard()
      router.push(listHref)
    } catch {
      setConfirmError(tg('confirm.failed'))
    } finally {
      setConfirmBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (e.defaultPrevented || target.closest('dialog')) return
    if (e.key === 'Escape' && step !== 'done') {
      e.preventDefault()
      if (created) void saveAndExit()
      else closeEmpty()
    } else if (e.key === 'Enter' && !e.shiftKey && target.matches('[data-enter-next]') && step === 'name' && canAdvanceGallery('name', content, d)) {
      e.preventDefault()
      goNext()
    }
  }

  // ── Frame ────────────────────────────────────────────────────────────────
  const onReview = step === 'review'
  const savesHere = onReview || (step === 'preview' && !editing)
  const saveReady = canSaveGallery(content, d) && hasDraft && created
  const progressIndex = index >= 0 ? index : 0
  const showProgress = !editing && !onReview && step !== 'done'
  const primaryLabel = savesHere
    ? busy
      ? t('saving')
      : t('save')
    : editing && !(step === 'describe' && describeIndex < items.length - 1)
      ? tc('shell.done')
      : tc('shell.next')
  const canPrimary =
    !busy &&
    (savesHere ? saveReady : step === 'describe' ? items.length > 0 : step === 'name' || step === 'photos' ? canAdvanceGallery(step, content, d) : true)
  const hint = savesHere && !busy ? (!canSaveGallery(content, d) ? t('saveNeeds') : !hasDraft ? t('noChanges') : null) : null
  const hasBack = step === 'describe' ? describeIndex > 0 || (!editing && index > 0) : !onReview && !editing && index > 0
  const titleText = texts.title[d]?.trim() || initial.internalName || tg('list.untitled')
  const menu = [
    ...(hasDraft && initial.live ? [{ key: 'discard', label: tg('menu.discard'), onSelect: () => setConfirm('discard') }] : []),
    ...(canDelete && created ? [{ key: 'delete', label: tg('menu.delete'), onSelect: () => setConfirm('delete') }] : []),
  ]
  const places = usagePlaces(initial.usedIn)

  return (
    <WizardFrame
      onKeyDown={onKeyDown}
      mainRef={mainRef}
      wide={step === 'languages'}
      exit={step === 'done' ? null : created ? { kind: 'save', onPress: () => void saveAndExit() } : { kind: 'close', onPress: closeEmpty }}
      saveState={autosave.state}
      onReload={() => void reload()}
      onRetry={autosave.retry}
      rejected={autosave.rejected}
      footer={
        step === 'done'
          ? null
          : {
              hint: notice?.kind === 'error' && step !== 'review' ? notice.text : hint,
              progress: showProgress ? { current: progressIndex + 1, total: steps.length } : null,
              back: hasBack ? { onPress: goBack, disabled: busy } : null,
              primary: { label: primaryLabel, onPress: () => void (savesHere ? save() : goNext()), disabled: !canPrimary, busy },
            }
      }
      overlay={
        <ConfirmDialog
          open={confirm !== null}
          title={confirm === 'delete' ? tg('confirm.deleteTitle') : tg('confirm.discardTitle')}
          body={confirm === 'delete' ? tg('confirm.deleteBody', { title: titleText }) : tg('confirm.discardBody')}
          confirmLabel={confirm === 'delete' ? tg('confirm.delete') : tg('confirm.discard')}
          busy={confirmBusy}
          error={confirmError}
          onConfirm={() => void runConfirm()}
          onCancel={() => {
            setConfirm(null)
            setConfirmError(null)
          }}
        />
      }
    >
      {/* Add photos stays mounted so uploads keep going while you move on. */}
      <div hidden={step !== 'photos'}>
        <PhotoAddStep
          projectSlug={projectSlug}
          scope="gallery"
          title={t('photos.title')}
          helper={t('photos.helper')}
          defaultLocale={d}
          items={items}
          onAdd={onAdd}
          onChange={(next) => saveItems(byKeys(itemsRef.current, next.map((n) => n.key)))}
          onOpen={(key) => openDescribe(Math.max(0, itemsRef.current.findIndex((i) => i.key === key)), { editing })}
          onPhotosChanged={onPhotosChanged}
          room={Math.max(0, MAX_PHOTOS - items.length)}
        />
      </div>

      {step === 'name' ? (
        <NameStep texts={texts} locale={d} onText={onText} tags={tags} onTags={onTags} />
      ) : step === 'describe' ? (
        current ? (
          <PhotoDescribeStep
            key={current.key}
            projectSlug={projectSlug}
            scope="gallery"
            site={{ defaultLocale: d, languages: site.languages }}
            photo={current}
            index={describeIndex}
            total={items.length}
            onChange={onPhotoChange}
            onSaving={onPhotoSaving}
            onSkip={skipDescribe}
          />
        ) : null
      ) : step === 'languages' ? (
        <GalleryLanguagesStep
          texts={texts}
          site={site}
          choices={choices}
          active={activeLanguage}
          onChoice={(l, c) => setChoices((s) => ({ ...s, [l]: c }))}
          onActive={setActiveLanguage}
          onText={onText}
        />
      ) : step === 'preview' ? (
        <GalleryPreviewStep
          site={site}
          galleryId={galleryId}
          texts={texts}
          pages={pages}
          pageId={pageId}
          onPage={setPageId}
          flush={flushAll}
        />
      ) : step === 'review' ? (
        <GalleryReviewStep
          texts={texts}
          items={items}
          site={site}
          onEdit={openSection}
          onPreview={() => go('preview', { editing: true })}
          menu={menu}
          status={isNew ? null : status}
          notice={notice}
        />
      ) : step === 'done' ? (
        <GalleryDoneStep isNew={isNew} places={places} listHref={listHref} />
      ) : null}
    </WizardFrame>
  )
}

/** The full photos for these keys, in this order (the grid hands back its own lighter items). */
function byKeys(items: GalleryPhoto[], keys: string[]): GalleryPhoto[] {
  const map = new Map(items.map((i) => [i.key, i]))
  return keys.map((k) => map.get(k)).filter((i): i is GalleryPhoto => Boolean(i))
}
