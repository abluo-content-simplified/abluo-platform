/**
 * Drift guard for `src/lib/tenancy/generated/route-config.ts`.
 *
 * ── What this defends ────────────────────────────────────────────────────────
 * The whole point of generating the edge's routing table is that it cannot
 * silently disagree with Supabase. A generated file that nobody re-checks
 * decays into exactly what `proxy.ts`'s `domainMap` is today: a hand-shaped
 * copy that used to be true. This test regenerates from the LIVE database and
 * asserts the checked-in file is byte-identical.
 *
 * It therefore fails in exactly two situations, and both are correct:
 *   - somebody edited the generated file by hand;
 *   - somebody changed a project's slug, domain, locale or status in Supabase
 *     and did not run `node scripts/generate-route-config.mjs`.
 *
 * ── Why it SKIPS instead of failing without credentials ──────────────────────
 * This needs the service-role key and outbound network. A CI runner may have
 * neither, and a unit-test suite that fails on a laptop with no `.env.local` is
 * a suite people learn to ignore — which would cost more than the drift it
 * catches. So: no credentials or no network → the test SKIPS LOUDLY (it logs
 * why) rather than failing.
 *
 * That means a green local `vitest run` is NOT proof of no drift. The real
 * guard is the same check run where credentials exist:
 *
 *     node scripts/generate-route-config.mjs --check   # exit 1 on drift
 *
 * Put that in the deploy pipeline, not only here. A skipping test is a
 * reminder, not a gate, and this comment exists so nobody mistakes it for one.
 *
 * ── Why it imports the generator ─────────────────────────────────────────────
 * It calls `generateRouteConfigSource()` from the script itself rather than
 * re-deriving the shape. A drift test with its own copy of the derivation is a
 * fourth hand-maintained map wearing a test's clothes.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The generator is a plain .mjs ESM module with no side effects on import.
import {
  generateRouteConfigSource,
  normalizeHost as generatorNormalizeHost,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — untyped .mjs build script, deliberately not part of tsconfig.
} from '../../../../scripts/generate-route-config.mjs'

import { normalizeHost as runtimeNormalizeHost } from '../host-scope'

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const GENERATED_PATH = path.join(REPO_ROOT, 'src/lib/tenancy/generated/route-config.ts')

/** Credentials present? Checked without reading or printing any value. */
function hasCredentials(): boolean {
  const envFile = path.join(REPO_ROOT, '.env.local')
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return true
  if (!fs.existsSync(envFile)) return false
  const names = fs
    .readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => l.slice(0, l.indexOf('=')).trim())
  return names.includes('NEXT_PUBLIC_SUPABASE_URL') && names.includes('SUPABASE_SERVICE_ROLE_KEY')
}

describe('generated route-config has not drifted from Supabase', () => {
  it('matches a fresh generation from the live database', async () => {
    if (!hasCredentials()) {
      console.warn(
        '[drift] SKIPPED: no NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. ' +
          'Run `node scripts/generate-route-config.mjs --check` where credentials exist.'
      )
      return
    }

    let fresh: string
    try {
      fresh = (await generateRouteConfigSource()).source
    } catch (err) {
      // Network-less CI, a paused Supabase project, a transient 5xx. Skipping a
      // guard is bad; a flaky red suite that teaches people to re-run until
      // green is worse, and it would hide a real drift the same way.
      console.warn(
        `[drift] SKIPPED: could not reach Supabase (${(err as Error).message}). ` +
          'Run `node scripts/generate-route-config.mjs --check` in an environment with access.'
      )
      return
    }

    const checkedIn = fs.readFileSync(GENERATED_PATH, 'utf8')
    expect(
      checkedIn === fresh,
      'src/lib/tenancy/generated/route-config.ts is out of date. ' +
        'Run: node scripts/generate-route-config.mjs'
    ).toBe(true)
  })

  it('generator and runtime normalise hosts identically', () => {
    // If these two ever disagree the generator can emit a key the resolver can
    // never look up, and the failure is a live domain that silently 404s.
    const cases = [
      'Studiomartegani.COM',
      'www.studiomartegani.com',
      'studiomartegani.com:443',
      'studiomartegani.com.',
      'https://www.LIVENER.net/',
      'nologo.preview.abluo.app',
      'T42.localhost:3000',
      '[::1]:3000',
      '  abluo.app  ',
      '',
    ]
    for (const host of cases) {
      expect(generatorNormalizeHost(host), host).toBe(runtimeNormalizeHost(host))
    }
  })
})
