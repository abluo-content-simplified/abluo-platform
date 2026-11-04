'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { PersonListItem, PersonState, PersonUsage } from '@/lib/api/persons'
import type { FilterablePerson } from '@/lib/client/persons-filter'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { Avatar } from '@/components/app/ui/Avatar'
import { LinkCard } from '@/components/app/ui/LinkCard'
import { Pill } from '@/components/app/ui/list/cells'
import { pickerLabel, type PickerTerm } from '@/components/client/taxonomy/term-picker-model'

/**
 * Shared bits of the People screens (ADR-043 D8): the list row type, the
 * status badge, group labels, "Used in" wording and list, limits and icons.
 */

/** One row of the People list (table, cards, phone rows). */
export type PersonRow = FilterablePerson & {
  publicId: string
  firstName: string
  lastName: string
  photoUrl: string | null
  jobTitle: string
  anonymised: boolean
  isPublished: boolean
  hasDraft: boolean
  /** Pages + posts + events + schedules that name this person. */
  usageCount: number
  usage: PersonListItem['usage']
  createdAt: string
  /** Photo / short bio / languages still missing (calm badge + "Missing…" filter). */
  missing: PersonListItem['missing']
  /** The person's editor. */
  href: string
}

/**
 * Input limits, mirroring PERSON_LIMITS in src/lib/api/persons.ts (the server
 * enforces them; the browser only stops typing past them). Kept here so the
 * client bundle never imports the server module.
 */
export const PERSON_UI_LIMITS = { name: 80, displayName: 120, short: 120, shortBio: 600, website: 500, contactValue: 300, contactLabel: 80, contacts: 20, qualifications: 30, issuer: 200, notes: 5000, languages: 20 } as const

export function usageCountOf(usage: PersonListItem['usage']): number {
  return usage.pages + usage.posts + usage.events + (usage.sessions ?? 0)
}

export function toPersonRow(p: PersonListItem, projectSlug: string, anonymisedName: string): PersonRow {
  return {
    id: p.id,
    publicId: p.publicId,
    name: p.anonymised ? anonymisedName : p.name,
    firstName: p.firstName,
    lastName: p.lastName,
    searchText: p.searchText,
    state: p.state,
    groups: p.groups,
    visibility: p.visibility,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
    missing: p.missing,
    photoUrl: p.photoUrl,
    jobTitle: p.jobTitle,
    anonymised: p.anonymised,
    isPublished: p.isPublished,
    hasDraft: p.hasDraft,
    usage: p.usage,
    usageCount: usageCountOf(p.usage),
    href: `/${projectSlug}/people/${p.id}`,
  }
}

/** The person's status as the shared lifecycle badge: Draft · Published (+ Pending changes) · Archived. */
export function PersonStateBadge({ state, oneLine = false }: { state: PersonState; oneLine?: boolean }) {
  if (state === 'changes') return <LifecycleBadge status="published" changes oneLine={oneLine} />
  return <LifecycleBadge status={state} oneLine={oneLine} />
}

/**
 * What a profile still lacks, as small outline pills with the attention dot:
 * "No photo", "No short bio", "Missing DE, FR" (site languages without the
 * title or short bio). Nothing when complete, archived or anonymised (the
 * server sends nothing for anonymised people).
 */
