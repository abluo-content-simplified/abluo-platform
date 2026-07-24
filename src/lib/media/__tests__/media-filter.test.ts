import { describe, expect, it } from 'vitest'
import { buildMediaFilter } from '../media-filter'

describe('buildMediaFilter', () => {
  it('returns the base type clause with no params when nothing is provided', () => {
    const { filter, params } = buildMediaFilter({})
    expect(filter).toBe('_type == "mediaAsset"')
    expect(params).toEqual({})
  })

  it('does not interpolate any request value into the filter string', () => {
    // Injection-style payloads must never appear in the query text.
    const { filter, params } = buildMediaFilter({
      tenant: '") || _type == "client"] { _id } //',
      project: '*',
      tags: ['"] || true || ["'],
      search: '"] { secret } //',
    })
    expect(filter).not.toContain('client')
    expect(filter).not.toContain('secret')
    expect(filter).not.toContain('*')
    // All values are carried as params, not concatenated into the query.
    expect(params.tenant).toBe('") || _type == "client"] { _id } //')
    expect(params.project).toBe('*')
    expect(params.tags).toEqual(['"] || true || ["'])
    expect(params.search).toBe('"] { secret } //')
  })

  it('adds a parameterized tenant clause', () => {
    const { filter, params } = buildMediaFilter({ tenant: 'tenant-123' })
    expect(filter).toBe('_type == "mediaAsset" && tenant._ref == $tenant')
    expect(params).toEqual({ tenant: 'tenant-123' })
  })

  it('adds a parameterized project clause', () => {
    const { filter, params } = buildMediaFilter({ project: 'proj-9' })
    expect(filter).toBe('_type == "mediaAsset" && project._ref == $project')
    expect(params).toEqual({ project: 'proj-9' })
  })

  it('uses an any-of intersection clause for tags', () => {
    const { filter, params } = buildMediaFilter({ tags: ['a', 'b'] })
    expect(filter).toBe('_type == "mediaAsset" && count(tags[@ in $tags]) > 0')
    expect(params).toEqual({ tags: ['a', 'b'] })
  })

  it('ignores an empty tags array', () => {
    const { filter, params } = buildMediaFilter({ tags: [] })
    expect(filter).toBe('_type == "mediaAsset"')
    expect(params).toEqual({})
  })

  it('adds a parameterized multi-field search clause', () => {
    const { filter, params } = buildMediaFilter({ search: 'logo' })
    expect(filter).toContain('altText match $search')
    expect(filter).toContain('description match $search')
    expect(filter).toContain('image.asset->originalFilename match $search')
    expect(filter).toContain('tags[] match $search')
    expect(params).toEqual({ search: 'logo' })
  })

  it('ignores an empty search string', () => {
    const { filter, params } = buildMediaFilter({ search: '' })
    expect(filter).toBe('_type == "mediaAsset"')
    expect(params).toEqual({})
  })

  it('combines all clauses in a stable order', () => {
    const { filter, params } = buildMediaFilter({
      tenant: 't1',
      project: 'p1',
      tags: ['x'],
      search: 'y',
    })
    expect(filter).toBe(
      '_type == "mediaAsset" && tenant._ref == $tenant && project._ref == $project && count(tags[@ in $tags]) > 0 && (altText match $search || description match $search || image.asset->originalFilename match $search || tags[] match $search)'
    )
    expect(params).toEqual({ tenant: 't1', project: 'p1', tags: ['x'], search: 'y' })
  })
})
