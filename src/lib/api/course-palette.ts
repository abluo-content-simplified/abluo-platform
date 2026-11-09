/**
 * Courses — the site's primary colours, which the course palette is derived
 * from (`src/lib/modules/courses/palette.ts`). Read-only, server-side; the
 * dashboard (Courses list, editor swatches) uses it so a course shows the same
 * colour there as on the website.
 *
 * The chain matches what the website renders (`resolveColours()`): the
 * project's design system (its `designSystemRef`, else the one scoped by
 * projectSlug), walking up to two parents; the light theme falls back to the
 * dark theme's primary; nothing set → the platform's neutral accent.
 */
import { FALLBACK_DARK } from '@/lib/design-system/fallback-tokens'

type Fetch = { fetch: (query: string, params: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> }

export type CoursePaletteSource = { light: string | null; dark: string | null }

/** Exported so tests assert exactly what runs. Published documents only; scoped by $projectSlug. */
export const COURSE_PALETTE_SOURCE_QUERY = /* groq */ `coalesce(
  *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].designSystemRef->,
  *[_type == "designSystem" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]
){
  "dark": coalesce(colors.darkTheme.primary, parentDesignSystem->colors.darkTheme.primary, parentDesignSystem->parentDesignSystem->colors.darkTheme.primary),
  "light": coalesce(colors.lightTheme.primary, parentDesignSystem->colors.lightTheme.primary, parentDesignSystem->parentDesignSystem->colors.lightTheme.primary)
}`

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export async function readCoursePaletteSource(client: Fetch, projectSlug: string): Promise<CoursePaletteSource> {
  const row = (await client.fetch(COURSE_PALETTE_SOURCE_QUERY, { projectSlug }, { perspective: 'raw' })) as { dark?: unknown; light?: unknown } | null
  const dark = text(row?.dark) ?? FALLBACK_DARK.primary
  return { dark, light: text(row?.light) ?? dark }
}
