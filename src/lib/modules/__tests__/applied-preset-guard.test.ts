// ADR-033 D-1 / Catalogue V2 C7.9: which starter preset or pack was applied is
// INSTALLATION HISTORY. Only the install flow (legacy `appliedPreset`) and
// Catalogue Setup (pack history) may read it; after installation, behaviour
// depends solely on configuration. This test fails if any other file in src/
// mentions it. Add a file to an allow-list only if it is part of the install
// flow / Setup (or the schema/type declaration of the field) — never for
// feature code.
//
// Setup state is NOT pack history (D-14): `setupCompletedAt` may be read anywhere,
// but code outside Setup may import exactly one thing from `catalogue/packs/` —
// `isSetupComplete` from `packs/setup-state` — and never `setupSource`.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const norm = (p: string) => p.split('/').join(sep)

/** Files (exact) or folders (ending in "/") — relative to src/. */
const matches = (rel: string, list: readonly string[]) => list.some((p) => (p.endsWith(sep) ? rel.startsWith(p) : rel === p))

// ── legacy `appliedPreset` ───────────────────────────────────────────────────
const PRESET_ALLOWED = [
  'lib/modules/presets.ts', // apply / idempotency logic
  'lib/modules/types.ts', // type declaration
  'lib/modules/config-schema.ts', // Sanity field declaration for the installation type
  'lib/sanity/studio/ModuleList.tsx', // the install flow (Modules pane)
  'lib/sanity/studio/module-save.ts', // pure patch builder of the Modules pane's save (install flow)
  'lib/modules/__tests__/presets.test.ts',
  'lib/modules/__tests__/applied-preset-guard.test.ts',
  // C7 history reader: reads `appliedPreset{bookshop,1}` virtually as `bookshop@1` until data step D3.
  'lib/modules/catalogue/packs/',
  // ⚠️ NARROWED EXCEPTIONS (Amendment I slice 4d) — the image shape now follows each
  // item's profile (registry). The preset is read ONLY as a fallback for items
  // that have no profile yet (created in Studio). D-13 part 4 replaces this fallback
  // with `defaultItemProfile` in R2 (fixture image-shape/tmz-fallback); REMOVE both
  // lines in R3.
  'lib/modules/catalogue/dashboard-queries.ts', // fallback only: presetId for items WITHOUT a profile (slice 4d)
  'lib/modules/catalogue/list-model.ts', // fallback only: catalogueImageShape() for items WITHOUT a profile (slice 4d)
].map(norm)

// ── pack history (C7.9 guard/pack-history) ───────────────────────────────────
const HISTORY_IDENTIFIERS = ['appliedPacks', 'cataloguePackHistory', 'AppliedPackRecord', 'catalogue-packs.', 'catalogue/packs/history', 'packs/history']
const HISTORY_ALLOWED = [
  'lib/modules/catalogue/packs/',
  'components/client/catalogue/setup/', // the Setup pack / starter screens (R2)
  'lib/modules/catalogue/schema-taxonomy.ts', // Sanity declaration of the history document type
  'lib/sanity/studio/catalogue-posture.ts', // C9 Studio posture: classifies the type as a read-only Catalogue document (never reads it)
  'lib/sanity/studio/__tests__/catalogue-posture.test.ts',
  'lib/modules/catalogue/packs/__tests__/',
  'lib/modules/__tests__/applied-preset-guard.test.ts',
].map(norm)

/** Only Setup may read how setup was completed (D-14); `registry.ts` declares the config field. */
const SETUP_SOURCE_ALLOWED = [
  'lib/modules/catalogue/packs/',
  // R2: the Setup config writer (catalogueSettingsService) and its Setup actions write and return it to Setup.
  'lib/modules/catalogue/settings/',
  'app/[locale]/(client)/[tenant]/catalogue/setup/',
  'components/client/catalogue/setup/',
  'lib/modules/registry.ts',
  'lib/modules/__tests__/applied-preset-guard.test.ts',
].map(norm)

/** Outside these, an import from `catalogue/packs/` may only be `{ isSetupComplete }` from `packs/setup-state`. */
const PACKS_IMPORT_ALLOWED = ['lib/modules/catalogue/packs/', 'components/client/catalogue/setup/', 'lib/modules/__tests__/applied-preset-guard.test.ts'].map(norm)

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(full)
  }
  return out
}

const FILES = walk(SRC).map((f) => ({ rel: relative(SRC, f), text: readFileSync(f, 'utf8') }))

const PACKS_IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]*catalogue\/packs[^'"]*|\.{1,2}\/(?:[^'"]*\/)?packs\/[^'"]*)['"]|import\s+(?:type\s+)?[\w*\s]+from\s+['"]([^'"]*catalogue\/packs[^'"]*)['"]/g

describe('appliedPreset is install-flow only', () => {
  it('is not referenced outside the allow-list', () => {
    const offenders = FILES.filter(({ rel, text }) => !matches(rel, PRESET_ALLOWED) && text.includes('appliedPreset')).map((f) => f.rel)
    expect(offenders).toEqual([])
  })
})

describe('pack history is Setup-only (C7.9)', () => {
  it('guard/pack-history: history identifiers appear only in allow-listed files', () => {
    const offenders = FILES.filter(({ rel, text }) => !matches(rel, HISTORY_ALLOWED) && HISTORY_IDENTIFIERS.some((id) => text.includes(id))).map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it('setupSource is readable only by Setup', () => {
    const offenders = FILES.filter(({ rel, text }) => !matches(rel, SETUP_SOURCE_ALLOWED) && text.includes('setupSource')).map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it('outside Setup, the only import from catalogue/packs is isSetupComplete from packs/setup-state', () => {
    const offenders: string[] = []
    for (const { rel, text } of FILES) {
      if (matches(rel, PACKS_IMPORT_ALLOWED)) continue
      for (const m of text.matchAll(PACKS_IMPORT)) {
        const names = (m[2] ?? '*').split(',').map((n) => n.trim()).filter(Boolean)
        const from = m[3] ?? m[4] ?? ''
        const ok = !!m[2] && !m[1] && from.endsWith('packs/setup-state') && names.every((n) => n === 'isSetupComplete')
        if (!ok) offenders.push(`${rel}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('setupCompletedAt (completion only) may be read anywhere — the guard does not list it', () => {
    expect(HISTORY_IDENTIFIERS).not.toContain('setupCompletedAt')
  })

  it('the guard itself catches an offender (self-test)', () => {
    const fake = `import { readPackHistory } from '@/lib/modules/catalogue/packs/history'`
    expect([...fake.matchAll(PACKS_IMPORT)]).toHaveLength(1)
    expect(HISTORY_IDENTIFIERS.some((id) => fake.includes(id))).toBe(true)
    const allowed = `import { isSetupComplete } from '@/lib/modules/catalogue/packs/setup-state'`
    const [m] = [...allowed.matchAll(PACKS_IMPORT)]
    expect(m[3]).toMatch(/packs\/setup-state$/)
  })
})

describe('allow-lists', () => {
  it('still point at real files or folders (Setup screens may not exist yet)', () => {
    const future = new Set([norm('components/client/catalogue/setup/'), norm('lib/modules/catalogue/packs/__tests__/')])
    for (const rel of new Set([...PRESET_ALLOWED, ...HISTORY_ALLOWED, ...SETUP_SOURCE_ALLOWED, ...PACKS_IMPORT_ALLOWED])) {
      if (future.has(rel)) continue
      expect(() => statSync(join(SRC, rel))).not.toThrow()
    }
  })
})
