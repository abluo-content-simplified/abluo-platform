/**
 * Private-dataset readiness — the proof behind "nothing breaks when the Sanity
 * datasets are flipped from public to private"
 * (docs/engineering/sanity-private-dataset.md).
 *
 * A private dataset rejects every request that carries no token. So the flip
 * is safe if and only if:
 *
 *   1. every SERVER read goes through a client that carries a token when one
 *      is configured                                       (§1, §2 below), and
 *   2. NOTHING reads Sanity from the BROWSER with an anonymous client — no
 *      'use client' module (and nothing Sanity Studio bundles) reaches a
 *      server Sanity client, `@sanity/client`, or a raw api.sanity.io URL (§3).
 *
 * Sanity Studio's own `useClient()` is exempt by construction: it carries the
 * signed-in Sanity user's session, and Studio users are project members.
 * Image/file CDN URLs (cdn.sanity.io) are not query reads and stay public.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join, relative, resolve, dirname } from 'path'

type SanityConfig = Record<string, unknown>
const createClientMock = vi.fn((config: SanityConfig) => ({ fetch: vi.fn(), config }))
vi.mock('@sanity/client', () => ({
  createClient: (config: SanityConfig) => createClientMock(config),
}))

const ROOT = resolve(__dirname, '../../../..')
const SRC = join(ROOT, 'src')

const ENV_KEYS = ['SANITY_API_READ_TOKEN', 'SANITY_API_WRITE_TOKEN'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

async function serverClientConfigs() {
  vi.resetModules()
  createClientMock.mockClear()
  await import('@/lib/sanity/server-clients')
  const [write, read] = createClientMock.mock.calls.map((c) => c[0])
  return { write, read }
}

// ── §1 the website/dashboard client ─────────────────────────────────────────
// Pinned in detail by client-read-token.test.ts; restated here so this file
// alone answers "does every server read carry the token?".
describe('§1 sanityClient (website, dashboard, sitemap, llms.txt, forms, notifications)', () => {
  it('carries SANITY_API_READ_TOKEN when it is set', async () => {
    process.env.SANITY_API_READ_TOKEN = 'sk-read'
    vi.resetModules()
    createClientMock.mockClear()
    await import('@/lib/sanity/client')
    expect(createClientMock.mock.calls[0][0].token).toBe('sk-read')
  })
})

// ── §2 the admin/service clients ────────────────────────────────────────────
describe('§2 server-clients (media library, admin document lookup)', () => {
  it('read client uses the write token when present', async () => {
    process.env.SANITY_API_WRITE_TOKEN = 'sk-write'
    process.env.SANITY_API_READ_TOKEN = 'sk-read'
    const { write, read } = await serverClientConfigs()
    expect(write.token).toBe('sk-write')
    expect(read.token).toBe('sk-write')
  })

  it('read client falls back to the read token (write token unset)', async () => {
    process.env.SANITY_API_READ_TOKEN = 'sk-read'
    const { write, read } = await serverClientConfigs()
    expect(read.token).toBe('sk-read')
    expect(write).not.toHaveProperty('token')
  })

  it('with no token at all is the anonymous pre-flip client (no token key)', async () => {
    const { write, read } = await serverClientConfigs()
    expect(read).not.toHaveProperty('token')
    expect(write).not.toHaveProperty('token')
    expect(read.useCdn).toBe(false)
    expect(read.apiVersion).toBe('2026-05-21')
  })

  it('never sets a perspective (API default at 2026-05-21 is `published`: no drafts)', async () => {
    process.env.SANITY_API_WRITE_TOKEN = 'sk-write'
    const { write, read } = await serverClientConfigs()
    expect(read).not.toHaveProperty('perspective')
    expect(write).not.toHaveProperty('perspective')
  })
})

// ── §3 source-level: who may construct a client, and the browser graph ─────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue
      walk(p, out)
    } else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const ALL = walk(SRC)
const rel = (p: string) => relative(ROOT, p)

/** Files allowed to construct a `@sanity/client` instance. */
const CLIENT_FACTORIES = new Set([
  'src/lib/sanity/client.ts',
  'src/lib/sanity/server-clients.ts',
])
/** One-off CLI migrations: run by hand with their own token, never bundled. */
const isCliMigration = (p: string) => rel(p).startsWith('src/lib/sanity/migrations/')

describe('§3a only the two factories construct a Sanity client', () => {
  it('no other file in src/ imports @sanity/client', () => {
    const offenders = ALL.filter((f) => !isCliMigration(f) && !CLIENT_FACTORIES.has(rel(f)))
      .filter((f) => /from\s*['"]@sanity\/client['"]/.test(stripComments(readFileSync(f, 'utf-8'))))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('no file in src/ calls the Sanity HTTP API directly', () => {
    const offenders = ALL.filter((f) => /api\.sanity\.io|apicdn\.sanity\.io/.test(stripComments(readFileSync(f, 'utf-8'))))
      .map(rel)
    expect(offenders).toEqual([])
  })
})

const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx']

function resolveSpec(spec: string, from: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null
  for (const ext of RESOLVE_EXT) {
    const p = base + ext
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  return null
}

/** Value (non-type-only) import specifiers of a module. */
function valueImports(source: string): string[] {
  const s = stripComments(source)
  const specs: string[] = []
  const fromRe = /(?:^|[;\n])\s*(?:import|export)\s+(?!type\b)([^'"]*?)\s+from\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = fromRe.exec(s))) specs.push(m[2])
  const bare = /(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g
  while ((m = bare.exec(s))) specs.push(m[1])
  const dyn = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = dyn.exec(s))) specs.push(m[1])
  return specs
}

/**
 * A 'use server' module imported by a client component is a Server Action
 * boundary: the browser bundle receives only an RPC stub, never the module's
 * imports. The walk stops there.
 */
const isServerActionModule = (f: string) =>
  /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*['"]use server['"]/.test(readFileSync(f, 'utf-8'))

const isClientModule = (f: string) =>
  /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*['"]use client['"]/.test(readFileSync(f, 'utf-8'))

/** Modules whose presence in a browser bundle means an anonymous Sanity read. */
const SERVER_SANITY = new Set([
  'src/lib/sanity/client.ts',
  'src/lib/sanity/server-clients.ts',
  'src/lib/api/tenant-scoped-sanity.ts',
  'src/sanity/client.ts',
])

describe('§3b nothing a browser bundle contains reads Sanity anonymously', () => {
  const entries = [...ALL.filter(isClientModule), join(ROOT, 'sanity.config.ts')]

  it('finds the browser entry points (non-vacuous)', () => {
    expect(entries.length).toBeGreaterThan(20)
  })

  it('no browser entry point reaches a server Sanity client or @sanity/client', () => {
    const violations: string[] = []
    for (const entry of entries) {
      const seen = new Set<string>()
      const stack: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [rel(entry)] }]
      while (stack.length) {
        const { file, chain } = stack.pop()!
        if (seen.has(file)) continue
        seen.add(file)
        if (file !== entry && isServerActionModule(file)) continue
        if (SERVER_SANITY.has(rel(file))) {
          violations.push(chain.join(' → '))
          continue
        }
        for (const spec of valueImports(readFileSync(file, 'utf-8'))) {
          if (spec === '@sanity/client') {
            violations.push([...chain, '@sanity/client'].join(' → '))
            continue
          }
          const next = resolveSpec(spec, file)
          if (next && /\.(ts|tsx|js|mjs)$/.test(next)) stack.push({ file: next, chain: [...chain, rel(next)] })
        }
      }
    }
    expect(violations).toEqual([])
  })
})
