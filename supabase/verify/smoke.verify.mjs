import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startHarness, stopHarness } from './lib/harness.mjs'

let client

beforeAll(async () => {
  ;({ client } = await startHarness())
}, 60_000)

afterAll(async () => {
  await stopHarness(client)
}, 30_000)

describe('harness smoke test', () => {
  it('boots and applies schema.sql + migrations 006-013', async () => {
    const { rows } = await client.query(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`
    )
    const names = rows.map((r) => r.table_name)
    expect(names).toEqual(
      expect.arrayContaining(['tenants', 'profiles', 'tenant_members', 'leads', 'projects', 'project_members', 'inquiries'])
    )
  })

  it('the authenticated role has no grant on inquiries yet (pre-014 state)', async () => {
    const { rows } = await client.query(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'inquiries' and grantee = 'authenticated'`
    )
    expect(rows).toEqual([])
  })
})
