import { GENERATED_HOST_ROUTES } from '../../src/lib/tenancy/generated/route-config'

/**
 * Which sites the i18n suite exercises, derived from the generated route table
 * rather than listed by hand.
 *
 * That table is the build-time copy of Supabase's projects — the same source
 * `src/proxy.ts` routes from. Deriving targets from it is what makes this suite
 * cover "every existing and future Abluo tenant": onboard a client, regenerate
 * the table, and the new site is tested on the next run without anyone
 * remembering to add it.
 *
 * ── The two URL shapes ──────────────────────────────────────────────────────
 * A tenant on its own host has no project segment at all:
 *     https://www.nologo.cloud/it/partner
 * A tenant reached by path on a platform host carries one AFTER the locale:
 *     https://preview.abluo.app/it/nologo/partner
 *
 * The project segment is an infix, not a prefix. An earlier version of this
 * file modelled it as a prefix ("origin + /nologo", then append the locale),
 * which produced /nologo/en — a 404 — and skipped all 72 tests while looking
 * like a clean run. See `publicPathname` for the other half of that mistake.
 */
export type Mode = 'production' | 'preview-path' | 'preview-host'

export interface Target {
  /** projectSlug — the tenant's stable identifier. */
  project: string
  /** Scheme and host, no trailing slash. */
  origin: string
  /** The segment that sits between the locale and the rest, or null. */
  projectSegment: string | null
  locales: string[]
  defaultLocale: string
}

const MODE = (process.env.E2E_I18N_MODE ?? 'preview-path') as Mode
const PREVIEW_HOST = process.env.E2E_I18N_PREVIEW_HOST ?? 'preview.abluo.app'

/** One row per project, collapsing the table's several hosts per project. */
export function targets(mode: Mode = MODE): Target[] {
  const byProject = new Map<string, Target>()

  for (const route of GENERATED_HOST_ROUTES) {
    if (route.status !== 'active') continue
    // A site with one language has no switcher to exercise.
    if (!route.supportedLocales || route.supportedLocales.length < 2) continue

    let origin: string | null = null
    let projectSegment: string | null = null

    if (mode === 'production' && route.hostKind === 'custom-domain') {
      // Every Abluo domain serves on www and 308s the apex there (ADR-034).
      origin = `https://www.${route.host}`
    } else if (mode === 'preview-host' && route.hostKind === 'preview-subdomain') {
      origin = `https://${route.host}`
    } else if (mode === 'preview-path' && route.hostKind === 'custom-domain') {
      origin = `https://${PREVIEW_HOST}`
      projectSegment = route.projectSlug
    }
    if (!origin) continue

    byProject.set(route.projectSlug, {
      project: route.projectSlug,
      origin,
      projectSegment,
      locales: [...route.supportedLocales],
      defaultLocale: route.defaultLocale ?? route.supportedLocales[0],
    })
  }

  return [...byProject.values()].sort((a, b) => a.project.localeCompare(b.project))
}

/** An absolute URL for this target: origin / locale / [project] / …segments */
export function urlFor(site: Target, locale: string, ...segments: string[]): string {
  return [site.origin, locale, site.projectSegment, ...segments]
    .filter((part): part is string => Boolean(part))
    .join('/')
}

/**
 * The pathname as the tenant's own domain would show it — the project segment
 * removed, so one set of assertions covers both URL shapes.
 *
 * Only removed when it sits immediately after the locale, which is where the
 * proxy puts it. On a stacked URL like /de/it/nologo the second segment is a
 * locale, not the project, so nothing is removed and the stack stays visible —
 * which is the entire point of the suite.
 */
export function publicPathname(pathname: string, site: Target): string {
  const parts = pathname.split('/').filter(Boolean)
  if (site.projectSegment && parts[1] === site.projectSegment) parts.splice(1, 1)
  return '/' + parts.join('/')
}

/** The locale segments of a path, in order. More than one means they stacked. */
export function localeSegments(pathname: string, locales: string[]): string[] {
  return pathname.split('/').filter(Boolean).filter((s) => locales.includes(s))
}
