'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Pill } from '@/components/app/ui/list/cells'
import { Notice } from '@/components/app/ui/Notice'
import { CountBadge } from '@/components/app/ui/CountBadge'
import type { Referrer } from '@/lib/lifecycle/service'
import type { ItemGap } from '@/lib/modules/catalogue/dashboard-form'
import type { CatalogueKind } from '@/lib/modules/catalogue/dashboard-patch'
import type { ItemIssue } from '@/lib/modules/catalogue/item-issues'
import { languageName } from '@/components/client/create/StepHeading'
import { Button } from '@/components/app/ui/Button'

/**
 * Catalogue dashboard — small shared pieces (ADR-033, spec §10). Styling
 * follows the events editor (event-bits): 44px+ targets, the action colour for
 * the one primary button, focus rings everywhere. No user-facing string lives
 * here — every label comes from `catalogue.dashboard.*`.
 */
/**
 * The Abluo App's standard UI motion (200ms ease-out — ChoiceCard, Switch,
 * ToggleChips): the dashboard is not themed by a tenant design system, so the
 * website's --motion-* variables do not exist here. Off under reduced motion.
 */
export const CAT_MOTION = 'transition-[background-color,border-color,box-shadow,opacity] duration-200 ease-out motion-reduce:transition-none'

const svg = (d: string, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
export const CAT_ICONS = {
  plus: svg('M12 5v14M5 12h14'),
  back: svg('M15 6l-6 6 6 6'),
  up: svg('M12 19V5M5 12l7-7 7 7'),
  down: svg('M12 5v14M19 12l-7 7-7-7'),
  grip: svg('M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01', 20),
  trash: svg('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'),
  x: svg('M6 6l12 12M18 6L6 18'),
  list: svg('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'),
  cards: svg('M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'),
  search: svg('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3'),
  check: svg('M20 6 9 17l-5-5'),
  photo: svg('M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01'),
  book: svg('M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5zM4 19.5A2.5 2.5 0 0 1 6.5 17H20', 30),
  food: svg('M3 13h18M5 13a7 7 0 0 1 14 0M12 6V4M4 17h16', 30),
  product: svg('M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8', 30),
  service: svg('M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z', 30),
  menu: svg('M6 3h12v18H6zM9 7h6M9 11h6M9 15h4', 30),
  listType: svg('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', 30),
} as const

/** Quiet gap badges (spec §11: warn, never block). */
export function GapBadges({ gaps }: { gaps: readonly ItemGap[] }) {
  const t = useTranslations('catalogue.dashboard.gaps')
  if (!gaps.length) return null
  return (
    <span className="flex flex-wrap items-start gap-1.5">
      {gaps.map((g) => (
        <Pill key={g} tone="outline">
          {t(g)}
        </Pill>
      ))}
    </span>
  )
}

/** Where a referrer lives in the dashboard (collections and option lists open their editor; items theirs). */
export function referrerHref(projectSlug: string, r: Referrer): string | null {
  if (r.type === 'catalogueItem') return `/${projectSlug}/catalogue/${r.id}`
  if (r.type === 'catalogueCollection') return `/${projectSlug}/catalogue/collections/${r.id}`
  if (r.type === 'catalogueOptionList') return `/${projectSlug}/catalogue/option-lists/${r.id}`
  return null
}

/**
 * An `in_use` refusal: "Still used by: A, B." with every referrer LINKED (C7)
 * — the person can go and fix the reference instead of guessing.
 */
export function InUseNotice({ projectSlug, referrers, onClose }: { projectSlug: string; referrers: readonly Referrer[]; onClose?: () => void }) {
  const t = useTranslations('catalogue.dashboard.common')
  return (
    <Notice tone="info" title={t('inUseTitle')} onDismiss={onClose} dismissLabel={t('dismiss')}>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {referrers.map((r) => {
          const href = referrerHref(projectSlug, r)
          return (
            <li key={`${r.type}:${r.id}`}>
              {href ? (
                <Link href={href} className="text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  {r.label}
                </Link>
              ) : (
                <span className="text-foreground">{r.label}</span>
              )}
            </li>
          )
        })}
      </ul>
    </Notice>
  )
}

/** One message for any action error code. */
export function useCatalogueError() {
  const t = useTranslations('catalogue.dashboard.errors')
  const known = ['forbidden', 'not_found', 'conflict', 'archived', 'archive_first', 'in_use', 'missing_name', 'missing_slug', 'slug_taken', 'no_options', 'invalid_schedule', 'allergens_not_reviewed', 'option_allergens_not_reviewed', 'slug_without_name', 'unpublished_dependencies', 'invalid_value', 'too_large', 'unauthenticated', 'offline']
  return (code: string) => t(known.includes(code) ? code : 'failed')
}

/** Dashboard href of one document. */
export function catalogueHref(projectSlug: string, kind: CatalogueKind, id: string): string {
  if (kind === 'collection') return `/${projectSlug}/catalogue/collections/${id}`
  if (kind === 'optionList') return `/${projectSlug}/catalogue/option-lists/${id}`
  return `/${projectSlug}/catalogue/${id}`
}

/** The text in the dashboard language's best match: interface locale, then the site default, then any. */
export function textIn(texts: Record<string, string> | null | undefined, locale: string, fallback: string): string {
  const v = texts ?? {}
  return v[locale]?.trim() || v[fallback]?.trim() || Object.values(v).find((s) => s?.trim()) || ''
}

/** The sentence for one item issue, in the dashboard language. */
export function useItemIssueText() {
  const t = useTranslations('catalogue.dashboard.item.issues')
  const ui = useLocale()
  return (issue: ItemIssue) => {
    const { locale, ...rest } = issue.values ?? {}
    return t(issue.messageKey, { ...rest, ...(typeof locale === 'string' ? { language: languageName(locale, ui) } : {}) })
  }
}

/**
 * Dashboard UX rule 3: when publishing is not possible, every blocker by name,
 * each with a button that goes to the step or tab that fixes it.
 */
export function ItemIssueList({ issues, onFix }: { issues: readonly ItemIssue[]; onFix?: (issue: ItemIssue) => void }) {
  const t = useTranslations('catalogue.dashboard.item.issues')
  const text = useItemIssueText()
  if (!issues.length) return null
  return (
    <div data-item-issues>
      <Notice tone="info" title={t('title', { count: issues.length })}>
        <ul className="space-y-1">
          {issues.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="text-foreground">{text(i)}</span>
              {onFix ? (
                <Button variant="link" onClick={() => onFix(i)}>
                  {t('fix')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Notice>
    </div>
  )
}

/** An editor tab's label with a small "things to fix" count; the count is announced, not just shown. */
export function TabLabel({ label, count, advice = false }: { label: string; count?: number; /** A hint only (never a number): a quiet dot. */ advice?: boolean }) {
  const t = useTranslations('catalogue.dashboard.item.issues')
  if (!count && advice) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {label}
        <span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground" />
        <span className="sr-only">{t('adviceTab')}</span>
      </span>
    )
  }
  if (!count) return <>{label}</>
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <CountBadge count={count} srLabel={t('tabCount', { count })} />
    </span>
  )
}

/** Focus a field after a jump (the tab or step has to render first). */
export function focusField(selector: string | undefined) {
  if (!selector || typeof window === 'undefined') return
  window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>(selector)
    el?.focus?.()
    el?.scrollIntoView?.({ block: 'center' })
  }, 60)
}
