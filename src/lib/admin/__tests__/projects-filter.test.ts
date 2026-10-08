import { describe, expect, it } from 'vitest'
import {
  applyProjectFilters,
  countProjectsByStatus,
  DEFAULT_PROJECT_FILTERS,
  foldText,
  isDefaultProjectFilters,
  isProjectStatusFilter,
  liveSiteUrl,
  nextProjectSort,
  previewSiteUrl,
  projectStatusMatches,
  type ProjectFilters,
  type ProjectListRow,
} from '../projects-filter'

const row = (over: Partial<ProjectListRow> & { slug: string }): ProjectListRow => ({
  name: over.slug,
  status: 'active',
  customDomain: null,
  createdAt: '2026-01-01T00:00:00Z',
  client: null,
  owners: [],
  ...over,
})

const PROJECTS: ProjectListRow[] = [
  row({ slug: 'studiomartegani', name: 'Studio Martegani', customDomain: 'studiomartegani.com', client: { name: 'Studio Dentistico', slug: 'studiomartegani' }, createdAt: '2026-03-01T00:00:00Z' }),
  row({ slug: 'hoffmann', name: 'Città Psicoterapia', status: 'preview', client: { name: 'Claudia Hoffmann', slug: 'hoffmann' }, owners: [{ name: 'Claudia', email: 'claudia@example.com' }], createdAt: '2026-05-01T00:00:00Z' }),
  row({ slug: 'old-site', name: 'Old site', status: 'inactive', createdAt: '2025-01-01T00:00:00Z' }),
  row({ slug: 'cyce', name: 'CYCE', status: 'draft', client: { name: 'Cercle Yoga', slug: 'cyce' }, createdAt: '2026-09-01T00:00:00Z' }),
]

const f = (over: Partial<ProjectFilters> = {}): ProjectFilters => ({ ...DEFAULT_PROJECT_FILTERS, ...over })
const slugs = (rows: ProjectListRow[]) => rows.map((r) => r.slug)

describe('admin projects filter', () => {
  it('hides inactive projects by default, shows them with "inactive" or "all"', () => {
    expect(slugs(applyProjectFilters(PROJECTS, f()))).not.toContain('old-site')
    expect(slugs(applyProjectFilters(PROJECTS, f({ status: 'inactive' })))).toEqual(['old-site'])
    expect(applyProjectFilters(PROJECTS, f({ status: 'all' }))).toHaveLength(4)
    expect(projectStatusMatches('someFutureStatus', 'current')).toBe(true)
  })

  it('searches name, slug, domain, client and owners, accent-insensitive, every word', () => {
    expect(slugs(applyProjectFilters(PROJECTS, f({ q: 'citta' })))).toEqual(['hoffmann'])
    expect(slugs(applyProjectFilters(PROJECTS, f({ q: 'martegani.com' })))).toEqual(['studiomartegani'])
    expect(slugs(applyProjectFilters(PROJECTS, f({ q: 'yoga' })))).toEqual(['cyce'])
    expect(slugs(applyProjectFilters(PROJECTS, f({ q: 'claudia@example' })))).toEqual(['hoffmann'])
    expect(slugs(applyProjectFilters(PROJECTS, f({ q: 'studio dentistico' })))).toEqual(['studiomartegani'])
    expect(applyProjectFilters(PROJECTS, f({ q: 'studio yoga' }))).toEqual([])
    expect(slugs(applyProjectFilters(PROJECTS, f({ q: 'old', status: 'current' })))).toEqual([])
  })

  it('sorts by name, status order, client and created date', () => {
    expect(slugs(applyProjectFilters(PROJECTS, f({ status: 'all' })))).toEqual(['hoffmann', 'cyce', 'old-site', 'studiomartegani'])
    expect(slugs(applyProjectFilters(PROJECTS, f({ status: 'all', sort: { column: 'status', dir: 'asc' } })))).toEqual([
      'studiomartegani',
      'hoffmann',
      'cyce',
      'old-site',
    ])
    expect(slugs(applyProjectFilters(PROJECTS, f({ status: 'all', sort: { column: 'created', dir: 'desc' } })))).toEqual([
      'cyce',
      'hoffmann',
      'studiomartegani',
      'old-site',
    ])
    // No client sorts first ascending.
    expect(slugs(applyProjectFilters(PROJECTS, f({ status: 'all', sort: { column: 'client', dir: 'asc' } })))[0]).toBe('old-site')
  })

  it('knows its defaults and toggles sort direction', () => {
    expect(isDefaultProjectFilters(f())).toBe(true)
    expect(isDefaultProjectFilters(f({ q: '  ' }))).toBe(true)
    expect(isDefaultProjectFilters(f({ status: 'all' }))).toBe(false)
    expect(nextProjectSort('created', { column: 'name', dir: 'asc' })).toEqual({ column: 'created', dir: 'desc' })
    expect(nextProjectSort('name', { column: 'name', dir: 'asc' })).toEqual({ column: 'name', dir: 'desc' })
    expect(isProjectStatusFilter('preview')).toBe(true)
    expect(isProjectStatusFilter('nope')).toBe(false)
    expect(isProjectStatusFilter(['preview'])).toBe(false)
  })

  it('counts by status and builds site URLs', () => {
    expect(countProjectsByStatus([...PROJECTS, row({ slug: 'x', status: 'archived' })])).toEqual({ active: 1, preview: 1, draft: 1, inactive: 1, other: 1 })
    expect(previewSiteUrl('hoffmann')).toBe('https://preview.abluo.app/hoffmann')
    expect(liveSiteUrl(' https://StudioMartegani.com/ ')).toBe('https://studiomartegani.com')
    expect(liveSiteUrl('not a domain')).toBeNull()
    expect(liveSiteUrl(null)).toBeNull()
    expect(foldText('Città')).toBe('citta')
  })
})
