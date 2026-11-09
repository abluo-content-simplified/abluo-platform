'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { DigitalCardImage, DigitalCardLinkValue, DigitalCardMissing, DigitalCardSnapshot, DigitalCardState } from '@/lib/api/digital-cards'
import { DIGITAL_CARD_LIMITS, isValidUrlName, primaryLinkCount, type DigitalCardShow, type PersonCardShow } from '@/lib/modules/digital-cards/model'
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
import { digitalCardErrorText, formatDigitalCardsMessage, getDigitalCardsMessages } from '@/lib/i18n/digital-cards-messages'
import { formatTranslateMessage, getTranslateMessages } from '@/lib/i18n/translate-messages'
import { MediaLibraryPicker } from '@/components/client/media/MediaLibraryPicker'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { AssistButton } from '@/components/app/ui/AssistButton'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { SaveNotice } from '@/components/app/ui/SaveNotice'
import { SavePill } from '@/components/app/ui/SavePill'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { MediaFrame } from '@/components/app/ui/list/cells'
import { DigitalCardLinks, linkComplete, linkKindLabel, linksPayload } from './DigitalCardLinks'
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
const SECTION_ID: Record<DigitalCardMissing, string> = {
  person: 'card-shown-section',
  urlName: 'card-address-section',
  primary: 'card-links-section',
  links: 'card-links-section',
}

