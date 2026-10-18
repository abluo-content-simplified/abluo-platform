'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { PickerOption, PickerTrigger } from '@/components/app/ui/PickerButton'
import { switchTarget } from '@/lib/client/surfaces'

/**
 * Project switcher for the client dashboard shell (ADR-017 Phase 2 / task #81).
 *
 * The active project lives in the URL as the first path segment
 * (`/{projectSlug}/…`) — the single source of truth (Tom's locked decision #1).
 * This control:
 *   • Persists the active slug to the `abluo_last_project` cookie on mount, so
 *     a later BARE dashboard entry can land the user on their last-used project.
 *     The cookie is a landing HINT only — it never overrides the URL.
 *   • Switches project by navigating to the SAME sub-page under the new slug
 *     (`/{newSlug}/{sameSubPage}`), keeping the user in context.
 *   • Renders non-interactively when the user has a single project — no switcher
 *     friction where there is nothing to switch to.
 *
 * The control is a button that opens a sheet listing the sites (name + domain),
 * not a native <select>: a select inside the phone drawer did not respond to
 * taps (Tom, 2026-10-08), and a select cannot show two lines per option.
 *
 * All copy is localized via `clientDashboard.projectSwitcher.*` — no hardcoded
 * strings (Multilingual-First).
 */

/** How long the landing-hint cookie persists (days → seconds). */
const LAST_PROJECT_COOKIE = 'abluo_last_project'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180 // 180 days

function writeLastProjectCookie(slug: string) {
  document.cookie = `${LAST_PROJECT_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`
}

export type SwitcherProject = {
  /** Resolved project slug (the URL's first segment). */
  projectSlug: string
  /** projects.name — null falls back to the slug. */
  name?: string | null
  /** projects.custom_domain — shown under the name when set. */
  domain?: string | null
  /** Sections this person can open in that project (navSegmentsFor). */
  segments?: string[]
}

export type ProjectSwitcherProps = {
  /** All projects the caller may switch between. */
  projects: SwitcherProject[]
  /** The currently active project slug (from the URL). */
  activeSlug: string
}

const nameOf = (p: SwitcherProject | undefined, fallback: string) => p?.name?.trim() || p?.projectSlug || fallback

export function ProjectSwitcher({ projects, activeSlug }: ProjectSwitcherProps) {
  const t = useTranslations('clientDashboard.projectSwitcher')
  const tSites = useTranslations('clientDashboard.sites')
  const router = useRouter()
  // next-intl usePathname() returns the path WITHOUT the locale prefix,
  // e.g. "/livener/posts".
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // Keep the landing hint fresh: the last project the user actually viewed.
  useEffect(() => {
    writeLastProjectCookie(activeSlug)
  }, [activeSlug])

  function choose(nextSlug: string) {
    setOpen(false)
    if (nextSlug === activeSlug) return
    writeLastProjectCookie(nextSlug)
    router.push(switchTarget(pathname, activeSlug, nextSlug, projects.find((p) => p.projectSlug === nextSlug)?.segments ?? []))
  }

  const active = projects.find((p) => p.projectSlug === activeSlug)
  const activeName = nameOf(active, activeSlug)
  const activeDomain = active?.domain ?? null

  // Single project — nothing to switch to. Render the name, not a control.
  if (projects.length <= 1) {
    return (
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{t('label')}</p>
        <p className="mt-1 truncate text-sm font-semibold text-foreground" title={activeName}>
          {activeName}
        </p>
        {activeDomain ? <p className="truncate text-xs text-muted-foreground">{activeDomain}</p> : null}
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{t('label')}</p>
      <PickerTrigger
        aria-label={t('ariaLabel')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        secondary={activeDomain}
      >
        {activeName}
      </PickerTrigger>

      <BottomSheet open={open} title={t('ariaLabel')} onClose={() => setOpen(false)}>
        {(
          <ul className="flex flex-col gap-0.5">
            <li className="mb-1 border-b border-border-subtle pb-1">
              <Link
                href="/sites"
                onClick={() => setOpen(false)}
                className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2.5 text-[0.9375rem] font-medium text-foreground transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
              >
                {tSites('allSites')}
              </Link>
            </li>
            {projects.map((p) => {
              const current = p.projectSlug === activeSlug
              return (
                <li key={p.projectSlug}>
                  <PickerOption current={current} onClick={() => choose(p.projectSlug)} secondary={p.domain}>
                    {nameOf(p, p.projectSlug)}
                  </PickerOption>
                </li>
              )
            })}
          </ul>
        )}
      </BottomSheet>
    </div>
  )
}
