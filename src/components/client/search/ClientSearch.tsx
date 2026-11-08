'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { getPathname, useRouter } from '@/i18n/navigation'
import { SearchPalette, type SearchPaletteGroup, type SearchPaletteItem } from '@/components/app/ui/SearchPalette'
import { SearchTrigger } from '@/components/app/ui/SearchTrigger'
import { fullDateTime, parsePrefix, pickTopHit, rankMatches, relativeShort, withPrefix, words } from '@/components/app/ui/search-match'
import { searchDashboardAction } from '@/app/[locale]/(client)/[tenant]/search-actions'
import type { CreateMenu } from '@/lib/modules/add-content-sheet'
import { availableSubDestinations } from '@/lib/search/destinations'
import { SEARCH_MIN_CHARS, type SearchGroup, type SearchHit, type SearchResponse } from '@/lib/search/types'
import { addRecent, readRecent, writeRecent, type RecentEntry } from './recent'

/**
 * The client dashboard's search (ADR-047): owns the open state, ⌘K / Ctrl+K,
 * the debounced server call and the client-built groups, and feeds the shared
 * `SearchPalette`. Used through `useClientSearch`, which hands the shell its
 * three triggers (sidebar field, rail icon, phone icon) and the dialog to
 * render once.
 *
 * "Go To", "Create" and the sub-destinations (pages inside a section) are built
 * here from data the layout already has (the nav items the sidebar draws,
 * `buildCreateMenu`, `availableSubDestinations`), so they cost no request and
 * inherit the same permission filtering. Content comes from the server action;
 * the project slug is only a hint there (it re-checks the grant).
 *
 * ORDERING RULE (batch A). The results of a typed query are laid out as
 *   1. Top Hit   one row, only when a Go To / Create / sub-destination is a
 *                STRONG match: the whole query equals, or is the start of, its
 *                label or one of its synonyms (2+ characters). A person typing
 *                "events" or "calendar" wants the place, not a post that
 *                mentions it. Go To wins a tie with Create.
 *   2. Content   the server's groups, when a content search is running.
 *   3. Go To     the remaining navigation matches (word-prefix, synonym or typo).
 *   4. Create    the same.
 * So exact navigation matches win, and otherwise content leads: a weak
 * navigation match ("req" → Contact Requests) never pushes real results down.
 * With a "/" or "+" prefix only that one list is shown, ranked by match, with
 * no Top Hit and no content search.
 */

const DEBOUNCE_MS = 250

export type ClientSearchDestination = {
  key: string
  /** Already translated. */
  label: string
  /** Locale-agnostic href. */
  href: string
  /** An `AppIcon` path. */
  icon: string
}

type Config = {
  projectSlug: string
  /** Every destination the sidebar offers (already translated, same permission filtering). */
  destinations: ClientSearchDestination[]
  /** What this person can create here (`buildCreateMenu`); null/absent → no Create group. */
  createMenu?: CreateMenu | null
  /** Icon path per module id (the sidebar's icons). */
  iconFor: (moduleId: string) => string
  /** The module's navigation label (`clientDashboard.nav.<id>`). */
  moduleLabel: (moduleId: string) => string
  /** The person's permissions on this project (sub-destinations may need one). */
  permissions?: readonly string[]
  /** Contact requests nobody has answered yet: leads Quick Actions as "Contact Requests · N new". */
  newRequestsCount?: number
}

type Settled = { key: string; response: SearchResponse }

/** ⌘K is "add link" in rich-text editors: leave it to them. */
function inEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[contenteditable=""], [contenteditable="true"]') !== null
}

/** A Go To / Create / sub-destination row, before it is matched. */
type NavEntry = {
  id: string
  kind: 'goto' | 'create'
  title: string
  subtitle?: string
  icon: string
  href: string
  synonyms: string[]
  recent?: RecentEntry
}

const RECENT_SHOWN = 4
const QUICK_MAX = 4
/** Reopening within this long shows the last query again. */
const REOPEN_MS = 60_000
const TIPS: { key: string; desktopOnly?: boolean }[] = [{ key: 'tipGoTo' }, { key: 'tipCreate' }, { key: 'tipNewTab', desktopOnly: true }, { key: 'tipPaste' }]

const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

