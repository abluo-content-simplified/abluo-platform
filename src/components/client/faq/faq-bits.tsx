'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { FaqSetListItem, FaqSetState, FaqSetUsage } from '@/lib/api/faq-sets'
import type { FilterableFaqSet } from '@/lib/client/faq-sets-filter'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { LinkCard } from '@/components/app/ui/LinkCard'
import { Pill } from '@/components/app/ui/list/cells'

/**
 * Shared bits of the FAQ Sets screens (ADR-037 D9): the list row type, the
 * status badge, "Used in" wording and list, language names, limits and icons.
 */

/** One row of the FAQ Sets list (table, cards, phone rows). */
export type FaqRow = FilterableFaqSet & {
  firstQuestions: string[]
  missingLocales: string[]
  usedIn: FaqSetUsage[]
  isPublished: boolean
  hasDraft: boolean
  createdAt: string
  /** The set's editor (read-only without faq.set.write). */
  href: string
}

/**
 * Input limits, mirroring FAQ_LIMITS in src/lib/api/faq-sets.ts (the server
 * enforces them; the browser only stops typing past them). Kept here so the
 * client bundle never imports the server module.
 */
export const FAQ_UI_LIMITS = { name: 120, note: 500, title: 200, question: 300, items: 100 } as const

export function toFaqRow(s: FaqSetListItem, projectSlug: string, untitled: string): FaqRow {
  return {
    id: s.id,
    name: s.name.trim() || untitled,
    searchText: s.searchText,
    state: s.state,
    used: s.usedIn.length > 0,
    count: s.count,
    updatedAt: s.updatedAt,
    createdAt: s.createdAt,
    firstQuestions: s.firstQuestions,
    missingLocales: s.missingLocales,
    usedIn: s.usedIn,
    isPublished: s.isPublished,
    hasDraft: s.hasDraft,
    href: `/${projectSlug}/faq-sets/${s.id}`,
  }
}

/** The set's status as the shared lifecycle badge: Draft · Published (+ Pending changes) · Archived. */
export function FaqStateBadge({ state, oneLine = false }: { state: FaqSetState; oneLine?: boolean }) {
  if (state === 'changes') return <LifecycleBadge status="published" changes oneLine={oneLine} />
  return <LifecycleBadge status={state} oneLine={oneLine} />
}

/** "Missing DE, FR" when some questions lack a site language; nothing when complete. */
export function MissingLanguages({ locales }: { locales: string[] }) {
  const t = useTranslations('clientDashboard.faq.list')
  if (!locales.length) return null
  return <Pill tone="highlight">{t('missing', { languages: locales.map((l) => l.toUpperCase()).join(', ') })}</Pill>
}

/**
 * Where a set is used, in short words: page titles first, then "N posts"
 * ("Home, Implants, 2 posts"). Draft pages / posts are marked.
 */
export function useUsedInSummary() {
  const t = useTranslations('clientDashboard.faq.usedIn')
  return (usedIn: FaqSetUsage[]): string => {
    const pages = usedIn.filter((u) => u.kind === 'page').map((u) => (u.published ? u.title || t('untitledPage') : t('draft', { title: u.title || t('untitledPage') })))
    const posts = usedIn.filter((u) => u.kind === 'post').length
    return [...pages, ...(posts ? [t('posts', { count: posts })] : [])].join(', ')
  }
}

/** Language name in the dashboard's language ("German"), falling back to the code. */
export function useLanguageName() {
  const ui = useLocale()
  let names: Intl.DisplayNames | null = null
  try {
    names = new Intl.DisplayNames([ui], { type: 'language' })
  } catch {
    names = null
  }
  return (code: string) => {
    try {
      return names?.of(code) ?? code.toUpperCase()
    } catch {
      return code.toUpperCase()
    }
  }
}

/**
 * Every page and post that shows the set. Posts link to their editor; pages
 * are arranged by Abluo (Studio), so they are listed without a link.
 */
export function UsedInList({ usedIn, projectSlug }: { usedIn: FaqSetUsage[]; projectSlug: string }) {
  const t = useTranslations('clientDashboard.faq.usedIn')
  if (!usedIn.length) return <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('none')}</p>
  return (
    <ul className="flex flex-col gap-2">
      {usedIn.map((u) => (
        <li key={`${u.kind}:${u.id}`}>
          <LinkCard
            href={u.kind === 'post' ? `/${projectSlug}/posts/write/${u.id}` : null}
            icon={u.kind === 'post' ? FAQ_ICONS.post : FAQ_ICONS.page}
            title={u.title || (u.kind === 'post' ? t('untitledPost') : t('untitledPage'))}
            subline={`${t(`kind.${u.kind}`)} · ${u.published ? t('published') : t('notPublished')}`}
          />
        </li>
      ))}
    </ul>
  )
}

export function svg(d: string, size = 20, width = 2) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export const FAQ_ICONS = {
  plus: svg('M12 5v14M5 12h14', 18, 2.2),
  list: svg('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', 20, 2.2),
  grid: svg('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', 20, 1.8),
  question: svg('M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 16, 2),
  page: svg('M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5', 20, 1.8),
  post: svg('M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', 20, 1.8),
  trash: svg('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', 18),
  up: svg('M12 19V5M5 12l7-7 7 7', 18),
  down: svg('M12 5v14M19 12l-7 7-7-7', 18),
}
