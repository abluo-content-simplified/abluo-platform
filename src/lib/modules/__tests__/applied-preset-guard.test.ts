// ADR-033 D-1: `appliedPreset` records an install-time fact for idempotency and
// audit. ONLY the install flow may read it; after installation behaviour must
// depend solely on configuration. This test fails if any other file in src/
// mentions it. Add a file to ALLOWED only if it is part of the install flow (or
// the schema/type declaration of the field) — never for feature code.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')

const ALLOWED = new Set(
  [
    'lib/modules/presets.ts', // apply / idempotency logic
    'lib/modules/types.ts', // type declaration
    'lib/modules/config-schema.ts', // Sanity field declaration for the installation type
    'lib/sanity/studio/ModuleList.tsx', // the install flow (Modules pane)
    'lib/modules/__tests__/presets.test.ts',
    'lib/modules/__tests__/applied-preset-guard.test.ts',
    // ⚠️ TEMPORARY EXCEPTIONS (Tom, 17 Oct 2026) — feature code reading the preset,
    // which this rule forbids. Stopgap: book covers are shown upright when the
    // catalogue was installed with the Bookshop preset, because the "Book" item
    // profile does not exist yet. REMOVE both lines when catalogue step 4 (Book
    // profile, ADR-033 Amendment I) ships and the shape follows `itemProfile`.
    'lib/modules/catalogue/dashboard-queries.ts', // TEMPORARY — presetId for the list image shape
    'lib/modules/catalogue/list-model.ts', // TEMPORARY — catalogueImageShape() from presetId
  ].map((p) => p.split('/').join(sep)),
)

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(full)
  }
  return out
}

describe('appliedPreset is install-flow only', () => {
  it('is not referenced outside the allow-list', () => {
    const offenders = walk(SRC)
      .map((f) => relative(SRC, f))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => readFileSync(join(SRC, rel), 'utf8').includes('appliedPreset'))
    expect(offenders).toEqual([])
  })
  it('the allow-list still points at real files', () => {
    for (const rel of ALLOWED) expect(() => statSync(join(SRC, rel))).not.toThrow()
  })
})