export function useClientSearch({ projectSlug, destinations, createMenu, iconFor, moduleLabel, permissions = [], newRequestsCount = 0 }: Config): { triggers: { field: ReactNode; rail: ReactNode; icon: ReactNode }; dialog: ReactNode } {
  const t = useTranslations('app.search')
  /** "With {name}" rendered from the translation, so word order follows the language; the name is the emphasised part. */
  const reasonSnippet = useCallback(
    (reason: SearchHit['reason']) => {
      if (!reason) return undefined
      const [before = '', after = ''] = t(`reason.${reason.kind}`, { name: '\u0000' }).split('\u0000')
      return { before, match: reason.name, after }
    },
    [t]
  )
  const tCreate = useTranslations('clientDashboard.create.type')
  const locale = useLocale()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [archived, setArchived] = useState(false)
  const [retry, setRetry] = useState(0)
  const [settled, setSettled] = useState<Settled | null>(null)
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [browseAll, setBrowseAll] = useState(false)
  const [selectOnOpen, setSelectOnOpen] = useState(false)
  const [tipIndex, setTipIndex] = useState(-1)
  const [now, setNow] = useState(0)
  const seq = useRef(0)
  // What the person typed when they last closed, and when: reopening soon shows it again.
  const [lastClosed, setLastClosed] = useState<{ q: string; at: number } | null>(null)
  const pasteRef = useRef(false)

  const changeQuery = setQuery

  const openSearch = useCallback(() => {
    // Within a minute of closing, the last query comes back fully selected (typing replaces it).
    const again = lastClosed !== null && lastClosed.q.trim().length > 0 && Date.now() - lastClosed.at < REOPEN_MS
    changeQuery(again ? lastClosed.q : '')
    setDebounced(again ? lastClosed.q.trim() : '')
    setSelectOnOpen(again)
    setBrowseAll(false)
    setNow(Date.now())
    setTipIndex((i) => (i + 1) % TIPS.length)
    setRecent(readRecent(projectSlug))
    setOpen(true)
  }, [projectSlug, changeQuery, lastClosed])
  const closeSearch = useCallback(() => {
    setLastClosed({ q: query, at: Date.now() })
    setOpen(false)
  }, [query])

  // ⌘K / Ctrl+K toggles, anywhere except inside a rich-text editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        if (inEditable(e.target)) return
        e.preventDefault()
        if (open) closeSearch()
        else openSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openSearch, closeSearch])

  const parsed = parsePrefix(query)
  const mode = parsed.mode
  const text = parsed.text
  const terms = useMemo(() => words(text), [text])

  // Debounce the typed text; a paste searches at once.
  const trimmed = query.trim()
  useEffect(() => {
    if (!open) return
    const delay = pasteRef.current ? 0 : DEBOUNCE_MS
    pasteRef.current = false
    const id = window.setTimeout(() => setDebounced(trimmed), delay)
    return () => window.clearTimeout(id)
  }, [trimmed, open])

  // Content is searched only in normal mode ("/" and "+" are navigation).
  const canSearch = open && mode === 'all' && trimmed.length >= SEARCH_MIN_CHARS
  const wanted = canSearch && debounced.length >= SEARCH_MIN_CHARS ? `${debounced}|${archived ? 1 : 0}|${retry}` : null
  useEffect(() => {
    if (!wanted) return
    const mine = ++seq.current
    searchDashboardAction({ projectSlug, q: debounced, includeArchived: archived })
      .catch((): SearchResponse => ({ ok: false, q: debounced, error: 'failed' }))
      .then((response) => {
        if (seq.current === mine) setSettled({ key: wanted, response })
      })
  }, [wanted, projectSlug, debounced, archived])

  const remember = useCallback(
    (entry: RecentEntry) => {
      writeRecent(projectSlug, addRecent(readRecent(projectSlug), entry))
    },
    [projectSlug],
  )
  const go = useCallback(
    (href: string, entry?: RecentEntry) => {
      if (entry) remember(entry)
      closeSearch()
      router.push(href)
    },
    [router, remember, closeSearch],
  )
  /** ⌘/Ctrl+Enter: the same page in a new tab, with the locale prefix next-intl would add. */
  const openTab = useCallback(
    (href: string) => {
      window.open(getPathname({ href, locale }), '_blank', 'noopener')
    },
    [locale],
  )

  // Every Go To / Create / sub-destination, with its synonyms. Missing messages never throw.
  const optional = useCallback((key: string) => (t.has(key as never) ? t(key as never) : ''), [t])
  const entries = useMemo(() => {
    const gotoEntries: NavEntry[] = destinations.map((d) => ({
      id: `go:${d.key}`,
      kind: 'goto',
      title: d.label,
      icon: d.icon,
      href: d.href,
      synonyms: splitList(optional(`synonyms.${d.key}`)),
      recent: { href: d.href, title: d.label, iconKey: d.key },
    }))
    const parents = new Set(destinations.map((d) => d.key))
    const subs: NavEntry[] = availableSubDestinations(parents, permissions).flatMap((sd): NavEntry[] => {
      const label = optional(`destinations.${sd.id}.label`)
      if (!label) return []
      const href = sd.href(projectSlug)
      const parent = destinations.find((d) => d.key === sd.parent)
      return [
        {
          id: `sub:${sd.id}`,
          kind: 'goto',
          title: label,
          subtitle: parent?.label,
          icon: iconFor(sd.parent),
          href,
          synonyms: splitList(optional(`destinations.${sd.id}.keywords`)),
          recent: { href, title: label, subtitle: parent?.label, iconKey: sd.parent },
        },
      ]
    })
    const creates: NavEntry[] = (createMenu?.available ?? [])
      .filter((c) => c.ready && c.href)
      .map((c) => ({
        id: `create:${c.moduleId}`,
        kind: 'create' as const,
        title: tCreate(`items.${c.moduleId}`),
        icon: iconFor(c.iconKey),
        href: c.href as string,
        synonyms: splitList(optional(`synonyms.${c.moduleId}`)),
      }))
    return { goto: [...gotoEntries, ...subs], create: creates, base: gotoEntries }
  }, [destinations, createMenu, permissions, projectSlug, iconFor, optional, tCreate])

  const navItem = useCallback(
    (e: NavEntry): SearchPaletteItem => ({
      id: e.id,
      title: e.title,
      subtitle: e.subtitle,
      icon: e.icon,
      highlight: true,
      onOpenNewTab: () => openTab(e.href),
      onSelect: () => go(e.href, e.recent),
    }),
    [go, openTab],
  )
  const plainItem = useCallback(
    (e: NavEntry, id = e.id): SearchPaletteItem => ({ id, title: e.title, subtitle: e.subtitle, icon: e.icon, onOpenNewTab: () => openTab(e.href), onSelect: () => go(e.href, e.recent) }),
    [go, openTab],
  )

  const groups = useMemo<SearchPaletteGroup[]>(() => {
    const out: SearchPaletteGroup[] = []
    const candidate = (e: NavEntry) => ({ label: e.title, synonyms: e.synonyms })

    // Prefix modes: one list, no content.
    if (mode !== 'all') {
      const list = rankMatches(mode === 'goto' ? entries.goto : entries.create, text, candidate).map((r) => r.item)
      if (list.length > 0) out.push({ key: mode, heading: t(mode === 'goto' ? 'groupGoTo' : 'groupCreate'), items: list.map(navItem) })
      return out
    }

    // Empty: Recent, Quick Actions, Browse All.
    if (!text) {
      const shownRecent = recent.slice(0, RECENT_SHOWN)
      if (shownRecent.length > 0) {
        out.push({
          key: 'recent',
          heading: t('groupRecent'),
          items: shownRecent.map((r) => ({
            id: r.href,
            title: r.title,
            subtitle: r.subtitle,
            thumbUrl: r.thumbUrl,
            icon: r.iconKey ? iconFor(r.iconKey) : undefined,
            onOpenNewTab: () => openTab(r.href),
            onSelect: () => go(r.href, r),
          })),
        })
      }
      const quick: SearchPaletteItem[] = []
      const requests = newRequestsCount > 0 ? entries.base.find((e) => e.id === 'go:forms') : undefined
      if (requests) quick.push({ ...plainItem(requests, 'qa:requests'), title: t('quickRequests', { label: requests.title, count: newRequestsCount }) })
      for (const c of entries.create) {
        if (quick.length >= QUICK_MAX) break
        quick.push(plainItem(c, `qa:${c.id}`))
      }
      if (quick.length > 0) out.push({ key: 'quick', heading: t('groupQuickActions'), items: quick })
      if (browseAll) {
        if (entries.base.length > 0) out.push({ key: 'goto', heading: t('groupGoTo'), items: entries.base.map((e) => plainItem(e)) })
        if (entries.create.length > 0) out.push({ key: 'create', heading: t('groupCreate'), items: entries.create.map((e) => plainItem(e)) })
      } else if (entries.base.length + entries.create.length > 0) {
        out.push({
          key: 'browse',
          heading: t('groupBrowse'),
          items: [{ id: 'all', title: t('browseAll'), icon: 'M4 6h16M4 12h16M4 18h16', onSelect: () => setBrowseAll(true) }],
        })
      }
      return out
    }

    // A typed query: Top Hit, content, then the remaining Go To and Create matches.
    const rankedGoto = rankMatches(entries.goto, text, candidate)
    const rankedCreate = rankMatches(entries.create, text, candidate)
    const top = pickTopHit([...rankedGoto, ...rankedCreate], text)
    if (top) out.push({ key: 'top', heading: t('groupTopHit'), items: [navItem(top)] })

    const response = settled?.response
    if (canSearch && response?.ok) {
      for (const g of response.groups as SearchGroup[]) {
        if (g.hits.length === 0) continue
        const mod = moduleLabel(g.kind)
        out.push({
          key: `hits:${g.kind}`,
          heading: mod,
          items: g.hits.map((h: SearchHit) => ({
            id: h.id,
            title: h.title,
            subtitle: h.subtitle,
            snippet: h.snippet ?? reasonSnippet(h.reason),
            thumbUrl: h.thumbUrl,
            icon: h.thumbUrl ? undefined : iconFor(h.kind),
            highlight: true,
            badge: h.archived ? { label: t('archived'), tone: 'muted' as const } : h.draft ? { label: t('draft'), tone: 'outline' as const } : undefined,
            date: h.updatedAt ? { label: relativeShort(h.updatedAt, locale, now), title: fullDateTime(h.updatedAt, locale) } : undefined,
            siteUrl: h.siteUrl,
            onOpenNewTab: () => openTab(h.href),
            onSelect: () => go(h.href, { href: h.href, title: h.title, subtitle: h.subtitle, thumbUrl: h.thumbUrl, iconKey: h.kind }),
          })),
          seeAll: g.more ? { label: t('seeAll', { module: mod }), onSelect: () => go(g.seeAllHref) } : undefined,
        })
      }
    }
    const goto = rankedGoto.map((r) => r.item).filter((e) => e !== top)
    const create = rankedCreate.map((r) => r.item).filter((e) => e !== top)
    if (goto.length > 0) out.push({ key: 'goto', heading: t('groupGoTo'), items: goto.map(navItem) })
    if (create.length > 0) out.push({ key: 'create', heading: t('groupCreate'), items: create.map(navItem) })
    return out
  }, [mode, text, entries, recent, browseAll, newRequestsCount, settled, canSearch, locale, now, t, iconFor, moduleLabel, go, openTab, navItem, plainItem, reasonSnippet])

  const failed = canSearch && settled?.key === wanted && settled !== null && !settled.response.ok && settled.response.error !== 'too_short'
  const pending = canSearch && (wanted === null || settled?.key !== wanted)
  const state: 'ready' | 'loading' | 'error' = failed ? 'error' : pending ? 'loading' : 'ready'

  const triggers = {
    field: <SearchTrigger variant="field" label={t('trigger')} shortcut={{ mac: t('shortcutMac'), other: t('shortcutOther') }} onOpen={openSearch} />,
    rail: <SearchTrigger variant="rail" label={t('trigger')} onOpen={openSearch} />,
    icon: <SearchTrigger variant="icon" label={t('trigger')} onOpen={openSearch} />,
  }

  const tip = tipIndex >= 0 ? { text: t(TIPS[tipIndex].key), desktopOnly: TIPS[tipIndex].desktopOnly } : undefined

  const dialog = (
    <SearchPalette
      open={open}
      onClose={closeSearch}
      query={query}
      onQueryChange={changeQuery}
      groups={groups}
      state={state}
      onRetry={() => setRetry((n) => n + 1)}
      onPasteQuery={() => {
        pasteRef.current = true
      }}
      onSubmit={() => {
        // Enter before the pause is over: search now instead of opening a stale first row.
        if (mode !== 'all' || trimmed.length < SEARCH_MIN_CHARS || (debounced === trimmed && settled?.key === wanted)) return false
        setDebounced(trimmed)
        return true
      }}
      archived={{ value: archived, onChange: setArchived }}
      tooShort={mode === 'all' && trimmed.length > 0 && trimmed.length < SEARCH_MIN_CHARS}
      highlightTerms={terms}
      selectOnOpen={selectOnOpen}
      tip={tip}
      chips={[
        { key: 'goto', token: '/', label: t('chipGoTo'), onSelect: () => changeQuery(withPrefix(query, '/')) },
        { key: 'create', token: '+', label: t('chipCreate'), onSelect: () => changeQuery(withPrefix(query, '+')) },
      ]}
      labels={{
        title: t('title'),
        placeholder: t('placeholder'),
        close: t('close'),
        loading: t('loading'),
        noResults: t('noResults', { q: trimmed }),
        minChars: t('minChars', { count: SEARCH_MIN_CHARS }),
        error: t('error'),
        retry: t('retry'),
        showArchived: t('showArchived'),
        hintNavigate: t('hintNavigate'),
        hintOpen: t('hintOpen'),
        hintClose: t('hintClose'),
        viewOnWebsite: t('viewOnWebsite'),
      }}
    />
  )
  return { triggers, dialog }
}
