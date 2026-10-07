/**
 * The database's closed list of grantable permissions (migration 029,
 * `public.grantable_permissions`) must equal the code's — otherwise the
 * database would accept an extra the code ignores, or refuse one the UI offers.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GRANTABLE_MODULE_PERMISSIONS, PLATFORM_PERMISSIONS } from '../permissions'

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/029_roles_extras_invitations.sql'), 'utf8')

function seededRows(): Array<{ id: string; appliesTo: string; requires: string | null }> {
  const block = SQL.split('insert into public.grantable_permissions')[1].split(';')[0]
  return [...block.matchAll(/\(\s*'([^']+)'\s*,\s*'(tenant|project)'\s*,\s*(null|'[^']+')/g)].map((m) => ({
    id: m[1],
    appliesTo: m[2],
    requires: m[3] === 'null' ? null : m[3].slice(1, -1),
  }))
}

function codeRows(): Array<{ id: string; appliesTo: string; requires: string | null }> {
  const platform = PLATFORM_PERMISSIONS.filter((p) => p.grantable).map((p) => ({
    id: p.id,
    appliesTo: p.defaults.project ? 'project' : 'tenant',
    requires: p.requires ?? null,
  }))
  const modules = Object.entries(GRANTABLE_MODULE_PERMISSIONS).map(([id, r]) => ({ id, appliesTo: 'project', requires: r.requires ?? null }))
  return [...platform, ...modules]
}

describe('grantable permissions — code and database agree', () => {
  it('same ids, same scope, same prerequisites', () => {
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
    expect(seededRows().sort(byId)).toEqual(codeRows().sort(byId))
  })
  it('the seed is not empty (parser sanity)', () => {
    expect(seededRows().length).toBeGreaterThan(0)
  })
})
