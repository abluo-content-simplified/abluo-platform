'use client'

import { useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import {
  activeFilterCount,
  applyFilters,
  DEFAULT_FILTERS,
  filtersToParams,
  parseFilters,
  postYears,
  statusCounts,
  type FilterablePost,
  type PostFilters,
  type PostSort,
  type PostStatus,
} from '@/lib/client/posts-filter'

export type BrowserPost = FilterablePost & {
  title: string
  subtitle: string | null
  statusLabel: string
  categories: string[]
  dateLabel: string
  offlineLabel: string | null
  /** Locale-agnostic link (wizard drafts open in the wizard). */
  href?: string | null
}

const STATUS_TABS: (PostStatus | 'all')[] = ['all', 'published', 'scheduled', 'draft', 'offline']

/**
 * Posts list with search, status tabs, category / date / language filters and
 * sort. Filtering runs in the browser on the loaded list (see posts-filter.ts);
 * the state lives in the URL so reload, Back and shared links keep it.
 */
export function PostsBrowser({
  posts,
  languages,
  categories,
  initialQuery,
}: {
  /** The page's query string at request time (server-provided, no Suspense needed). */
  initialQuery: string
  posts: BrowserPost[]
  languages: string[]
  categories: { value: string; label: string }[]
}) {
  const t = useTranslations('clientDashboard.posts')
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

  const [filters, setFilters] = useState<PostFilters>(() =>
    parseFilters(new URLSearchParams(initialQuery))
  )
  const [panelOpen, setPanelOpen] = useState(false)

  const update = (patch: Partial<PostFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    const qs = filtersToParams(next).toString()
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }

  const visible = useMemo(() => applyFilters(posts, filters), [posts, filters])
  const counts = useMemo(() => statusCounts(posts, filters), [posts, filters])
  const years = useMemo(() => postYears(posts), [posts])
  const active = activeFilterCount(filters)
  const usedCategories = categories.filter((c) => posts.some((p) => p.categoryKeys.includes(c.value)))

  const toggleCategory = (value: string) =>
    update({
      categories: filters.categories.includes(value)
        ? filters.categories.filter((c) => c !== value)
        : [...filters.categories, value],
    })

  const whenOptions = [
    { value: 'all', label: t('filters.anyTime') },
    { value: 'month', label: t('filters.thisMonth') },
    { value: '3m', label: t('filters.last3Months') },
    { value: 'year', label: t('filters.thisYear') },
    ...years.map((y) => ({ value: y, label: y })),
  ]

  return (
    <div className="space-y-4">
      {/* Search + sort + (phone) filter toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">{t('filters.search')}</span>
          <svg
            aria-hidden
            width="16"
            height="16"
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 fill-none stroke-current stroke-2 text-muted-foreground"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder={t('filters.searchPlaceholder')}
            className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          />
        </label>
        <div role="radiogroup" aria-label={t('filters.sort')} className="inline-flex h-11 items-center rounded-xl bg-muted p-1">
          {(['newest', 'oldest', 'edited'] as PostSort[]).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={filters.sort === s}
              onClick={() => update({ sort: s })}
              className={`h-9 rounded-lg px-3 text-sm font-medium ${
                filters.sort === s ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`filters.sort_${s}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen((o) => !o)}
          aria-expanded={panelOpen}
          aria-controls="posts-filter-panel"
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-foreground sm:hidden"
        >
          {t('filters.filters')}
          {active > 0 ? (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-action text-xs text-action-foreground">
              {active}
            </span>
          ) : null}
        </button>
      </div>

      {/* Status tabs (always visible; scroll sideways on phones) */}
      <div role="radiogroup" aria-label={t('filters.status')} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={filters.status === s}
            onClick={() => update({ status: s })}
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ${
              filters.status === s
                ? 'bg-action text-action-foreground'
                : 'border border-border text-foreground hover:bg-hover'
            }`}
          >
            {s === 'all' ? t('filters.all') : t(`status.${s}`)}
            <span className={filters.status === s ? 'opacity-80' : 'text-muted-foreground'}>{counts[s]}</span>
          </button>
        ))}
      </div>

      {/* Category / date / language — inline on larger screens, toggled on phones */}
      <div id="posts-filter-panel" className={`${panelOpen ? 'block' : 'hidden'} space-y-3 sm:block`}>
        {usedCategories.length > 0 ? (
          <FilterRow label={t('filters.category')}>
            {usedCategories.map((c) => (
              <Chip key={c.value} on={filters.categories.includes(c.value)} onClick={() => toggleCategory(c.value)}>
                {c.label}
              </Chip>
            ))}
          </FilterRow>
        ) : null}
        <FilterRow label={t('filters.date')}>
          {whenOptions.map((o) => (
            <Chip key={o.value} on={filters.when === o.value} onClick={() => update({ when: o.value })}>
              {o.label}
            </Chip>
          ))}
        </FilterRow>
        {languages.length > 1 ? (
          <FilterRow label={t('filters.translations')}>
            <Chip on={!filters.missing} onClick={() => update({ missing: '' })}>
              {t('filters.anyLanguage')}
            </Chip>
            {languages.map((l) => (
              <Chip key={l} on={filters.missing === l} onClick={() => update({ missing: filters.missing === l ? '' : l })}>
                {t('filters.missingLanguage', { language: l.toUpperCase() })}
              </Chip>
            ))}
          </FilterRow>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <p aria-live="polite">{t('filters.showing', { shown: visible.length, total: posts.length })}</p>
        {active > 0 || filters.q ? (
          <button
            type="button"
            onClick={() => update({ ...DEFAULT_FILTERS, sort: filters.sort })}
            className="inline-flex min-h-8 items-center font-medium text-foreground underline underline-offset-4"
          >
            {t('filters.clear')}
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
          <p className="font-medium text-foreground">{t('filters.noMatch')}</p>
          <button
            type="button"
            onClick={() => update({ ...DEFAULT_FILTERS, sort: filters.sort })}
            className="mt-3 inline-flex h-10 items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground"
          >
            {t('filters.clear')}
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle border-y border-border-subtle">
          {visible.map((post) => (
            <li
              key={post._id}
              className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
            >
              <div className="min-w-0 flex-1 space-y-1">
                {post.href ? (
                  <Link
                    href={post.href}
                    className="inline-flex min-h-6 items-center text-base font-medium leading-snug text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {post.title}
                  </Link>
                ) : (
                  <p className="text-base font-medium leading-snug text-foreground">{post.title}</p>
                )}
                {post.subtitle ? <p className="line-clamp-1 text-sm text-muted-foreground">{post.subtitle}</p> : null}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-sm text-muted-foreground">
                  {post.categories.map((c) => (
                    <span key={c} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
                      {c}
                    </span>
                  ))}
                  <span>{post.dateLabel}</span>
                  {post.offlineLabel ? <span>{post.offlineLabel}</span> : null}
                  {post.languages.length > 0 ? (
                    <span className="inline-flex gap-1" aria-label={t('languages')}>
                      {post.languages.map((l) => (
                        <span key={l} className="rounded border border-border px-1.5 text-xs font-medium uppercase leading-5">
                          {l}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </div>
              </div>
              <StatusBadge status={post.status} label={post.statusLabel} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-full text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-24">
        {label}
      </span>
      {children}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex h-8 items-center rounded-full px-3 text-sm ${
        on ? 'bg-selected-tint font-medium text-foreground ring-1 ring-foreground' : 'border border-border text-foreground hover:bg-hover'
      }`}
    >
      {children}
    </button>
  )
}

const BADGE: Record<PostStatus, string> = {
  published: 'text-success',
  scheduled: 'bg-accent text-accent-foreground border-transparent',
  draft: 'text-muted-foreground',
  offline: 'bg-muted text-muted-foreground border-transparent',
}

function StatusBadge({ status, label }: { status: PostStatus; label: string }) {
  return (
    <span
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 self-start rounded-full border border-border px-2.5 text-xs font-medium ${BADGE[status]}`}
    >
      {status === 'published' ? <span aria-hidden className="size-1.5 rounded-full bg-success" /> : null}
      {label}
    </span>
  )
}
