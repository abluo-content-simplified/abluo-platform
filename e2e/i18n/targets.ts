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
 */
export type Mode = 'production' | 'preview-path' | 'preview-host'

export interface Target {
  /** projectSlug — the tenant's stable identifier. */
  project: string
  /** Where the site answers, including any path prefix. No trailing slash. */
  base: string
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

    let base: string | null = null
    if (mode === 'production' && route.hostKind === 'custom-domain') {
      // Every Abluo domain serves on www and 308s the apex there (ADR-034).
      base = `https://www.${route.host}`
    } else if (mode === 'preview-host' && route.hostKind === 'preview-subdomain') {
      base = `https://${route.host}`
    } else if (mode === 'preview-path' && route.hostKind === 'custom-domain') {
      // preview.abluo.app serves each project by path.
      base = `https://${PREVIEW_HOST}/${route.projectSlug}`
    }
    if (!base) continue

    byProject.set(route.projectSlug, {
      project: route.projectSlug,
      base,
      locales: [...route.supportedLocales],
      defaultLocale: route.defaultLocale ?? route.supportedLocales[0],
    })
  }

  return [...byProject.values()].sort((a, b) => a.project.localeCompare(b.project))
}

/** The locale segment of a path, or null when there isn't exactly one leading one. */
export function localeSegments(pathname: string, locales: string[]): string[] {
  return pathname.split('/').filter(Boolean).filter((s) => locales.includes(s))
}
