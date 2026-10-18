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
    'lib/sanity/studio/module-save.ts', // pure patch builder of the Modules pane's save (install flow)
    'lib/modules/__tests__/presets.test.ts',
    'lib/modules/__tests__/applied-preset-guard.test.ts',
    // ⚠️ NARROWED EXCEPTIONS (Amendment I slice 4d) — the image shape now follows each
    // item's profile (registry). The preset is read ONLY as a fallback for items
    // that have no profile yet (created in Studio). REMOVE both lines when such
    // items are gone (every item typed) — then the shape is purely registry-driven.
    'lib/modules/catalogue/dashboard-queries.ts', // fallback only: presetId for items WITHOUT a profile (slice 4d)
    'lib/modules/catalogue/list-model.ts', // fallback only: catalogueImageShape() for items WITHOUT a profile (slice 4d)
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
