'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { DigitalCardImage, DigitalCardLinkValue, DigitalCardMissing, DigitalCardSnapshot, DigitalCardState } from '@/lib/api/digital-cards'
import { DIGITAL_CARD_LIMITS, cardTextLength, isValidUrlName, primaryLinkCount, type DigitalCardShow, type PersonCardShow } from '@/lib/modules/digital-cards/model'
import {
  checkDigitalCardUrlNameAction,
  digitalCardLifecycleAction,
  discardDigitalCardDraftAction,
  getDigitalCardAction,
  openDigitalCardForEditAction,
  publishDigitalCardDraftAction,
  saveDigitalCardDraftAction,
  translateDigitalCardAction,
} from '@/app/[locale]/(client)/[tenant]/cards/actions'
import { useAutosave } from '@/lib/client/autosave/use-autosave'
import type { PendingSet } from '@/lib/client/autosave/journal'
import { openThenSave } from '@/lib/client/autosave/open-then-save'
import { digitalCardErrorText, formatDigitalCardsMessage, getDigitalCardsMessages } from '@/lib/i18n/digital-cards-messages'
import { formatTranslateMessage, getTranslateMessages } from '@/lib/i18n/translate-messages'
import { MediaLibraryPicker } from '@/components/client/media/MediaLibraryPicker'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { AssistButton } from '@/components/app/ui/AssistButton'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { SaveNotice } from '@/components/app/ui/SaveNotice'
import { SavePill } from '@/components/app/ui/SavePill'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { Tabs, tabPanelProps } from '@/components/app/ui/Tabs'
import type { FocalPoint } from '@/components/app/ui/FocalPointPicker'
import { AssetFocusPanel, type AssetFocusPanelLabels } from '@/components/client/media/AssetFocusPanel'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { MediaFrame } from '@/components/app/ui/list/cells'
import { DigitalCardContents } from './DigitalCardContents'
import { DigitalCardLinks, linkComplete, linksPayload } from './DigitalCardLinks'
import { linkDisplay } from './links-model'
import { getDigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'
import { DigitalCardPreview } from './DigitalCardPreview'
import type { EditorTab } from './editor-tabs'
import { DigitalCardShare } from './DigitalCardShare'
import { DigitalCardStats } from './DigitalCardStats'

type Values = {
  description: Record<string, string>
  links: DigitalCardLinkValue[]
  background: DigitalCardImage | null
  show: DigitalCardShow
  urlName: string
}

type Confirm = 'discard' | 'delete' | 'deletePermanently' | null

type Op = 'unpublish' | 'backOnline' | 'archive' | 'restore'
type NameCheck = { name: string; state: 'checking' | 'available' | 'taken' | 'invalid'; suggestion?: string } | null

const valuesOf = (s: DigitalCardSnapshot): Values => ({ description: s.description, links: s.links, background: s.background, show: s.show, urlName: s.urlName })

const H2 = 'text-[1.0625rem] leading-7 font-semibold text-foreground'
/** The character count shows once this close to the limit (like MessageComposer). */
const DESCRIPTION_COUNTER_FROM = 60
const SECTION_ID: Record<DigitalCardMissing, string> = {
  person: 'card-shown-section',
  urlName: 'card-address-section',
  primary: 'card-links-section',
  links: 'card-links-section',
}

/**
 * The Digital Card editor (ADR-049, Amendment A) — autosaved to the draft (no
 * Save button; the first change of a published card opens its draft from the
 * browser, never on GET). Three tabs, like the People editor:
 *
 *   Card        "What's on your card" (one grouped list: real values, one
 *               switch each; missing data links to where it is added), the
 *               short description, Buttons (add / edit / reorder / show-hide /
 *               one Primary Action, D8), the address (person: URL name with a
 *               live uniqueness check, D5), the background with its focus
 *               point (saved on the Media Library asset) — and beside it on a
 *               computer (below, behind a toggle, on a phone) the LIVE PREVIEW,
 *               rendered by the website's own component.
 *   Share       QR code for print (SVG + PNG, canonical host, ?src=qr, D12);
 *               links to share, each saying where to use it (D11).
 *   Statistics  visits, clicks, click-through rate, per link, sources.
 *
 * Publish · Unpublish / Back online · Archive / Restore sit at the top right,
 * disabled ones say why; a blocked publish names what is missing with links.
 * Unpublish and Archive answer "… · Undo"; deleting always asks first.
 */
export function DigitalCardEditor({
  projectSlug,
  initial,
  canWrite = true,
  canDelete = false,
  canSeeStats = false,
  canTranslate = false,
  canSetFocus = false,
  initialTab = 'card',
}: {
  projectSlug: string
  initial: DigitalCardSnapshot
  /** digital-cards.write (the server re-checks). Without it the editor is read-only. */
  canWrite?: boolean
  /** digital-cards.delete (owner). */
  canDelete?: boolean
  /** digital-cards.stats.read. */
  canSeeStats?: boolean
  /** The Translate module is installed (the server re-checks). */
  canTranslate?: boolean
  /** media.library.manage: may move the background's focus point (saved on the asset; the server re-checks). */
  canSetFocus?: boolean
  initialTab?: EditorTab
}) {
  const uiLocale = useLocale()
  const m = getDigitalCardsMessages(uiLocale)
  const e = m.editor
  const c = m.card
  const router = useRouter()
  const idBase = useId()
  const [tab, setTab] = useState<EditorTab>(initialTab === 'stats' && !canSeeStats ? 'card' : initialTab)
  const [previewOpen, setPreviewOpen] = useState(false)
  const id = initial.id
  const listHref = `/${projectSlug}/cards`
  const isPerson = initial.kind === 'person'
  const languages = initial.site.languages.length ? initial.site.languages : [initial.site.defaultLocale]
  const d = initial.site.defaultLocale || languages[0]
  const av = initial.availability

  // ── State ──────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<{ state: DigitalCardState; hasDraft: boolean; isPublished: boolean; hasChanges: boolean }>({
    state: initial.status,
    hasDraft: initial.hasDraft,
    isPublished: initial.isPublished,
    hasChanges: initial.hasChanges,
  })
  const [snapshot, setSnapshot] = useState(initial)
  const [values, setValues] = useState<Values>(() => valuesOf(initial))
  const valuesRef = useRef(values)
  const [lang, setLang] = useState(d)
  const hasDraftRef = useRef(initial.hasDraft)
  const archived = status.state === 'archived'
  const editable = canWrite && !archived

  /** Shows a server snapshot. `keepValues`: the snapshot is older than what this editor already wrote — keep what is on screen. */
  const apply = useCallback((s: DigitalCardSnapshot, keepValues = false) => {
    hasDraftRef.current = s.hasDraft
    setSnapshot(s)
    setStatus({ state: s.status, hasDraft: s.hasDraft, isPublished: s.isPublished, hasChanges: s.hasChanges })
    if (keepValues) return
    const next = valuesOf(s)
    valuesRef.current = next
    setValues(next)
  }, [])

  // ── Autosave ───────────────────────────────────────────────────────────────
  // The first change of a published card opens its draft; a save that fails
  // right after hands the opened revision to the engine (openThenSave), so a
  // retry is never sent with the revision of a draft that no longer exists.
  const send = useCallback(
    (input: { rev: string; set: PendingSet }) =>
      openThenSave(input, {
        hasDraft: () => hasDraftRef.current,
        markDraft: () => {
          hasDraftRef.current = true
        },
        open: () => openDigitalCardForEditAction({ projectSlug, id }),
        save: (rev, set) => saveDigitalCardDraftAction({ projectSlug, id, rev, set }),
      }),
    [projectSlug, id]
  )
  const [replayed, setReplayed] = useState(false)
  const onReady = useCallback((r: PendingSet | null) => {
    if (r && Object.keys(r).length) setReplayed(true)
  }, [])
  const autosave = useAutosave({ draftId: `digital-card:${id}`, rev: initial.rev, send, onReady })
  const { exclusive, hasPending } = autosave
  /**
   * Runs a server step (publish, discard, a lifecycle change — or nothing, for
   * a plain reload) and reads the card back, all while NO autosave is sent
   * (autosave.exclusive, after a flush). The engine continues from the
   * revision just read ('' once the draft is gone: the next change opens a
   * fresh one); edits typed meanwhile stay on screen and are saved right
   * after. Before (2026-11-09), publish deleted the draft but the engine kept
   * that draft's revision, and reads could interleave with saves.
   * `ok(value)`: the step went through (only then is the card read back).
   * Resolves null when the flush could not save everything first.
   */
  const serverStep = useCallback(
    async <T,>(step: (rev: string) => Promise<T>, ok: (value: T) => boolean, opts: { draftGone?: boolean } = {}): Promise<{ value: T } | null> => {
      let card: DigitalCardSnapshot | null = null
      const out = await exclusive(async (rev) => {
        const value = await step(rev)
        if (!ok(value)) return { value }
        const r = await getDigitalCardAction({ projectSlug, id })
        if (r.ok) card = r.card
        return { value, rev: r.ok ? r.card.rev : opts.draftGone ? '' : undefined }
      })
      if (!out.ok) return null
      if (card) apply(card, hasPending())
      else if (opts.draftGone) hasDraftRef.current = false
      return { value: out.value }
    },
    [exclusive, hasPending, projectSlug, id, apply]
  )
  const reload = useCallback(async () => Boolean(await serverStep(async () => true, () => true)), [serverStep])
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

  const change = (patch: Partial<Values>, set?: PendingSet) => {
    if (!editable) return
    const next = { ...valuesRef.current, ...patch }
    valuesRef.current = next
    setValues(next)
    if (set) {
      setStatus((s) => (s.hasDraft ? s : { ...s, hasDraft: true, hasChanges: s.isPublished, state: s.isPublished ? s.state : 'draft' }))
      autosave.set(set)
    }
  }
  /**
   * The short description of one language. Over the limit it stays on screen
   * (never cut, never sent — the server would refuse it) with the count and
   * the reason; it saves as soon as it fits again.
   */
  const changeDescription = (language: string, text: string) => {
    const description = { ...valuesRef.current.description, [language]: text }
    change({ description }, cardTextLength(text) > DIGITAL_CARD_LIMITS.description ? undefined : { [`description.${language}`]: text })
  }
  const setSwitch = (key: string, value: unknown) => change({ show: { ...valuesRef.current.show, [key]: value } as DigitalCardShow }, { [`show.${key}`]: value })
  const setLinks = (links: DigitalCardLinkValue[]) => change({ links }, { links: linksPayload(links) })

  // ── Messages ───────────────────────────────────────────────────────────────
  const { toast, show } = useUndo()
  const [notice, setNotice] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<DigitalCardMissing[] | null>(null)
  const errorText = (code: string) => digitalCardErrorText(m, code)
  const flushed = async (): Promise<boolean> => {
    if (await autosave.flush()) return true
    setNotice(errorText(autosave.currentState() === 'conflict' ? 'conflict' : 'offline'))
    return false
  }

  // ── URL name (person cards, live check) ────────────────────────────────────
  const [nameCheck, setNameCheck] = useState<NameCheck>(null)
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const changeUrlName = (raw: string) => {
    const name = raw.toLowerCase().replace(/\s+/g, '-').slice(0, 60)
    change({ urlName: name })
    if (nameTimer.current) clearTimeout(nameTimer.current)
    if (!isValidUrlName(name)) return setNameCheck({ name, state: 'invalid' })
    setNameCheck({ name, state: 'checking' })
    nameTimer.current = setTimeout(async () => {
      try {
        const r = await checkDigitalCardUrlNameAction({ projectSlug, id, urlName: name })
        if (valuesRef.current.urlName !== name) return
        if (!r.ok) return setNameCheck(null)
        if (r.available) {
          setNameCheck({ name, state: 'available' })
          change({}, { urlName: name })
        } else setNameCheck({ name, state: r.valid ? 'taken' : 'invalid', suggestion: r.suggestion })
      } catch {
        setNameCheck(null)
      }
    }, 400)
  }
  useEffect(() => () => {
    if (nameTimer.current) clearTimeout(nameTimer.current)
  }, [])

  // ── Translate (ADR-023: fills empty languages only) ────────────────────────
  const [translating, setTranslating] = useState(false)
  const canTranslateHere = canTranslate && editable && languages.length > 1
  async function translate() {
    if (translating || !canTranslateHere) return
    const tm = getTranslateMessages(uiLocale)
    const cur = valuesRef.current
    const hasSource = Boolean(cur.description[d]?.trim()) || cur.links.some((l) => l.label[d]?.trim() || l.description[d]?.trim())
    if (!hasSource) return setNotice(formatTranslateMessage(tm.nothingToTranslate, { source: d.toUpperCase() }))
    setTranslating(true)
    setNotice(null)
    try {
      if (!(await flushed())) return
      const r = await translateDigitalCardAction({ projectSlug, id, sourceLocale: d })
      if (!r.ok) {
        const code = r.error as string
        return setNotice(code in tm.errors ? tm.errors[code as keyof typeof tm.errors] : errorText(code))
      }
      const now = valuesRef.current
      const filled = new Set<string>()
      const description = { ...now.description }
      const set: PendingSet = {}
      for (const [loc, text] of Object.entries(r.description)) {
        if (description[loc]?.trim()) continue
        description[loc] = text
        set[`description.${loc}`] = text
        filled.add(loc)
      }
      const fill = (current: Record<string, string>, add: Record<string, string> | undefined) => {
        if (!add) return current
        const out = { ...current }
        for (const [loc, text] of Object.entries(add)) {
          if (out[loc]?.trim()) continue
          out[loc] = text
          filled.add(loc)
        }
        return out
      }
      const links = now.links.map((l) => ({ ...l, label: fill(l.label, r.labels[l.key]), description: fill(l.description, r.linkDescriptions?.[l.key]) }))
      if (Object.keys(r.labels).length || Object.keys(r.linkDescriptions ?? {}).length) set.links = linksPayload(links)
      change({ description, links }, Object.keys(set).length ? set : undefined)
      show({ message: filled.size ? formatTranslateMessage(tm.translated, { targets: [...filled].map((l) => l.toUpperCase()).join(', ') }) : tm.allTargetsProtected, tone: 'status' })
    } catch {
      setNotice(m.errors.failed)
    } finally {
      setTranslating(false)
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  const missingNow: DigitalCardMissing[] = []
  if (isPerson) {
    if (!snapshot.person?.live) missingNow.push('person')
    if (!isValidUrlName(values.urlName) || nameCheck?.state === 'taken' || nameCheck?.state === 'invalid') missingNow.push('urlName')
  }
  if (primaryLinkCount(values.links) > 1) missingNow.push('primary')
  if (values.links.some((l) => !l.hidden && !linkComplete(l))) missingNow.push('links')
  const shownMissing = blocked ?? missingNow

  const live = status.isPublished && !archived && status.state !== 'unpublished'
  const tooLong = languages.filter((l) => cardTextLength(values.description[l]) > DIGITAL_CARD_LIMITS.description)
  const publishReason = !editable ? null : tooLong.length ? e.reasonTooLong : !status.hasDraft ? e.reasonUpToDate : null
  const publishDisabled = busy || !editable || Boolean(publishReason) || missingNow.length > 0
  const unpublishReason = archived ? e.reasonArchived : !status.isPublished ? e.reasonNeverPublished : null
  const archiveReason = !status.isPublished ? e.reasonNeverPublished : null

  const scrollToId = (elementId: string) => {
    // The sections live in the Card tab: open it first, then scroll once it is drawn.
    setTab('card')
    window.setTimeout(() => {
      const el = document.getElementById(elementId)
      el?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }, 0)
  }
  const goTo = (key: DigitalCardMissing) => scrollToId(SECTION_ID[key])

  async function publish() {
    if (publishDisabled) return
    setBusy(true)
    setPublishing(true)
    setNotice(null)
    setBlocked(null)
    try {
      // Flush, publish with the confirmed revision and read the card back with
      // no autosave in between; anything typed meanwhile goes to a new draft.
      const out = await serverStep((rev) => publishDigitalCardDraftAction({ projectSlug, id, rev }), (r) => r.ok, { draftGone: true })
      if (!out) return setNotice(errorText(autosave.currentState() === 'conflict' ? 'conflict' : 'offline'))
      const r = out.value
      if (!r.ok) {
        if (r.error === 'publish_blocked' && r.detail?.missing?.length) return setBlocked(r.detail.missing)
        return setNotice(errorText(r.error))
      }
      show({ message: `${e.done} · ${e.published}`, tone: 'status' })
      router.refresh()
    } catch {
      setNotice(m.errors.failed)
    } finally {
      setBusy(false)
      setPublishing(false)
    }
  }

  const DONE: Record<Op, string> = { unpublish: e.unpublished, backOnline: e.backOnlineDone, archive: e.archived, restore: e.restored }
  async function lifecycle(op: Op, undoOp?: Op) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const wasLive = live
      const out = await serverStep(() => digitalCardLifecycleAction({ projectSlug, id, op }), (r) => r.ok)
      if (!out) return setNotice(errorText(autosave.currentState() === 'conflict' ? 'conflict' : 'offline'))
      const r = out.value
      if (!r.ok) return setNotice(errorText(r.error))
      show(
        {
          message: `${e.done} · ${DONE[op]}`,
          tone: 'status',
          ...(undoOp && {
            undo: () => {
              show(null)
              void (async () => {
                await serverStep(
                  async () => {
                    await digitalCardLifecycleAction({ projectSlug, id, op: undoOp })
                    if (op === 'archive' && wasLive) await digitalCardLifecycleAction({ projectSlug, id, op: 'backOnline' })
                    return true
                  },
                  () => true
                )
                router.refresh()
              })()
            },
          }),
        },
        8000
      )
      router.refresh()
    } catch {
      setNotice(m.errors.failed)
    } finally {
      setBusy(false)
    }
  }

  async function runConfirm() {
    if (!confirm || busy) return
    setBusy(true)
    setConfirmError(null)
    try {
      if (confirm === 'discard') {
        const out = await serverStep(
          async (rev) => {
            const r = await discardDigitalCardDraftAction({ projectSlug, id, rev })
            // The person chose to throw the changes away: nothing typed meanwhile is kept either.
            if (r.ok) await autosave.discard()
            return r
          },
          (r) => r.ok,
          { draftGone: true }
        )
        if (!out) return setConfirmError(errorText(autosave.currentState() === 'conflict' ? 'conflict' : 'offline'))
        if (!out.value.ok) return setConfirmError(errorText(out.value.error))
        setConfirm(null)
        show({ message: `${e.done} · ${e.discarded}`, tone: 'status' })
        return
      }
      const r = await digitalCardLifecycleAction({ projectSlug, id, op: confirm === 'delete' ? 'deleteDraft' : 'deletePermanently' })
      if (!r.ok) return setConfirmError(errorText(r.error))
      await autosave.discard()
      setConfirm(null)
      router.push(listHref)
    } catch {
      setConfirmError(m.errors.failed)
    } finally {
      setBusy(false)
    }
  }

  const menu: CardMenuItem[] = !canWrite
    ? []
    : archived
      ? canDelete
        ? [{ key: 'deletePermanently', label: e.deletePermanently, onSelect: () => setConfirm('deletePermanently'), destructive: true }]
        : []
      : [
          ...(status.isPublished && status.hasDraft ? [{ key: 'discard', label: e.discard, onSelect: () => setConfirm('discard') }] : []),
          ...(!status.isPublished ? [{ key: 'delete', label: e.delete, onSelect: () => setConfirm('delete'), destructive: true, separated: true }] : []),
        ]
  // Phones: everything except Publish lives in the ⋯ menu.
  const phoneMenu: CardMenuItem[] = !canWrite
    ? []
    : [
        ...(archived
          ? [{ key: 'restore', label: e.restore, onSelect: () => void lifecycle('restore') }]
          : [
              ...(status.isPublished ? [status.state === 'unpublished' ? { key: 'backOnline', label: e.backOnline, onSelect: () => void lifecycle('backOnline', 'unpublish') } : { key: 'unpublish', label: e.unpublish, onSelect: () => void lifecycle('unpublish', 'backOnline') }] : []),
              ...(status.isPublished ? [{ key: 'archive', label: e.archive, onSelect: () => void lifecycle('archive', 'restore') }] : []),
            ]),
        ...menu,
      ]

  // ── Derived ────────────────────────────────────────────────────────────────
  const personName = snapshot.person?.name || e.personFallback
  const title = isPerson ? personName : av.siteName || e.siteTitle
  const personHref = snapshot.person ? `/${projectSlug}/people/${snapshot.person.id}` : null
  // The QR code and the share links use the address that is live (old ones redirect); before the first publish, the one being typed.
  const shareName = isPerson ? (snapshot.publishedUrlName ?? (isValidUrlName(values.urlName) && nameCheck?.state !== 'taken' ? values.urlName : null)) : null
  const sharePath = shareName ? `/card/${shareName}` : '/card'
  const fileName = isPerson ? shareName || 'card' : 'link'
  const linkLabels = Object.fromEntries(values.links.map((l) => [l.key, linkDisplay(l, d, d, { pages: snapshot.pages, files: snapshot.files }, getDigitalCardSiteMessages(d)).label]))
  const descriptionCount = cardTextLength(values.description[lang])
  const rejectedHere = autosave.rejected.find((r) => r === `description.${lang}`)
  const descriptionError =
    descriptionCount > DIGITAL_CARD_LIMITS.description
      ? formatDigitalCardsMessage(e.descriptionTooLong, { count: descriptionCount, max: DIGITAL_CARD_LIMITS.description })
      : rejectedHere
        ? formatDigitalCardsMessage(e.descriptionRejected, { language: lang.toUpperCase() })
        : null
  // Refused paths keep what was typed on screen; say which, never offer a Reload that would throw it away.
  const otherRejected = autosave.rejected.filter((r) => !r.startsWith('description.'))
  const rejectedDescriptionElsewhere = autosave.rejected.filter((r) => r.startsWith('description.') && r !== `description.${lang}`)
  const rejectedOther = otherRejected.includes('links')
    ? e.linksRejected
    : rejectedDescriptionElsewhere.length
      ? formatDigitalCardsMessage(e.descriptionRejected, { language: rejectedDescriptionElsewhere[0].split('.')[1].toUpperCase() })
      : otherRejected.length
        ? e.rejectedOther
        : null

  // ── Switches (Amendment A: social profiles are on unless turned off) ───────
  const showRec = values.show as unknown as Record<string, unknown>
  const listOf = (key: 'hiddenSocials' | 'locations') => (Array.isArray(showRec[key]) ? (showRec[key] as string[]) : [])
  const toggleSocial = (item: string, on: boolean) => {
    const hidden = on ? listOf('hiddenSocials').filter((x) => x !== item) : [...listOf('hiddenSocials').filter((x) => x !== item), item]
    const socials = av.socials.map((o) => o.key).filter((k) => !hidden.includes(k))
    change({ show: { ...valuesRef.current.show, hiddenSocials: hidden, socials } as DigitalCardShow }, { 'show.hiddenSocials': hidden })
  }
  const toggleLocation = (item: string, on: boolean) => {
    const cur = listOf('locations')
    const next = on ? [...cur.filter((x) => x !== item), item] : cur.filter((x) => x !== item)
    // Keep the order of the options (the first location is the vCard address).
    setSwitch('locations', av.locations.map((o) => o.key).filter((k) => next.includes(k)))
  }
  const setLinkShown = (key: string, shown: boolean) => setLinks(valuesRef.current.links.map((l) => (l.key === key ? { ...l, hidden: !shown } : l)))

  // ── Background picker + focus point (saved on the Media Library asset) ─────
  const [pickingBackground, setPickingBackground] = useState(false)
  const [focusing, setFocusing] = useState(false)
  const [focal, setFocal] = useState<FocalPoint | null>(null)
  const shownBackground = values.background ?? (isPerson ? snapshot.inheritedBackground : null)

  const removeLink = (removed: DigitalCardLinkValue, index: number) => {
    show(
      {
        message: `${e.done} · ${e.linkRemoved}`,
        tone: 'status',
        undo: () => {
          show(null)
          const cur = valuesRef.current.links
          if (cur.some((l) => l.key === removed.key)) return
          const next = [...cur.slice(0, index), removed, ...cur.slice(index)]
          setLinks(next)
        },
      },
      8000
    )
  }

  const headerButtons = canWrite ? (
    <>
      {editable ? <SavePill state={autosave.state} onReload={() => window.location.reload()} /> : null}
      {editable ? (
        <Button variant="primary" disabled={publishDisabled} aria-describedby="card-publish-reason" onClick={() => void publish()}>
          {publishing ? e.publishing : e.publish}
        </Button>
      ) : null}
      <span className="hidden md:contents">
        {archived ? (
          <Button disabled={busy} onClick={() => void lifecycle('restore')}>
            {e.restore}
          </Button>
        ) : (
          <>
            {status.state === 'unpublished' ? (
              <Button disabled={busy} onClick={() => void lifecycle('backOnline', 'unpublish')}>
                {e.backOnline}
              </Button>
            ) : (
              <Button disabled={busy || Boolean(unpublishReason)} title={unpublishReason ?? undefined} aria-describedby={unpublishReason ? 'card-publish-reason' : undefined} onClick={() => void lifecycle('unpublish', 'backOnline')}>
                {e.unpublish}
              </Button>
            )}
            <Button disabled={busy || Boolean(archiveReason)} title={archiveReason ?? undefined} aria-describedby={archiveReason ? 'card-publish-reason' : undefined} onClick={() => void lifecycle('archive', 'restore')}>
              {e.archive}
            </Button>
          </>
        )}
        {menu.length ? <CardMenu label={e.menuLabel} items={menu} /> : null}
      </span>
      <span className="contents md:hidden">
        {/* eslint-disable-next-line react-hooks/refs -- the menu handlers run on click, not during render */}
        {phoneMenu.length ? <CardMenu label={e.menuLabel} items={phoneMenu} /> : null}
      </span>
    </>
  ) : null

  const reasons = [publishReason, !archived && !status.isPublished ? unpublishReason : null].filter((r): r is string => Boolean(r))

  const languageName = (code: string) => {
    try {
      return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) ?? code.toUpperCase()
    } catch {
      return code.toUpperCase()
    }
  }
  const tabItems = [
    { id: 'card', label: c.tabCard },
    { id: 'share', label: c.tabShare },
    ...(canSeeStats ? [{ id: 'stats', label: c.tabStats }] : []),
  ]

  const descriptionField = (
    <div className="space-y-2">
      <Field label={formatDigitalCardsMessage(e.descriptionLabel, { language: lang.toUpperCase() })} hint={isPerson ? e.descriptionPersonHint : e.descriptionSiteHint} error={descriptionError}>
        {(p) => (
          <TextArea
            {...p}
            rows={4}
            className="max-h-96 [field-sizing:content]"
            value={values.description[lang] ?? ''}
            readOnly={!editable}
            placeholder={lang !== d ? values.description[d] || undefined : undefined}
            onChange={(ev) => changeDescription(lang, ev.target.value)}
          />
        )}
      </Field>
      {descriptionCount > DIGITAL_CARD_LIMITS.description - DESCRIPTION_COUNTER_FROM && descriptionCount <= DIGITAL_CARD_LIMITS.description ? (
        <p aria-live="polite" className="text-sm leading-5 text-muted-foreground">
          {formatDigitalCardsMessage(e.descriptionCounter, { count: descriptionCount, max: DIGITAL_CARD_LIMITS.description })}
        </p>
      ) : null}
    </div>
  )
  const nameModeControl = isPerson ? (
    <SegmentedControl
      label={e.nameMode}
      appearance="soft"
      value={(values.show as PersonCardShow).nameMode}
      onChange={(v) => setSwitch('nameMode', v)}
      options={[
        { value: 'full', label: e.nameFull, disabled: !editable },
        { value: 'first', label: e.nameFirst, disabled: !editable },
      ]}
    />
  ) : undefined

  const focusLabels: AssetFocusPanelLabels = {
    title: c.focalTitle,
    helper: canSetFocus && editable ? c.focalHelper : c.focalReadOnly,
    keys: c.focalKeys,
    label: c.focalLabel,
    valueText: (x, y) => formatDigitalCardsMessage(c.focalValueText, { x, y }),
    previews: c.focalPreviews,
    preview: { wide: c.focalWide, card: c.focalCard, square: c.focalSquare, tall: c.focalTall },
    loadFailed: c.focalLoadFailed,
    status: { saving: c.focalSaving, saved: c.focalSaved, failed: c.focalFailed },
    scope: c.focalScope,
  }

  return (
    <div className="space-y-5">
      <BackLink href={listHref} label={e.back} />
      <div className="-mt-3">
        <PageHeader title={title} actions={headerButtons} />
      </div>

      <div className="flex flex-col items-start gap-2">
        <span className="flex flex-wrap items-start gap-1.5">
          <LifecycleBadge status={status.state} changes={status.state === 'published' && status.hasChanges} />
        </span>
        <div id="card-publish-reason" className="space-y-1 text-sm leading-5 text-muted-foreground">
          {editable && reasons.length ? reasons.map((r) => <p key={r}>{r}</p>) : null}
          {editable && status.hasDraft && shownMissing.length ? (
            <div className="space-y-1">
              <p className="font-medium text-foreground">{e.blockedTitle}</p>
              <ul className="space-y-1">
                {shownMissing.map((k) => (
                  <li key={k}>
                    {{ person: e.missingPerson, urlName: e.missingUrlName, primary: e.missingPrimary, links: e.missingLinks }[k]}{' '}
                    <Button variant="link" className="text-sm" onClick={() => goTo(k)}>
                      {e.goThere}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {editable ? <SaveNotice state={autosave.state} onRetry={autosave.retry} onReload={() => window.location.reload()} /> : null}
      {editable && rejectedOther ? <Notice tone="error">{rejectedOther}</Notice> : null}
      {archived ? (
        <Notice tone="info" title={e.archivedTitle} action={canWrite ? <Button onClick={() => void lifecycle('restore')}>{e.restore}</Button> : undefined}>
          {e.archivedBody}
        </Notice>
      ) : !canWrite ? (
        <Notice tone="info">{e.readOnly}</Notice>
      ) : null}
      {isPerson && snapshot.person && !snapshot.person.live ? (
        <Notice tone="info" action={personHref ? <ButtonLink href={personHref}>{e.openPerson}</ButtonLink> : undefined}>
          {e.personOffline}
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="error" onDismiss={() => setNotice(null)} dismissLabel={e.dismiss}>
          {notice}
        </Notice>
      ) : null}

      <Tabs label={c.tabsLabel} idBase={idBase} items={tabItems} value={tab} onChange={(x) => setTab(x as EditorTab)} />

      <div {...tabPanelProps(idBase, tab)}>
        {tab === 'card' ? (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="min-w-0 space-y-5">
              {languages.length > 1 ? (
                <div className="flex flex-wrap items-start gap-3">
                  <SegmentedControl
                    label={e.language}
                    appearance="soft"
                    value={lang}
                    onChange={setLang}
                    options={languages.map((l) => {
                      const empty = !values.description[l]?.trim() && values.links.every((x) => !x.label[l]?.trim())
                      return { value: l, label: empty && l !== d ? formatDigitalCardsMessage(e.languageMissing, { language: l.toUpperCase() }) : l.toUpperCase() }
                    })}
                  />
                  {canTranslateHere ? (
                    <AssistButton tone="outline" busy={translating} disabled={translating} onClick={() => void translate()}>
                      {translating ? getTranslateMessages(uiLocale).translating : formatTranslateMessage(getTranslateMessages(uiLocale).translateFrom, { source: d.toUpperCase() })}
                    </AssistButton>
                  ) : null}
                </div>
              ) : null}

              <DigitalCardContents
                snapshot={snapshot}
                show={values.show}
                links={values.links}
                lang={lang}
                defaultLocale={d}
                editable={editable}
                projectSlug={projectSlug}
                descriptionText={values.description[lang]?.trim() || values.description[d]?.trim() || ''}
                onSwitch={(key, on) => setSwitch(key, on)}
                onSocial={toggleSocial}
                onLocation={toggleLocation}
                onLinkShown={setLinkShown}
                onEditButtons={() => scrollToId('card-links-section')}
                nameMode={nameModeControl}
                descriptionField={descriptionField}
              />

              <DigitalCardLinks
                projectSlug={projectSlug}
                links={values.links}
                onChange={setLinks}
                onRemove={removeLink}
                lang={lang}
                defaultLocale={d}
                editable={editable}
                pages={snapshot.pages}
                files={snapshot.files}
                reservations={av.reservations}
              />

              {isPerson ? (
                <Panel as="section" aria-labelledby="card-address" className="space-y-3" id="card-address-section">
                  <h2 id="card-address" className={H2}>
                    {e.addressTitle}
                  </h2>
                  <p className="text-sm leading-5 text-muted-foreground">{e.addressHint}</p>
                  <Field
                    label={e.urlName}
                    error={nameCheck?.state === 'taken' ? e.urlNameTaken : nameCheck?.state === 'invalid' ? e.urlNameInvalid : null}
                    hint={snapshot.origin ? `${snapshot.origin.replace(/^https:\/\//, '')}/card/${values.urlName || '…'}` : `/card/${values.urlName || '…'}`}
                  >
                    {(p) => <TextInput {...p} value={values.urlName} readOnly={!editable} maxLength={60} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(ev) => changeUrlName(ev.target.value)} />}
                  </Field>
                  {nameCheck?.state === 'checking' ? <p className="text-sm leading-5 text-muted-foreground" role="status">{e.urlNameChecking}</p> : null}
                  {nameCheck?.state === 'available' ? <p className="text-sm leading-5 text-success" role="status">{e.urlNameAvailable}</p> : null}
                  {nameCheck?.state === 'taken' && nameCheck.suggestion && editable ? (
                    <Button onClick={() => changeUrlName(nameCheck.suggestion!)}>{formatDigitalCardsMessage(e.useSuggestion, { name: nameCheck.suggestion })}</Button>
                  ) : null}
                  {snapshot.retiredUrlNames.length ? (
                    <p className="text-sm leading-5 break-words text-muted-foreground">{formatDigitalCardsMessage(e.retiredNames, { names: snapshot.retiredUrlNames.map((n) => `/card/${n}`).join(', ') })}</p>
                  ) : null}
                </Panel>
              ) : (
                <Panel as="section" aria-labelledby="card-address" className="space-y-2" id="card-address-section">
                  <h2 id="card-address" className={H2}>
                    {e.addressTitle}
                  </h2>
                  <p className="text-[0.9375rem] leading-6 break-all text-foreground" translate="no">
                    {formatDigitalCardsMessage(e.addressSite, { address: snapshot.origin ? `${snapshot.origin}/card` : '/card' })}
                  </p>
                </Panel>
              )}

              <Panel as="section" aria-labelledby="card-background" className="space-y-3">
                <h2 id="card-background" className={H2}>
                  {e.backgroundTitle}
                </h2>
                <p className="text-sm leading-5 text-muted-foreground">{e.backgroundHint}</p>
                {shownBackground?.url ? (
                  <MediaFrame src={shownBackground.url} alt={shownBackground.alt[d] ?? e.backgroundAlt} focal={values.background ? focal : null} size={{ width: '100%', height: '10rem' }} className="rounded-xl border border-border" />
                ) : null}
                {!values.background ? <p className="text-sm leading-5 text-muted-foreground">{isPerson && snapshot.inheritedBackground ? e.backgroundInherited : e.backgroundNone}</p> : null}
                {editable ? (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setPickingBackground(true)}>{values.background ? e.changeBackground : isPerson && snapshot.inheritedBackground ? e.backgroundOwn : e.chooseBackground}</Button>
                    {values.background ? (
                      <Button aria-expanded={focusing} onClick={() => setFocusing((x) => !x)}>
                        {focusing ? c.focusHide : c.focusShow}
                      </Button>
                    ) : null}
                    {values.background ? (
                      <Button
                        onClick={() => {
                          setFocusing(false)
                          change({ background: null }, { background: null })
                        }}
                      >
                        {e.removeBackground}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {values.background ? (
                  <AssetFocusPanel
                    key={values.background.assetId}
                    projectSlug={projectSlug}
                    assetId={values.background.assetId}
                    alt={e.backgroundAlt}
                    focal={focal}
                    onFocal={setFocal}
                    editable={editable && canSetFocus}
                    show={focusing && editable}
                    labels={focusLabels}
                  />
                ) : null}
              </Panel>
            </div>

            <div className="min-w-0 space-y-3 lg:sticky lg:top-4">
              <div className="lg:hidden">
                <Button fullWidth aria-expanded={previewOpen} aria-controls="card-preview-frame" onClick={() => setPreviewOpen((x) => !x)}>
                  {previewOpen ? c.previewHide : c.previewShow}
                </Button>
              </div>
              <div id="card-preview-frame" className={previewOpen ? '' : 'hidden lg:block'}>
                <DigitalCardPreview
                  projectSlug={projectSlug}
                  id={id}
                  kind={initial.kind}
                  publicId={snapshot.publicId}
                  lang={lang}
                  languages={languages}
                  languageName={languageName}
                  description={values.description}
                  links={values.links}
                  backgroundId={values.background?.assetId ?? null}
                  focal={values.background ? focal : null}
                  show={values.show}
                  urlName={values.urlName}
                />
              </div>
            </div>
          </div>
        ) : tab === 'share' ? (
          <DigitalCardShare origin={snapshot.origin} path={sharePath} fileName={fileName} ready={!isPerson || Boolean(shareName)} live={live} />
        ) : canSeeStats ? (
          <DigitalCardStats projectSlug={projectSlug} cardId={id} linkLabels={linkLabels} />
        ) : null}
      </div>

      {pickingBackground ? (
        <MediaLibraryPicker
          projectSlug={projectSlug}
          scope="media"
          defaultLocale={d}
          exclude={values.background ? [values.background.assetId] : []}
          room={1}
          onClose={() => setPickingBackground(false)}
          onAdd={(photos) => {
            setPickingBackground(false)
            const photo = photos[0]
            if (photo) {
              setFocal(null)
              change({ background: { assetId: photo.assetId, url: photo.url, alt: photo.alt } }, { background: photo.assetId })
            }
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirm === 'discard' || confirm === 'delete'}
        title={confirm === 'discard' ? e.discardTitle : e.deleteTitle}
        body={confirm === 'discard' ? e.discardBody : e.deleteBody}
        confirmLabel={confirm === 'discard' ? e.discard : e.delete}
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
        titles={[title]}
        busy={busy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onCancel={() => {
          setConfirm(null)
          setConfirmError(null)
        }}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? e.undo : undefined} onAction={toast?.undo} />
    </div>
  )
}