/**
 * The Digital Card editor (ADR-049) — one page, autosaved to the draft (no
 * Save button; the first change of a published card opens its draft from the
 * browser, never on GET).
 *
 *   What's shown   the switches (D7), each disabled with the reason and a link
 *                  to where the data is added (Website Settings via Support /
 *                  the person in People); name as shown; per-social and
 *                  per-location; the short description per language
 *   Links          add / edit / reorder / show-hide / one Primary Action (D8)
 *   Address        person cards: URL name with a live uniqueness check (D5)
 *   Background     Media Library picture; a person card uses the site card's
 *   QR code        SVG + PNG, canonical host, ?src=qr (D12)
 *   Links to share tagged links with copy buttons (D11)
 *   Statistics     visits, clicks, click-through rate, per link, sources
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
}) {
  const uiLocale = useLocale()
  const m = getDigitalCardsMessages(uiLocale)
  const e = m.editor
  const router = useRouter()
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

  const apply = useCallback((s: DigitalCardSnapshot) => {
    hasDraftRef.current = s.hasDraft
    setSnapshot(s)
    setStatus({ state: s.status, hasDraft: s.hasDraft, isPublished: s.isPublished, hasChanges: s.hasChanges })
    const next = valuesOf(s)
    valuesRef.current = next
    setValues(next)
  }, [])

  // ── Autosave ───────────────────────────────────────────────────────────────
  const send = useCallback(
    async (input: { rev: string; set: PendingSet }) => {
      let rev = input.rev
      if (!hasDraftRef.current || !rev) {
        const opened = await openDigitalCardForEditAction({ projectSlug, id })
        if (!opened.ok) return { ok: false, error: opened.error } as const
        rev = opened.rev
        hasDraftRef.current = true
      }
      const r = await saveDigitalCardDraftAction({ projectSlug, id, rev, set: input.set })
      return r.ok ? ({ ok: true, rev: r.rev } as const) : ({ ok: false, error: r.error } as const)
    },
    [projectSlug, id]
  )
  const adoptRevRef = useRef<(rev: string) => void>(() => {})
  const reload = useCallback(async () => {
    const r = await getDigitalCardAction({ projectSlug, id })
    if (r.ok) {
      apply(r.card)
      if (r.card.rev) adoptRevRef.current(r.card.rev)
    }
    return r.ok
  }, [projectSlug, id, apply])
  const [replayed, setReplayed] = useState(false)
  const onReady = useCallback((r: PendingSet | null) => {
    if (r && Object.keys(r).length) setReplayed(true)
  }, [])
  const autosave = useAutosave({ draftId: `digital-card:${id}`, rev: initial.rev, send, onReady })
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
    const hasSource = Boolean(cur.description[d]?.trim()) || cur.links.some((l) => l.label[d]?.trim())
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
      const links = now.links.map((l) => {
        const add = r.labels[l.key]
        if (!add) return l
        const label = { ...l.label }
        for (const [loc, text] of Object.entries(add)) {
          if (label[loc]?.trim()) continue
          label[loc] = text
          filled.add(loc)
        }
        return { ...l, label }
      })
      if (Object.keys(r.labels).length) set.links = linksPayload(links)
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
  const publishReason = !editable ? null : !status.hasDraft ? e.reasonUpToDate : null
  const publishDisabled = busy || !editable || Boolean(publishReason) || missingNow.length > 0
  const unpublishReason = archived ? e.reasonArchived : !status.isPublished ? e.reasonNeverPublished : null
  const archiveReason = !status.isPublished ? e.reasonNeverPublished : null

  const goTo = (key: DigitalCardMissing) => {
    const el = document.getElementById(SECTION_ID[key])
    el?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  async function publish() {
    if (publishDisabled) return
    setBusy(true)
    setPublishing(true)
    setNotice(null)
    setBlocked(null)
    try {
      if (!(await flushed())) return
      const r = await publishDigitalCardDraftAction({ projectSlug, id, rev: autosave.currentRev() })
      if (!r.ok) {
        if (r.error === 'publish_blocked' && r.detail?.missing?.length) return setBlocked(r.detail.missing)
        return setNotice(errorText(r.error))
      }
      hasDraftRef.current = false
      await autosave.discard()
      await reload()
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
      if ((op === 'archive' || op === 'unpublish') && !(await flushed())) return
      const wasLive = live
      const r = await digitalCardLifecycleAction({ projectSlug, id, op })
      if (!r.ok) return setNotice(errorText(r.error))
      await reload()
      show(
        {
          message: `${e.done} · ${DONE[op]}`,
          tone: 'status',
          ...(undoOp && {
            undo: () => {
              show(null)
              void (async () => {
                await digitalCardLifecycleAction({ projectSlug, id, op: undoOp })
                if (op === 'archive' && wasLive) await digitalCardLifecycleAction({ projectSlug, id, op: 'backOnline' })
                await reload()
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
        await autosave.flush()
        const r = await discardDigitalCardDraftAction({ projectSlug, id, rev: autosave.currentRev() })
        if (!r.ok) return setConfirmError(errorText(r.error))
        await autosave.discard()
        await reload()
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
  const supportHref = `/${projectSlug}/support`
  // The QR code and the share links use the address that is live (old ones redirect); before the first publish, the one being typed.
  const shareName = isPerson ? (snapshot.publishedUrlName ?? (isValidUrlName(values.urlName) && nameCheck?.state !== 'taken' ? values.urlName : null)) : null
  const sharePath = shareName ? `/link/${shareName}` : '/link'
  const fileName = isPerson ? shareName || 'card' : 'link'
  const linkLabels = Object.fromEntries(values.links.map((l) => [l.key, l.label[d]?.trim() || Object.values(l.label)[0] || linkKindLabel(m, l.kind)]))
  const showRec = values.show as unknown as Record<string, unknown>
  const listOf = (key: 'socials' | 'locations') => (Array.isArray(showRec[key]) ? (showRec[key] as string[]) : [])

  // ── Render helpers ─────────────────────────────────────────────────────────
  const reasonLine = (reason: string, href: string | null, linkText: string) => (
    <span className="block text-sm leading-5 text-muted-foreground">
      {reason}{' '}
      {href ? (
        <ButtonLink variant="link" className="text-sm" href={href}>
          {linkText}
        </ButtonLink>
      ) : null}
    </span>
  )
  const missingReason = (siteText: string, personText: string) =>
    isPerson ? reasonLine(formatDigitalCardsMessage(personText, { name: personName }), personHref, e.openPerson) : reasonLine(siteText, supportHref, e.siteFix)

  const toggleIn = (key: 'socials' | 'locations', item: string, on: boolean) => {
    const cur = listOf(key)
    const next = on ? [...cur.filter((x) => x !== item), item] : cur.filter((x) => x !== item)
    // Keep the order of the options (the first location is the vCard address).
    const order = (key === 'socials' ? av.socials : av.locations).map((o) => o.key)
    setSwitch(key, order.filter((k) => next.includes(k)))
  }
  const rowCtx = { show: showRec, editable, onToggle: setSwitch }
  const listCtx = { editable, selected: listOf, onToggle: toggleIn }

  // ── Background picker ──────────────────────────────────────────────────────
  const [pickingBackground, setPickingBackground] = useState(false)
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

      {editable ? <SaveNotice state={autosave.state} rejected={autosave.rejected} onRetry={autosave.retry} onReload={() => window.location.reload()} /> : null}
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

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <Panel as="section" aria-labelledby="card-shown" className="space-y-4" id="card-shown-section">
            <div>
              <h2 id="card-shown" className={H2}>
                {e.shownTitle}
              </h2>
              <p className="text-sm leading-5 text-muted-foreground">{e.shownHint}</p>
            </div>
            <div className="grid items-start gap-x-6 gap-y-1 md:grid-cols-2">
              {isPerson ? (
                <>
                  <ShowRow {...rowCtx} k="photo" label={e.photo} available={av.photo} reason={missingReason('', e.personMissingPhoto)} />
                  <ShowRow {...rowCtx} k="name" label={e.name} />
                  <ShowRow {...rowCtx} k="role" label={e.role} available={av.role} reason={missingReason('', e.personMissingRole)} />
                  <ShowRow {...rowCtx} k="description" label={e.description} />
                  <ShowRow {...rowCtx} k="businessName" label={e.businessName} hint={e.businessNamePersonHint} available={av.businessName} reason={reasonLine(e.siteMissingName, supportHref, e.siteFix)} />
                  <ShowRow {...rowCtx} k="phone" label={e.phone} available={av.phone} reason={missingReason('', e.personMissingPhone)} />
                  <ShowRow {...rowCtx} k="email" label={e.email} available={av.email} reason={missingReason('', e.personMissingEmail)} />
                  <ShowRow {...rowCtx} k="whatsapp" label={e.whatsapp} available={av.whatsapp} reason={missingReason('', e.personMissingWhatsapp)} />
                  <ShowRow {...rowCtx} k="saveContact" label={e.saveContact} hint={e.saveContactHint} />
                  <ShowRow
                    {...rowCtx}
                    k="profileLink"
                    label={formatDigitalCardsMessage(e.profileLink, { name: snapshot.person?.firstName || personName })}
                    available={av.profilePage}
                    reason={missingReason('', e.personMissingProfile)}
                  />
                </>
              ) : (
                <>
                  <ShowRow {...rowCtx} k="logo" label={e.logo} available={av.logo} reason={missingReason(e.siteMissingLogo, '')} />
                  <ShowRow {...rowCtx} k="businessName" label={e.businessName} available={av.businessName} reason={missingReason(e.siteMissingName, '')} />
                  <ShowRow {...rowCtx} k="description" label={e.description} />
                  <ShowRow {...rowCtx} k="phone" label={e.phone} available={av.phone} reason={missingReason(e.siteMissingPhone, '')} />
                  <ShowRow {...rowCtx} k="email" label={e.email} available={av.email} reason={missingReason(e.siteMissingEmail, '')} />
                  <ShowRow {...rowCtx} k="whatsapp" label={e.whatsapp} available={av.whatsapp} reason={missingReason(e.siteMissingWhatsapp, '')} />
                  <ShowRow {...rowCtx} k="saveContact" label={e.saveContact} hint={e.saveContactHint} />
                </>
              )}
            </div>
            {isPerson ? (
              <div className="space-y-2">
                <p className="text-[0.9375rem] leading-6 font-medium text-foreground">{e.nameMode}</p>
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
              </div>
            ) : null}
            <div className="grid items-start gap-5 md:grid-cols-2">
              <ListRows {...listCtx} k="socials" label={e.socials} options={av.socials} reason={missingReason(e.siteMissingSocials, e.personMissingSocials)} />
              {!isPerson ? <ListRows {...listCtx} k="locations" label={e.locations} hint={e.locationsHint} options={av.locations} reason={missingReason(e.siteMissingLocations, '')} /> : null}
            </div>
            <Field label={formatDigitalCardsMessage(e.descriptionLabel, { language: lang.toUpperCase() })} hint={isPerson ? e.descriptionPersonHint : e.descriptionSiteHint}>
              {(p) => (
                <TextArea
                  {...p}
                  rows={2}
                  value={values.description[lang] ?? ''}
                  readOnly={!editable}
                  maxLength={DIGITAL_CARD_LIMITS.description}
                  placeholder={lang !== d ? values.description[d] || undefined : undefined}
                  onChange={(ev) => change({ description: { ...valuesRef.current.description, [lang]: ev.target.value } }, { [`description.${lang}`]: ev.target.value })}
                />
              )}
            </Field>
          </Panel>

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

          {canSeeStats ? <DigitalCardStats projectSlug={projectSlug} cardId={id} linkLabels={linkLabels} /> : null}
        </div>

        <div className="min-w-0 space-y-5">
          <Panel as="section" aria-labelledby="card-address" className="space-y-3" id="card-address-section">
            <h2 id="card-address" className={H2}>
              {e.addressTitle}
            </h2>
            {isPerson ? (
              <>
                <p className="text-sm leading-5 text-muted-foreground">{e.addressHint}</p>
                <Field
                  label={e.urlName}
                  error={nameCheck?.state === 'taken' ? e.urlNameTaken : nameCheck?.state === 'invalid' ? e.urlNameInvalid : null}
                  hint={snapshot.origin ? `${snapshot.origin.replace(/^https:\/\//, '')}/link/${values.urlName || '…'}` : `/link/${values.urlName || '…'}`}
                >
                  {(p) => <TextInput {...p} value={values.urlName} readOnly={!editable} maxLength={60} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(ev) => changeUrlName(ev.target.value)} />}
                </Field>
                {nameCheck?.state === 'checking' ? <p className="text-sm leading-5 text-muted-foreground" role="status">{e.urlNameChecking}</p> : null}
                {nameCheck?.state === 'available' ? <p className="text-sm leading-5 text-success" role="status">{e.urlNameAvailable}</p> : null}
                {nameCheck?.state === 'taken' && nameCheck.suggestion && editable ? (
                  <Button onClick={() => changeUrlName(nameCheck.suggestion!)}>{formatDigitalCardsMessage(e.useSuggestion, { name: nameCheck.suggestion })}</Button>
                ) : null}
                {snapshot.retiredUrlNames.length ? (
                  <p className="text-sm leading-5 break-words text-muted-foreground">{formatDigitalCardsMessage(e.retiredNames, { names: snapshot.retiredUrlNames.map((n) => `/link/${n}`).join(', ') })}</p>
                ) : null}
              </>
            ) : (
              <p className="text-[0.9375rem] leading-6 break-all text-foreground" translate="no">
                {formatDigitalCardsMessage(e.addressSite, { address: snapshot.origin ? `${snapshot.origin}/link` : '/link' })}
              </p>
            )}
          </Panel>

          <Panel as="section" aria-labelledby="card-background" className="space-y-3">
            <h2 id="card-background" className={H2}>
              {e.backgroundTitle}
            </h2>
            <p className="text-sm leading-5 text-muted-foreground">{e.backgroundHint}</p>
            {shownBackground?.url ? (
              <MediaFrame src={shownBackground.url} alt={shownBackground.alt[d] ?? e.backgroundAlt} size={{ width: '100%', height: '10rem' }} className="rounded-xl border border-border" />
            ) : null}
            {!values.background ? <p className="text-sm leading-5 text-muted-foreground">{isPerson && snapshot.inheritedBackground ? e.backgroundInherited : e.backgroundNone}</p> : null}
            {editable ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setPickingBackground(true)}>{values.background ? e.changeBackground : isPerson && snapshot.inheritedBackground ? e.backgroundOwn : e.chooseBackground}</Button>
                {values.background ? <Button onClick={() => change({ background: null }, { background: null })}>{e.removeBackground}</Button> : null}
              </div>
            ) : null}
          </Panel>

          <DigitalCardShare origin={snapshot.origin} path={sharePath} fileName={fileName} ready={!isPerson || Boolean(shareName)} live={live} />
        </div>
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
            if (photo) change({ background: { assetId: photo.assetId, url: photo.url, alt: photo.alt } }, { background: photo.assetId })
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

type Option = { key: string; label: string; detail?: string }

/** One "What's shown" switch: a square checkbox, top-aligned; without data it is disabled and says why (with a link). */
function ShowRow({ k, label, hint, available = true, reason, show, editable, onToggle }: { k: string; label: string; hint?: string; available?: boolean; reason?: ReactNode; show: Record<string, unknown>; editable: boolean; onToggle: (key: string, value: boolean) => void }) {
  const on = available && show[k] === true
  return (
    <div className="flex items-start gap-1">
      <Checkbox aria-label={label} checked={on} disabled={!editable || !available} onChange={(v) => onToggle(k, v)} />
      <div className="min-w-0 pt-2.5">
        <p className={`text-[0.9375rem] leading-6 ${available ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</p>
        {hint ? <p className="text-sm leading-5 text-muted-foreground">{hint}</p> : null}
        {!available ? reason : null}
      </div>
    </div>
  )
}

/** Per-social / per-location switches (D7). */
function ListRows({ k, label, hint, options, reason, editable, selected, onToggle }: { k: 'socials' | 'locations'; label: string; hint?: string; options: readonly Option[]; reason: ReactNode; editable: boolean; selected: (key: 'socials' | 'locations') => string[]; onToggle: (key: 'socials' | 'locations', item: string, on: boolean) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-[0.9375rem] leading-6 font-medium text-foreground">{label}</legend>
      {hint && options.length ? <p className="text-sm leading-5 text-muted-foreground">{hint}</p> : null}
      {options.length === 0
        ? reason
        : options.map((o) => (
            <label key={o.key} className="flex items-start gap-1">
              <Checkbox aria-label={o.label} checked={selected(k).includes(o.key)} disabled={!editable} onChange={(v) => onToggle(k, o.key, v)} />
              <span className="min-w-0 pt-2.5">
                <span className="block text-[0.9375rem] leading-6 text-foreground capitalize">{o.label}</span>
                {o.detail ? (
                  <span className="block text-sm leading-5 break-all text-muted-foreground" translate="no">
                    {o.detail}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
    </fieldset>
  )
}
