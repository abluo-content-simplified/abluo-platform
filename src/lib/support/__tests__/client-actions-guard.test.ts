/**
 * Support mode — every client-dashboard server action goes through the one
 * resolver (ADR-028 §8, docs/engineering/support-mode.md).
 *
 * Writes are refused in a view-only support visit because every server action
 * resolves its caller with `getTenantAuthorizationContext()` and its DEFAULT
 * purpose (`mutation`), which strips write permissions unless the client's
 * approval is live. This test enumerates every exported server action under
 * `src/app/[locale]/(client)` and fails when one:
 *   - does not call `getTenantAuthorizationContext()` (directly or through a
 *     local helper), unless it is listed below with the reason it is safe; or
 *   - asks for the `render` purpose (that is for pages and layouts only).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src', 'app', '[locale]', '(client)')

/** file (relative to ROOT) → exported action → why it does not need the resolver. */
const NOT_THROUGH_RESOLVER: Record<string, Record<string, string>> = {
  '[tenant]/whats-new-actions.ts': {
    markUpdatesReadAction: "marks the signed-in person's OWN read receipts under RLS (user_id = auth.uid()); touches no client data",
  },
  '[tenant]/support-actions.ts': {
    exitSupportAction: 'admin-only (requireAbluoAdmin); closes the admin’s own visit named by their own cookie',
    requestSupportEditAction: 'admin-only (requireAbluoAdmin); asks for access on the admin’s own visit',
    showContactRequestsAction: 'admin-only (requireAbluoAdmin); logged reveal on the admin’s own visit',
  },
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : files(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

type Fn = { name: string; exported: boolean; body: string }

/** Top-level function declarations (and `const x = async`) with their bodies. */
function topLevelFunctions(src: string): Fn[] {
  const re = /^(export\s+)?(?:async\s+)?function\s+(\w+)|^(export\s+)?const\s+(\w+)\s*=\s*async\b/gm
  const marks = [...src.matchAll(re)].map((m) => ({
    index: m.index ?? 0,
    name: m[2] ?? m[4],
    exported: Boolean(m[1] ?? m[3]),
  }))
  return marks.map((m, i) => ({ name: m.name, exported: m.exported, body: src.slice(m.index, marks[i + 1]?.index ?? src.length) }))
}

const actionFiles = files(ROOT).filter((f) => /^\s*['"]use server['"]/.test(readFileSync(f, 'utf8')))

describe('client-dashboard server actions go through the support-aware resolver', () => {
  it('finds the server actions (sanity check)', () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(10)
  })

  for (const file of actionFiles) {
    const rel = relative(ROOT, file).split(sep).join('/')
    const src = readFileSync(file, 'utf8')
    const fns = topLevelFunctions(src)
    const helpers = new Set(fns.filter((f) => !f.exported && f.body.includes('getTenantAuthorizationContext(')).map((f) => f.name))

    it(`${rel}: never asks for the render purpose`, () => {
      expect(src).not.toMatch(/purpose\s*:\s*['"]render['"]/)
    })

    for (const fn of fns.filter((f) => f.exported)) {
      it(`${rel} → ${fn.name}`, () => {
        const allowed = NOT_THROUGH_RESOLVER[rel]?.[fn.name]
        const direct = fn.body.includes('getTenantAuthorizationContext(')
        const viaHelper = [...helpers].some((h) => new RegExp(`\\b${h}\\s*[<(]`).test(fn.body))
        if (allowed) {
          expect(direct || viaHelper, `${fn.name} is allow-listed; remove the entry now that it uses the resolver`).toBe(false)
          return
        }
        expect(direct || viaHelper, `${rel}:${fn.name} must resolve its caller with getTenantAuthorizationContext()`).toBe(true)
      })
    }
  }

  it('every allow-list entry still exists', () => {
    for (const [rel, fns] of Object.entries(NOT_THROUGH_RESOLVER)) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      for (const name of Object.keys(fns)) expect(src, `${rel}:${name}`).toMatch(new RegExp(`export\\s+async\\s+function\\s+${name}\\b`))
    }
  })
})

describe('client-dashboard pages and layouts', () => {
  it('only pages and layouts ask for the render purpose', () => {
    const offenders = files(join(process.cwd(), 'src'))
      .filter((f) => /purpose\s*:\s*['"]render['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(process.cwd(), f).split(sep).join('/'))
      .filter((f) => !/\/(page|layout)\.tsx$/.test(f) && !f.includes('/__tests__/'))
    expect(offenders).toEqual([])
  })
})
