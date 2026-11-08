'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { SearchPalette, type SearchPaletteGroup, type SearchPaletteItem } from '@/components/app/ui/SearchPalette'
import { SearchTrigger } from '@/components/app/ui/SearchTrigger'
import { searchDashboardAction } from '@/app/[locale]/(client)/[tenant]/search-actions'
import type { CreateMenu } from '@/lib/modules/add-content-sheet'
import { SEARCH_MIN_CHARS, type SearchGroup, type SearchHit, type SearchResponse } from '@/lib/search/types'
import { addRecent, fold, readRecent, writeRecent, type RecentEntry } from './recent'

/**
 * The client dashboard's search (ADR-047): owns the open state, ⌘K / Ctrl+K,
 * the debounced server call and the three client-built groups, and feeds the
 * shared `SearchPalette`. Used through `useClientSearch`, which hands the
 * shell its three triggers (sidebar field, rail icon, phone icon) and the
 * dialog to render once.
 *
 * "Go to" and "Create" are built here from data the layout already has (the
 * nav items the sidebar draws and `buildCreateMenu`), so they cost no request
 * and inherit the same permission filtering. Content comes from the server
 * action; the project slug is only a hint there (it re-checks the grant).
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
}

type Settled = { key: string; response: SearchResponse }

/** ⌘K is "add link" in rich-text editors: leave it to them. */
function inEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[contenteditable=""], [contenteditable="true"]') !== null
}

export function useClientSearch({ projectSlug, destinations, createMenu, iconFor, moduleLabel }: Config): { triggers: { field: ReactNode; rail: ReactNode; icon: ReactNode }; dialog: ReactNode } {
  const t = useTranslations('app.search')
  const tCreate = useTranslations('clientDashboard.create.type')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [archived, setArchived] = useState(false)
  const [retry, setRetry] = useState(0)
  const [settled, setSettled] = useState<Settled | null>(null)
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const seq = useRef(0)

  const openSearch = useCallback(() => {
    setQuery('')
    setDebounced('')
    setRecent(readRecent(projectSlug))
    setOpen(true)
  }, [projectSlug])
  const closeSearch = useCallback(() => setOpen(false), [])

  // ⌘K / Ctrl+K toggles, anywhere except inside a rich-text editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        if (inEditable(e.target)) return
        e.preventDefault()
        if (open) setOpen(false)
        else openSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openSearch])

  // Debounce the typed text.
  const trimmed = query.trim()
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [trimmed, open])

  const canSearch = open && trimmed.length >= SEARCH_MIN_CHARS
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
      setOpen(false)
      router.push(href)
    },
    [router, remember],
  )

  const goItem = useCallback(
    (d: ClientSearchDestination, prefix: string): SearchPaletteItem => ({
      id: `${prefix}${d.key}`,
      title: d.label,
      icon: d.icon,
      onSelect: () => go(d.href, { href: d.href, title: d.label, iconKey: d.key }),
    }),
    [go],
  )

  const groups = useMemo<SearchPaletteGroup[]>(() => {
    const q = fold(query)
    const out: SearchPaletteGroup[] = []
    if (!q && recent.length > 0) {
      out.push({
        key: 'recent',
        heading: t('groupRecent'),
        items: recent.map((r) => ({
          id: r.href,
          title: r.title,
          subtitle: r.subtitle,
          thumbUrl: r.thumbUrl,
          icon: r.iconKey ? iconFor(r.iconKey) : undefined,
          onSelect: () => go(r.href, r),
        })),
      })
    }
    const goTo = destinations.filter((d) => !q || fold(d.label).includes(q))
    if (goTo.length > 0) out.push({ key: 'goto', heading: t('groupGoTo'), items: goTo.map((d) => goItem(d, 'go:')) })
    const create = (createMenu?.available ?? [])
      .filter((c) => c.ready && c.href)
      .map((c) => ({ c, label: tCreate(`items.${c.moduleId}`) }))
      .filter(({ label }) => !q || fold(label).includes(q))
    if (create.length > 0) {
      out.push({
        key: 'create',
        heading: t('groupCreate'),
        items: create.map(({ c, label }) => ({ id: `create:${c.moduleId}`, title: label, icon: iconFor(c.iconKey), onSelect: () => go(c.href as string) })),
      })
    }
    // Content from the server: the latest answer stays visible while the next one loads.
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
            thumbUrl: h.thumbUrl,
            icon: h.thumbUrl ? undefined : iconFor(h.kind),
            badge: h.archived ? { label: t('archived'), tone: 'muted' as const } : h.draft ? { label: t('draft'), tone: 'outline' as const } : undefined,
            onSelect: () => go(h.href, { href: h.href, title: h.title, subtitle: h.subtitle, thumbUrl: h.thumbUrl, iconKey: h.kind }),
          })),
          seeAll: g.more ? { label: t('seeAll', { module: mod }), onSelect: () => go(g.seeAllHref) } : undefined,
        })
      }
    }
    return out
  }, [query, recent, destinations, createMenu, settled, canSearch, t, tCreate, iconFor, moduleLabel, go, goItem])

  const failed = canSearch && settled?.key === wanted && settled !== null && !settled.response.ok && settled.response.error !== 'too_short'
  const pending = canSearch && (wanted === null || settled?.key !== wanted)
  const state: 'ready' | 'loading' | 'error' = failed ? 'error' : pending ? 'loading' : 'ready'

  const triggers = {
    field: <SearchTrigger variant="field" label={t('trigger')} shortcut={{ mac: t('shortcutMac'), other: t('shortcutOther') }} onOpen={openSearch} />,
    rail: <SearchTrigger variant="rail" label={t('trigger')} onOpen={openSearch} />,
    icon: <SearchTrigger variant="icon" label={t('trigger')} onOpen={openSearch} />,
  }

  const dialog = (
    <SearchPalette
      open={open}
      onClose={closeSearch}
      query={query}
      onQueryChange={setQuery}
      groups={groups}
      state={state}
      onRetry={() => setRetry((n) => n + 1)}
      archived={{ value: archived, onChange: setArchived }}
      tooShort={trimmed.length > 0 && trimmed.length < SEARCH_MIN_CHARS}
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
      }}
    />
  )
  return { triggers, dialog }
}
