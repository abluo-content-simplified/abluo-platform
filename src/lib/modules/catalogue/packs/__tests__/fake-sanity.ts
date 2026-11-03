// In-memory Sanity for the pack service tests: answers the pack state read, the term read, the
// single-project guard and the impact read, and runs transactions atomically (all or nothing) with
// revision guards, createIfNotExists, create, insert, setIfMissing, delete and duplicate
// transaction ids — enough to prove "history exists iff everything exists".
import { vi } from 'vitest'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import type { CatalogueAuditEntry } from '../../audit/events'
import { PACK_STATE_QUERY, type PackServiceDeps } from '../service'

export const SLUG = 'trattoria'
export const P = 'project-a'
export const OWNER = ['catalogue.item.read', 'catalogue.item.write', 'catalogue.taxonomy.write', 'catalogue.setup.manage']
export const EDITOR = ['catalogue.item.read', 'catalogue.item.write', 'catalogue.taxonomy.write']

export const grant = (permissions = OWNER, o: Partial<ProjectGrant> = {}): ProjectGrant => ({ projectId: P, projectSlug: asSupabaseProjectSlug(SLUG), membershipId: 'm1', role: 'owner', permissions, enabledModuleIds: ['catalogue'], ...o })
export const ctxOf = (g: ProjectGrant = grant()): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })

export type Doc = Record<string, unknown> & { _id: string }

export const projectDoc = (config: Record<string, unknown> = { currency: 'EUR' }, extra: Record<string, unknown> = {}): Doc => ({
  _id: 'project-doc',
  _type: 'project',
  projectSlug: SLUG,
  moduleInstallations: [{ _key: 'inst1', moduleId: 'catalogue', enabled: true, config: { _type: 'catalogueModuleConfig', ...config }, ...extra }],
})
export const siteDoc = (locales = ['en', 'it']): Doc => ({ _id: 'site', _type: 'siteConfig', projectSlug: SLUG, defaultLocale: locales[0], supportedLocales: locales })

type Op =
  | { k: 'create' | 'createIfNotExists'; doc: Doc }
  | { k: 'patch'; id: string; v: { ifRevisionID?: string; set?: Record<string, unknown>; setIfMissing?: Record<string, unknown>; insert?: { after: string; items: unknown[] } } }
  | { k: 'delete'; id: string }

function pathParent(doc: Record<string, unknown>, path: string): { parent: Record<string, unknown>; key: string } {
  const m = /^moduleInstallations\[_key=="([^"]+)"\]\.config(?:\.(.+))?$/.exec(path)
  if (m) {
    const inst = (doc.moduleInstallations as Record<string, unknown>[]).find((i) => i._key === m[1])!
    return m[2] ? { parent: inst.config as Record<string, unknown>, key: m[2] } : { parent: inst, key: 'config' }
  }
  const parts = path.split('.')
  let cur = doc
  for (const p of parts.slice(0, -1)) cur = (cur[p] ??= {}) as Record<string, unknown>
  return { parent: cur, key: parts[parts.length - 1] }
}

