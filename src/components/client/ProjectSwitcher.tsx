'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'

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
 * All copy is localized via `clientDashboard.projectSwitcher.*` — no hardcoded
 * strings (Multilingual-First).
 */

/** How long the landing-hint cookie persists (days → seconds). */
const LAST_PROJECT_COOKIE = 'abluo_last_project'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180 // 180 days

function writeLastProjectCookie(slug: string) {
  document.cookie = `${LAST_PROJECT_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`
}

export type ProjectSwitcherProps = {
  /** All projects the caller may switch between — their resolved slugs. */
  projects: { projectSlug: string }[]
  /** The currently active project slug (from the URL). */
  activeSlug: string
}

export function ProjectSwitcher({ projects, activeSlug }: ProjectSwitcherProps) {
  const t = useTranslations('clientDashboard.projectSwitcher')
  const router = useRouter()
  // next-intl usePathname() returns the path WITHOUT the locale prefix,
  // e.g. "/livener-main/posts".
  const pathname = usePathname()

  // Keep the landing hint fresh: the last project the user actually viewed.
  useEffect(() => {
    writeLastProjectCookie(activeSlug)
  }, [activeSlug])

  function subPageFor(slug: string): string {
    // Strip the leading "/{activeSlug}" to recover the sub-page ("/posts").
    // Falls back to the posts landing if the path is unexpectedly bare.
    const prefix = `/${activeSlug}`
    const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
    return `/${slug}${rest || '/posts'}`
  }

  function handleChange(nextSlug: string) {
    if (nextSlug === activeSlug) return
    writeLastProjectCookie(nextSlug)
    router.push(subPageFor(nextSlug))
  }

  // Single project — nothing to switch to. Render the name, not a control.
  if (projects.length <= 1) {
    return (
      <div>
        <p className="text-[10px] uppercase tracking-widest text-zinc-500">
          {t('label')}
        </p>
        <p className="mt-1 truncate text-sm text-zinc-100" title={activeSlug}>
          {activeSlug}
        </p>
      </div>
    )
  }

  return (
    <div>
      <label
        htmlFor="client-project-switcher"
        className="text-[10px] uppercase tracking-widest text-zinc-500"
      >
        {t('label')}
      </label>
      <select
        id="client-project-switcher"
        aria-label={t('ariaLabel')}
        value={activeSlug}
        onChange={(event) => handleChange(event.target.value)}
        className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
      >
        {projects.map((project) => (
          <option key={project.projectSlug} value={project.projectSlug}>
            {project.projectSlug}
          </option>
        ))}
      </select>
    </div>
  )
}
