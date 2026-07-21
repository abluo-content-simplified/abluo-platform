/**
 * Studio Settings Structure — one-surface source guard
 *
 * WHY THIS TEST EXISTS (deliberate source-text guard, not a unit test of behavior):
 * The Studio's per-project structure (Website Settings / Project Settings and
 * everything nested under them) is built inline inside `sanity.config.ts` as a
 * closure-heavy `S.list()` tree assembled at Studio-load time. It is not an
 * exported, independently instantiable function — there is no seam to import
 * and unit-test the structure builder in isolation without standing up the
 * full Sanity Studio config (schema, module registry, panes, etc.). Given
 * that constraint, this test reads `sanity.config.ts` as raw text (Node `fs`)
 * and asserts structural invariants directly against the source, rather than
 * against a built object graph.
 *
 * WHAT THIS PROTECTS (ADR-014 "one-surface" rule):
 * `siteConfig` must be edited from exactly ONE place in the Studio —
 * "Website Settings". Prior to the ADR-014 Phase B/S2-B fixes, a second,
 * redundant "Locales" surface existed under "Project Settings", and
 * "settings-locales" / "settings-analytics" stub items existed as
 * candidate/leftover second surfaces. Any regression that reintroduces a
 * second `siteConfig`-editing surface (or resurrects the old
 * `settings-locales` / `settings-analytics` ids) breaks the one-surface
 * invariant silently — Studio still builds, tsc stays green, nothing but a
 * human clicking around would notice. This test turns that class of
 * regression into a red build (Playbook: "a bug a gate should have caught
 * becomes a new gate").
 *
 * HOW THE REGIONS ARE FOUND:
 * The structure file marks each named region with a banner comment of the
 * form `// ── <Region Name> ──────`. This test locates the "Website Settings"
 * and "Project Settings" banners by regex, and slices the source text between
 * consecutive banners to get each region's text. If someone renames or
 * removes either banner comment, the marker-lookup assertions below fail
 * loudly (with an explicit message) rather than silently passing — this is
 * intentional. If you rename the "── Website Settings ──" or
 * "── Project Settings ──" region comments in `sanity.config.ts`, you MUST
 * update the marker strings in this test to match.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// This test file lives at src/lib/sanity/__tests__/settings-structure.test.ts.
// Repo root is four levels up: __tests__ -> sanity -> lib -> src -> <root>.
const currentDir = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(currentDir, '../../../../sanity.config.ts')

const WEBSITE_SETTINGS_MARKER = 'Website Settings'
const PROJECT_SETTINGS_MARKER = 'Project Settings'

// Matches banner comments like: // ── Website Settings ─────────────────────
const BANNER_RE = /\/\/\s*──\s*([^─]+?)\s*──+/g

function readConfigSource(): string {
  return readFileSync(CONFIG_PATH, 'utf-8')
}

interface Banner {
  title: string
  index: number
}

function findBanners(source: string): Banner[] {
  const banners: Banner[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(BANNER_RE)
  while ((match = re.exec(source)) !== null) {
    banners.push({ title: match[1].trim(), index: match.index })
  }
  return banners
}

/**
 * Returns the source-text slice for the named region: from the banner whose
 * title matches `title` to the start of the next banner in file order (or
 * EOF if it is the last banner). Throws with an explicit message if the
 * marker cannot be found — a disappearing marker must fail loudly, not be
 * silently skipped.
 */
function sliceRegion(source: string, banners: Banner[], title: string): string {
  const idx = banners.findIndex((b) => b.title === title)
  if (idx === -1) {
    throw new Error(
      `settings-structure.test.ts: could not find the "── ${title} ──" region marker in ` +
        `sanity.config.ts. This test anchors on that exact banner comment. If it was ` +
        `intentionally renamed, update WEBSITE_SETTINGS_MARKER/PROJECT_SETTINGS_MARKER ` +
        `in this test to match.`
    )
  }
  const start = banners[idx].index
  const end = idx + 1 < banners.length ? banners[idx + 1].index : source.length
  return source.slice(start, end)
}

describe('Studio settings structure — one-surface source guard (ADR-014)', () => {
  it('sanity.config.ts is readable and non-empty', () => {
    const source = readConfigSource()
    expect(source.length).toBeGreaterThan(0)
  })

  it('does not contain the retired settings-locales or settings-analytics stub ids', () => {
    const source = readConfigSource()
    // These ids belonged to now-removed stub/duplicate surfaces. Their
    // reappearance anywhere in the file signals a regression of the
    // one-surface rule (a second siteConfig-adjacent surface being rebuilt).
    expect(source).not.toContain('settings-locales')
    expect(source).not.toContain('settings-analytics')
  })

  it('finds both the Website Settings and Project Settings region markers', () => {
    const source = readConfigSource()
    const banners = findBanners(source)
    const titles = banners.map((b) => b.title)
    expect(titles).toContain(WEBSITE_SETTINGS_MARKER)
    expect(titles).toContain(PROJECT_SETTINGS_MARKER)
  })

  it('has exactly one schemaType(\'siteConfig\') occurrence, and it is inside the Website Settings region', () => {
    const source = readConfigSource()
    const banners = findBanners(source)

    const websiteSettingsRegion = sliceRegion(source, banners, WEBSITE_SETTINGS_MARKER)
    const projectSettingsRegion = sliceRegion(source, banners, PROJECT_SETTINGS_MARKER)

    const totalOccurrences = (source.match(/schemaType\(\s*['"]siteConfig['"]\s*\)/g) ?? []).length
    const websiteOccurrences = (
      websiteSettingsRegion.match(/schemaType\(\s*['"]siteConfig['"]\s*\)/g) ?? []
    ).length
    const projectOccurrences = (
      projectSettingsRegion.match(/schemaType\(\s*['"]siteConfig['"]\s*\)/g) ?? []
    ).length

    // (c) exactly one occurrence in the Website Settings region.
    expect(websiteOccurrences).toBe(1)

    // (b) zero occurrences in the Project Settings region — siteConfig must
    // never be editable from a second surface.
    expect(projectOccurrences).toBe(0)

    // Sanity check on the guard itself: the whole-file count must equal the
    // Website Settings count, i.e. siteConfig is not edited from anywhere
    // else in the Studio structure either (a third surface would slip past
    // the two checks above if it existed outside both named regions).
    expect(totalOccurrences).toBe(websiteOccurrences)
  })
})