export function fakeSanity(seed: Doc[], opts: { items?: Doc[] } = {}) {
  const store = new Map<string, Doc>(seed.map((d) => [d._id, { _rev: 'r0', ...structuredClone(d) }]))
  for (const i of opts.items ?? []) store.set(i._id, { _rev: 'r0', ...structuredClone(i) })
  let rev = 0
  const audits: CatalogueAuditEntry[] = []
  const commits: { transactionId?: string; ops: Op[] }[] = []
  const seenTx = new Set<string>()
  let failNext: null | ((n: number) => Error | 'lost' | null) = null
  let commitCount = 0
  const docs = () => [...store.values()].filter((d) => d.projectSlug === SLUG && !(d._type === 'project' && d._id.startsWith('drafts.')))
  const fetch = vi.fn(async (q: string, params: Record<string, unknown> = {}) => {
    await Promise.resolve()
    if (q.startsWith('count(*[_type == "project"')) return 1
    if (q === PACK_STATE_QUERY) {
      const all = docs()
      const project = all.find((d) => d._type === 'project')!
      const site = all.find((d) => d._type === 'siteConfig')
      return {
        site: site ? { defaultLocale: site.defaultLocale, supportedLocales: site.supportedLocales } : null,
        project: { _id: project._id, _rev: project._rev, hasDraft: store.has(`drafts.${project._id}`), inst: (project.moduleInstallations as Record<string, unknown>[]).find((i) => i.moduleId === 'catalogue') },
        taxonomy: store.get(params.taxonomyId as string) ?? null,
        history: store.get(params.historyId as string) ?? null,
        runs: all.filter((d) => d._type === 'cataloguePackRun'),
        collections: all
          .filter((d) => d._type === 'catalogueCollection')
          .map((d) => ({ _id: d._id, _rev: d._rev, name: d.name, slug: d.slug, sectionKeys: ((d.sections as { _key: string }[]) ?? []).map((s) => s._key), full: /^(drafts\.)?catalogue-collection\./.test(d._id) ? d : null })),
        items: all.filter((d) => d._type === 'catalogueItem' && d.slug).map((d) => ({ _id: d._id, slug: d.slug })),
        legacyOfferItems: all.filter((d) => d._type === 'catalogueItem' && Array.isArray(d.offers) && d.offers.length > 0 && !(Array.isArray(d.formats) && d.formats.length > 0)).length,
        optionLists: all.filter((d) => d._type === 'catalogueOptionList').map((d) => ({ _id: d._id, name: d.name })),
        pages: all.filter((d) => d._type === 'page').map((d) => ({ _id: d._id, slug: d.slug })),
      }
    }
    if (q.includes('_type == "taxonomyTerm"')) return []
    if (q.includes('_type == "catalogueItem"')) return docs().filter((d) => d._type === 'catalogueItem' && !d.archivedAt)
    throw new Error(`unexpected query ${q.slice(0, 80)}`)
  })
  const transaction = vi.fn(() => {
    const ops: Op[] = []
    const tx = {
      create: (doc: Doc) => (ops.push({ k: 'create', doc }), tx),
      createIfNotExists: (doc: Doc) => (ops.push({ k: 'createIfNotExists', doc }), tx),
      patch: (id: string, v: Extract<Op, { k: 'patch' }>['v']) => (ops.push({ k: 'patch', id, v }), tx),
      delete: (id: string) => (ops.push({ k: 'delete', id }), tx),
      commit: vi.fn(async (o: { transactionId?: string } = {}) => {
        commitCount++
        const injected = failNext?.(commitCount) ?? null
        if (injected instanceof Error) throw injected
        if (o.transactionId && seenTx.has(o.transactionId)) throw Object.assign(new Error('Transaction ID already used'), { statusCode: 409 })
        const next = new Map([...store].map(([k, v]) => [k, structuredClone(v)]))
        for (const op of ops) {
          if (op.k === 'create') {
            if (next.has(op.doc._id)) throw Object.assign(new Error(`Document "${op.doc._id}" already exists`), { statusCode: 409 })
            next.set(op.doc._id, { ...structuredClone(op.doc), _rev: `r${++rev}` })
          } else if (op.k === 'createIfNotExists') {
            if (!next.has(op.doc._id)) next.set(op.doc._id, { ...structuredClone(op.doc), _rev: `r${++rev}` })
          } else if (op.k === 'delete') next.delete(op.id)
          else if (op.k === 'patch') {
            const doc = next.get(op.id)
            if (!doc) throw Object.assign(new Error(`missing ${op.id}`), { statusCode: 404 })
            if (op.v.ifRevisionID && store.get(op.id)?._rev !== op.v.ifRevisionID) throw Object.assign(new Error('revision mismatch'), { statusCode: 409 })
            for (const [k, v] of Object.entries(op.v.setIfMissing ?? {})) {
              const at = pathParent(doc, k)
              if (at.parent[at.key] === undefined) at.parent[at.key] = structuredClone(v)
            }
            for (const [k, v] of Object.entries(op.v.set ?? {})) {
              const at = pathParent(doc, k)
              at.parent[at.key] = structuredClone(v)
            }
            if (op.v.insert) {
              const path = op.v.insert.after.replace(/\[-1\]$/, '')
              const at = pathParent(doc, path)
              at.parent[at.key] = [...((at.parent[at.key] as unknown[]) ?? []), ...structuredClone(op.v.insert.items)]
            }
            next.set(op.id, { ...doc, _rev: `r${++rev}` })
          }
        }
        store.clear()
        for (const [k, v] of next) store.set(k, v)
        if (o.transactionId) seenTx.add(o.transactionId)
        commits.push({ transactionId: o.transactionId, ops: structuredClone(ops) })
        if (injected === 'lost') throw Object.assign(new Error('socket hang up (timeout)'), { code: 'ECONNRESET' })
        return {}
      }),
    }
    return tx
  })
  const deps: PackServiceDeps = { client: { fetch, transaction } as never, now: () => new Date('2026-11-03T09:00:00Z'), audit: async (e) => void audits.push(e) }
  return {
    store,
    deps,
    audits,
    commits,
    calls: () => fetch.mock.calls.length + transaction.mock.calls.length,
    failOn: (fn: ((n: number) => Error | 'lost' | null) | null) => ((failNext = fn), (commitCount = 0)),
    config: () => ((store.get('project-doc')!.moduleInstallations as Record<string, unknown>[])[0].config ?? null) as Record<string, unknown>,
    bump: (id: string) => store.set(id, { ...store.get(id)!, _rev: `r${++rev}` }),
  }
}
