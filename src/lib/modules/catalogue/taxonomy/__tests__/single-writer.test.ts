/**
 * K-4 / C1.11 `surface/single-writer` / C8 P-16, P-21 — CatalogueTaxonomyService is the ONLY
 * writer of Catalogue categories and tags:
 *   - static scan of src/: no other file writes the `catalogue-taxonomy.<slug>` document;
 *   - the Catalogue manifest declares no `taxonomies`, so the generic taxonomy service refuses
 *     it (`kind_not_declared`) and Categories & Tags has no Catalogue tab;
 *   - the shared TermPicker routes Catalogue terms to the Catalogue service (inline creation =
 *     the same call as Setup), and the Studio cannot create or edit Catalogue terms (R2 lock).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { manageableTaxonomyModules } from '@/lib/taxonomy/manageable'
import { TaxonomyError, createTerm, listTerms } from '@/lib/taxonomy/service'
import { taxonomyModules } from '@/lib/taxonomy/studio'
import { catalogueReadOnly } from '@/lib/sanity/studio/catalogue-posture'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const SRC = join(process.cwd(), 'src')
const rel = (f: string) => relative(SRC, f).split(sep).join('/')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') walk(full, out)
    } else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full)
  }
  return out
}
const FILES = walk(SRC).map((f) => ({ rel: rel(f), text: readFileSync(f, 'utf8') }))

/** The one writer (and the pure helpers it commits through). */
const WRITERS = ['lib/modules/catalogue/taxonomy/service.ts']
/** A Sanity write primitive. */
const WRITE = /\.(patch|create|createIfNotExists|createOrReplace|delete|mutate)\s*\(|\.transaction\s*\(/
/** Names the Catalogue taxonomy document. */
const NAMES_DOC = /catalogueTaxonomyId\s*\(|CATALOGUE_TAXONOMY_ID_PREFIX|['"`]catalogue-taxonomy\.|_type:\s*['"]catalogueTaxonomy['"]|CATALOGUE_TAXONOMY_TYPE/

describe('K-4 — static scan of src/', () => {
  it('only CatalogueTaxonomyService both names the Catalogue taxonomy document and writes', () => {
    const offenders = FILES.filter((f) => !WRITERS.includes(f.rel) && NAMES_DOC.test(f.text) && WRITE.test(f.text)).map((f) => f.rel)
    expect(offenders).toEqual([])
    // The detector is live: it does see the one writer.
    const writer = FILES.find((f) => f.rel === WRITERS[0])!.text
    expect(NAMES_DOC.test(writer) && WRITE.test(writer)).toBe(true)
  })

  it('the writer stamps every mutation with an abluo-setup- transaction id (C9 writer prefixes)', () => {
    const service = FILES.find((f) => f.rel === WRITERS[0])!.text
    expect(service).toMatch(/catalogueTransactionId\('setup'/)
    expect(service).not.toMatch(/catalogueTransactionId\('(dash|pack|gate|migr)'/)
    // Every commit passes a transaction id.
    const commits = service.match(/\.commit\(([^)]*)\)/g) ?? []
    expect(commits.length).toBeGreaterThan(0)
    for (const c of commits) expect(c).toMatch(/transactionId/)
  })

  it('no dashboard code writes Catalogue taxonomyTerm records through the generic actions with a literal "catalogue" module', () => {
    const generic = /create(?:Taxonomy)?Term(?:Action)?\(\s*\{[^}]*module:\s*['"]catalogue['"]/
    expect(FILES.filter((f) => generic.test(f.text)).map((f) => f.rel)).toEqual([])
  })

  it('P-21: the shared TermPicker sends Catalogue terms to the Catalogue service, the same call as Setup', () => {
    const picker = FILES.find((f) => f.rel === 'components/client/taxonomy/TermPicker.tsx')!.text
    expect(picker).toMatch(/module === 'catalogue' \? await createCatalogueTermInlineAction/)
    const actions = FILES.find((f) => f.rel === 'app/[locale]/(client)/[tenant]/catalogue/setup/taxonomy-actions.ts')!.text
    const inline = actions.slice(actions.indexOf('export async function createCatalogueTermInlineAction'))
    expect(inline).toMatch(/createCategory\(ctx, pid,/)
    expect(inline).toMatch(/createTag\(ctx, pid,/)
  })
})

describe('the generic taxonomy machinery refuses the Catalogue (P-16)', () => {
  const grant: ProjectGrant = {
    projectId: 'p',
    projectSlug: asSupabaseProjectSlug('tmz'),
    membershipId: 'm',
    role: 'owner',
    permissions: ['catalogue.item.read', 'catalogue.taxonomy.write'],
    enabledModuleIds: ['catalogue'],
  }
  const ctx: TenantAuthorizationContext = { userId: 'u', platformRole: 'tenant_user', projects: [grant] }
  const client = { fetch: vi.fn(), getDocument: vi.fn(), createIfNotExists: vi.fn(), patch: vi.fn(), transaction: vi.fn(), delete: vi.fn() }

  it('the manifest declares no taxonomies; the manager and the Studio term panes never list it', () => {
    expect(MODULE_REGISTRY.find((m) => m.id === 'catalogue')!.taxonomies).toBeUndefined()
    expect(manageableTaxonomyModules(grant).map((m) => m.module)).not.toContain('catalogue')
    expect(taxonomyModules(MODULE_REGISTRY).map((m) => m.id)).not.toContain('catalogue')
  })

  it('createTerm / listTerms with module "catalogue" → kind_not_declared, before any Sanity call', async () => {
    for (const run of [() => createTerm(ctx, 'p', 'catalogue', 'category', { labels: { en: 'X' } }, { client: client as never }), () => listTerms(ctx, 'p', 'catalogue', 'tag', { client: client as never })]) {
      const e = await run().catch((x) => x)
      expect(e).toBeInstanceOf(TaxonomyError)
      expect((e as TaxonomyError).code).toBe('kind_not_declared')
    }
    expect(client.fetch).not.toHaveBeenCalled()
  })

  it('Studio: a Catalogue taxonomyTerm is read-only (C9 R2 lock); other modules keep theirs', () => {
    const state = { grants: [], loaded: true }
    const now = new Date('2026-11-03T10:00:00Z')
    expect(catalogueReadOnly({ type: 'taxonomyTerm', doc: { module: 'catalogue', projectSlug: 'tmz' }, state, now })).toBe(true)
    expect(catalogueReadOnly({ type: 'taxonomyTerm', doc: { module: 'blog', projectSlug: 'tmz' }, state, now })).toBe(false)
    expect(catalogueReadOnly({ type: 'catalogueTaxonomy', doc: { projectSlug: 'tmz' }, state, now })).toBe(true)
  })
})