export function MissingPills({ missing, state }: { missing: PersonRow['missing']; state: PersonState }) {
  const t = useTranslations('clientDashboard.persons.list.missing')
  if (state === 'archived') return null
  const items = [
    missing.photo ? t('photo') : '',
    missing.shortBio ? t('shortBio') : '',
    missing.languages.length ? t('languages', { languages: missing.languages.map((l) => l.toUpperCase()).join(', ') }) : '',
  ].filter(Boolean)
  if (!items.length) return null
  return (
    <span className="flex flex-wrap items-start gap-1.5">
      {items.map((label) => (
        <Pill key={label} tone="outline" icon={<span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-attention" />}>
          {label}
        </Pill>
      ))}
    </span>
  )
}

/** "Hidden" · "Team list" · "Own page" — what the website does with the person. */
export function VisibilityText({ visibility }: { visibility: 'off' | 'listed' | 'page' }) {
  const t = useTranslations('clientDashboard.persons.visibility')
  return <>{t(visibility)}</>
}

/** The group's label in the dashboard language (else the site's main one, else the key). */
export function useGroupLabel(terms: readonly PickerTerm[], defaultLocale: string) {
  const ui = useLocale()
  const byKey = new Map(terms.map((x) => [x.value, x]))
  return (key: string): string => {
    const term = byKey.get(key)
    return term ? pickerLabel(term, ui, defaultLocale) : key
  }
}

/** A person's groups as small pills (first two, then "+N"). */
export function GroupPills({ groups, label, max = 2 }: { groups: string[]; label: (key: string) => string; max?: number }) {
  if (!groups.length) return null
  const shown = groups.slice(0, max)
  const rest = groups.length - shown.length
  return (
    <span className="flex flex-wrap items-start gap-1.5">
      {shown.map((g) => (
        <Pill key={g} tone="outline">
          {label(g)}
        </Pill>
      ))}
      {rest > 0 ? <Pill tone="outline">+{rest}</Pill> : null}
    </span>
  )
}

/** The person's photo, or their initials on a quiet circle. */
export function PersonAvatar({ name, src, size = 'md', muted = false }: { name: string; src: string | null; size?: 'sm' | 'md' | 'lg'; muted?: boolean }) {
  return <Avatar name={name} email="" src={src} size={size} muted={muted} />
}

/** Where a person is used, in short words: "2 pages, 3 posts, 1 event". */
export function useUsageSummary() {
  const t = useTranslations('clientDashboard.persons.usedIn')
  return (usage: PersonUsage[]): string => {
    const count = (k: PersonUsage['kind']) => usage.filter((u) => u.kind === k).length
    const sessions = usage.filter((u) => u.kind === 'sessions').reduce((n, u) => n + (u.count ?? 1), 0)
    const parts = [
      count('page') ? t('pages', { count: count('page') }) : '',
      count('post') ? t('posts', { count: count('post') }) : '',
      count('event') ? t('events', { count: count('event') }) : '',
      sessions ? t('sessions', { count: sessions }) : '',
    ]
    return parts.filter(Boolean).join(', ')
  }
}

/** Where a person is used, by counts (the list's "Used in" cell, without titles). */
export function usageLine(t: (key: string, values?: Record<string, number>) => string, usage: PersonListItem['usage']): string {
  const parts = [
    usage.pages ? t('pages', { count: usage.pages }) : '',
    usage.posts ? t('posts', { count: usage.posts }) : '',
    usage.events ? t('events', { count: usage.events }) : '',
    usage.sessions ? t('sessions', { count: usage.sessions }) : '',
  ]
  return parts.filter(Boolean).join(', ')
}

/**
 * Everything that shows the person. Posts and events link to their editors;
 * pages are arranged by Abluo (Studio), so they are listed without a link;
 * schedules are counted.
 */
export function UsedInList({ usedIn, projectSlug }: { usedIn: PersonUsage[]; projectSlug: string }) {
  const t = useTranslations('clientDashboard.persons.usedIn')
  if (!usedIn.length) return <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('none')}</p>
  return (
    <ul className="flex flex-col gap-2">
      {usedIn.map((u) => (
        <li key={`${u.kind}:${u.id}`}>
          {u.kind === 'sessions' ? (
            <LinkCard icon={PERSON_ICONS.calendar} title={t('sessions', { count: u.count ?? 1 })} subline={t('kind.sessions')} />
          ) : (
            <LinkCard
              href={u.kind === 'post' ? `/${projectSlug}/posts/write/${u.id}` : u.kind === 'event' ? `/${projectSlug}/agenda/${u.id}` : null}
              icon={u.kind === 'post' ? PERSON_ICONS.post : u.kind === 'event' ? PERSON_ICONS.calendar : PERSON_ICONS.page}
              title={u.title || t(`untitled.${u.kind}`)}
              subline={`${t(`kind.${u.kind}`)} · ${u.published ? t('published') : t('notPublished')}`}
            />
          )}
        </li>
      ))}
    </ul>
  )
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

export function svg(d: string, size = 20, width = 2) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export const PERSON_ICONS = {
  plus: svg('M12 5v14M5 12h14', 18, 2.2),
  list: svg('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', 20, 2.2),
  grid: svg('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', 20, 1.8),
  page: svg('M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5', 20, 1.8),
  post: svg('M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', 20, 1.8),
  calendar: svg('M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 20, 1.8),
  tag: svg('M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01', 20, 1.8),
  trash: svg('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', 18),
  lock: svg('M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z', 16, 2),
  globe: svg('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z', 16, 2),
  sparkle: svg('M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z', 18, 1.8),
}
