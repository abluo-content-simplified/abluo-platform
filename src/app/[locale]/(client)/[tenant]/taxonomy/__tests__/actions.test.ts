/**
 * Categories & Tags server actions (slice 3): identity and grant come from the
 * shared resolveProjectAction helper, failures collapse to opaque codes, and
 * the project id handed to the service is the GRANT's — never the caller's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const access = vi.fn()
vi.mock('@/lib/api/project-action', () => ({ resolveProjectAction: (slug: unknown) => access(slug) }))
vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))
const revalidate = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath: revalidate }))

const service = vi.hoisted(() => ({ listTerms: vi.fn(), createTerm: vi.fn(), updateTerm: vi.fn(), reorderTerms: vi.fn(), deleteTerm: vi.fn(), termUsage: vi.fn() }))
vi.mock('@/lib/taxonomy/service', async (orig) => ({ ...((await orig()) as object), ...service }))

import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { TaxonomyError } from '@/lib/taxonomy/service'
import {
  createTaxonomyTermAction,
  deleteTaxonomyTermAction,
  getTaxonomyTermUsageAction,
  listTaxonomyTermsAction,
  reorderTaxonomyTermsAction,
  updateTaxonomyTermAction,
} from '../actions'

const ctx = { userId: 'u1', projects: [] }
const scope = { projectSlug: 'trattoria', module: 'catalogue', kind: 'category' }

beforeEach(() => {
  vi.clearAllMocks()
  access.mockResolvedValue({ ok: true, ctx, grant: { projectId: 'project-a' } })
})

describe('taxonomy actions', () => {
  it('pass the grant project id and the caller input to the service', async () => {
    service.createTerm.mockResolvedValue({ term: { key: 'poesia' }, created: true })
    const r = await createTaxonomyTermAction({ ...scope, labels: { it: 'Poesia' } })
    expect(r).toMatchObject({ ok: true, created: true, term: { key: 'poesia' } })
    expect(service.createTerm).toHaveBeenCalledWith(ctx, 'project-a', 'catalogue', 'category', { labels: { it: 'Poesia' }, color: undefined })

    service.listTerms.mockResolvedValue({ terms: [] })
    expect(await listTaxonomyTermsAction(scope)).toMatchObject({ ok: true, list: { terms: [] } })
    service.updateTerm.mockResolvedValue({ term: { key: 'poesia' } })
    await updateTaxonomyTermAction({ ...scope, key: 'poesia', labels: { en: 'Poetry' }, nextKey: 'x', rev: 'r1' })
    expect(service.updateTerm).toHaveBeenCalledWith(ctx, 'project-a', 'catalogue', 'category', 'poesia', { labels: { en: 'Poetry' }, color: undefined, nextKey: 'x', rev: 'r1' })
    service.reorderTerms.mockResolvedValue({ order: [] })
    await reorderTaxonomyTermsAction({ ...scope, keys: ['a'] })
    expect(service.reorderTerms).toHaveBeenCalledWith(ctx, 'project-a', 'catalogue', 'category', ['a'])
    service.deleteTerm.mockResolvedValue({ key: 'a' })
    expect(await deleteTaxonomyTermAction({ ...scope, key: 'a' })).toMatchObject({ ok: true, key: 'a' })
  })

  it('an anonymous caller is unauthenticated and the service is never reached', async () => {
    access.mockResolvedValue({ ok: false, error: 'unauthenticated' })
    for (const r of [
      await listTaxonomyTermsAction(scope),
      await createTaxonomyTermAction({ ...scope, labels: { it: 'x' } }),
      await updateTaxonomyTermAction({ ...scope, key: 'a' }),
      await reorderTaxonomyTermsAction({ ...scope, keys: [] }),
      await deleteTaxonomyTermAction({ ...scope, key: 'a' }),
    ]) {
      expect(r).toMatchObject({ ok: false, error: 'unauthenticated' })
    }
    expect(Object.values(service).every((f) => f.mock.calls.length === 0)).toBe(true)
  })

  it('a project the caller cannot reach is forbidden', async () => {
    access.mockResolvedValue({ ok: false, error: 'forbidden' })
    expect(await deleteTaxonomyTermAction({ ...scope, key: 'a' })).toMatchObject({ ok: false, error: 'forbidden' })
    expect(service.deleteTerm).not.toHaveBeenCalled()
  })

  it('maps a permission refusal to forbidden, a taxonomy error to its code + detail, anything else to failed', async () => {
    service.createTerm.mockRejectedValueOnce(new TenantAuthorizationError('no'))
    expect(await createTaxonomyTermAction({ ...scope, labels: { it: 'x' } })).toMatchObject({ ok: false, error: 'forbidden' })
    const detail = { count: 2, items: [{ id: 'i1', type: 'catalogueItem', name: 'Margherita' }] }
    service.deleteTerm.mockRejectedValueOnce(new TaxonomyError('in_use', 'used', detail))
    expect(await deleteTaxonomyTermAction({ ...scope, key: 'a' })).toMatchObject({ ok: false, error: 'in_use', detail })
    service.deleteTerm.mockRejectedValueOnce(new Error('boom'))
    expect(await deleteTaxonomyTermAction({ ...scope, key: 'a' })).toMatchObject({ ok: false, error: 'failed' })
  })

  it('a missing input object still resolves through the helper', async () => {
    access.mockResolvedValue({ ok: false, error: 'forbidden' })
    // @ts-expect-error malformed call from a client
    expect(await listTaxonomyTermsAction(undefined)).toMatchObject({ ok: false, error: 'forbidden' })
    expect(access).toHaveBeenCalledWith(undefined)
  })

  it('a successful write refreshes the taxonomy screen and the module pages; a refused one does not', async () => {
    service.createTerm.mockResolvedValue({ term: { key: 'poesia' }, created: true })
    await createTaxonomyTermAction({ ...scope, labels: { it: 'Poesia' } })
    expect(revalidate).toHaveBeenCalledWith('/[locale]/[tenant]/taxonomy', 'page')
    expect(revalidate).toHaveBeenCalledWith('/[locale]/[tenant]/catalogue', 'layout')
    revalidate.mockClear()
    service.deleteTerm.mockRejectedValueOnce(new TaxonomyError('in_use', 'used', { count: 1, items: [] }))
    await deleteTaxonomyTermAction({ ...scope, key: 'a' })
    await listTaxonomyTermsAction(scope)
    expect(revalidate).not.toHaveBeenCalled()
    service.reorderTerms.mockResolvedValue({ order: [] })
    await reorderTaxonomyTermsAction({ ...scope, keys: [] })
    service.updateTerm.mockResolvedValue({ term: { key: 'a' } })
    await updateTaxonomyTermAction({ ...scope, key: 'a', labels: { it: 'A' } })
    service.deleteTerm.mockResolvedValue({ key: 'a' })
    await deleteTaxonomyTermAction({ ...scope, key: 'a' })
    expect(revalidate).toHaveBeenCalledTimes(6)
  })

  it('the usage action only reads: it reaches termUsage with the grant project and never refreshes', async () => {
    service.termUsage.mockResolvedValue({ count: 2, items: [{ id: 'i1', type: 'catalogueItem', name: 'Margherita' }] })
    expect(await getTaxonomyTermUsageAction({ ...scope, key: 'poesia' })).toMatchObject({ ok: true, usage: { count: 2 } })
    expect(service.termUsage).toHaveBeenCalledWith(ctx, 'project-a', 'catalogue', 'category', 'poesia')
    expect(revalidate).not.toHaveBeenCalled()
    access.mockResolvedValue({ ok: false, error: 'unauthenticated' })
    expect(await getTaxonomyTermUsageAction({ ...scope, key: 'poesia' })).toMatchObject({ ok: false, error: 'unauthenticated' })
  })
})
