/**
 * Source-level guards on the boundary between the token-carrying Sanity client
 * and anything that can reach the browser bundle.
 *
 * These are deliberately textual: the risk they cover (a server-only secret
 * ending up in a client chunk) is a property of the MODULE GRAPH, which a
 * runtime unit test cannot observe.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const read = (p: string) => readFileSync(resolve(__dirname, '../../../..', p), 'utf-8')

/**
 * Strip comments before pattern-matching. Every file here documents the very
 * patterns these tests forbid, so matching raw source would fail on prose.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')

const CLIENT = 'src/lib/sanity/client.ts'
const CONFIG = 'src/lib/sanity/config.ts'
const IMAGE = 'src/lib/sanity/image.ts'
const BARREL = 'src/sanity/client.ts'

describe('config.ts is safe to pull into a client bundle', () => {
  it('references no token', () => {
    expect(code(CONFIG)).not.toMatch(/SANITY_API_READ_TOKEN|\btoken\b/i)
  })

  it('reads only NEXT_PUBLIC_ env vars', () => {
    const envReads = code(CONFIG).match(/process\.env\.[A-Z0-9_]+/g) ?? []
    expect(envReads.length).toBeGreaterThan(0)
    for (const r of envReads) expect(r).toMatch(/^process\.env\.NEXT_PUBLIC_/)
  })

  it('imports nothing (no transitive path back to the client)', () => {
    expect(code(CONFIG)).not.toMatch(/^\s*import\s/m)
  })
})

describe('the read token is never public', () => {
  it('is not spelled NEXT_PUBLIC_', () => {
    expect(code(CLIENT)).not.toMatch(/NEXT_PUBLIC_SANITY_API_READ_TOKEN/)
  })

  it('is read exactly once, at module scope', () => {
    const hits = code(CLIENT).match(/process\.env\.SANITY_API_READ_TOKEN/g) ?? []
    expect(hits).toHaveLength(1)
  })
})

describe('the compat barrel does not re-export the raw client', () => {
  const barrel = code(BARREL)

  it('is not a wildcard re-export', () => {
    // `export *` would silently resurface `sanityClient` under a path the
    // eslint no-restricted-imports guard does not cover.
    expect(barrel).not.toMatch(/export\s+\*/)
  })

  it('does not name sanityClient in its export list', () => {
    expect(barrel).not.toMatch(/^\s*sanityClient,?\s*$/m)
  })
})

describe('image.ts is decoupled from the token-carrying client', () => {
  // THE load-bearing invariant of this file. `image.ts` is imported by seven
  // 'use client' components (HeroSection, HeroLensSection, HeroLiveCaptureSection,
  // MediaFeatureSection, MediaContentSection, EventCard, FeaturedEventBlock).
  // While it imported `sanityClient`, the token-carrying module was reachable
  // from the browser bundle and the secret's absence there rested on a Next
  // bundler detail (non-NEXT_PUBLIC_ env reads resolve to undefined) rather
  // than on structure. Decoupled 2026-08-31: it now builds URLs from config.
  //
  // @sanity/image-url only ever constructs CDN URLs — it never authenticates —
  // so projectId + dataset is all it needs. If this test fails, someone has
  // reintroduced the coupling: fix the import, do not relax the assertion.
  it('does not import the Sanity client', () => {
    expect(code(IMAGE)).not.toMatch(/from '@\/lib\/sanity\/client'/)
  })

  it('builds its URL builder from config instead', () => {
    expect(code(IMAGE)).toMatch(/from '@\/lib\/sanity\/config'/)
  })

  it('never references the read token', () => {
    expect(code(IMAGE)).not.toMatch(/SANITY_API_READ_TOKEN/)
  })
})

describe('server-only, if it is ever adopted', () => {
  // A compile-time guard would be stronger than the source-level checks above,
  // but `server-only` is not a dependency of this repo and throws outside the
  // react-server condition, which breaks every vitest suite that loads
  // client.ts. To adopt: npm i server-only, alias it to a no-op in
  // vitest.config, add the import to client.ts — then flip this to a positive
  // assertion. Until then, assert the honest state so the note cannot go stale.
  it('is not currently declared, and the repo does not depend on it', () => {
    expect(/^\s*import 'server-only'/m.test(code(CLIENT))).toBe(false)
    const pkg = JSON.parse(read('package.json'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(deps['server-only']).toBeUndefined()
  })
})
