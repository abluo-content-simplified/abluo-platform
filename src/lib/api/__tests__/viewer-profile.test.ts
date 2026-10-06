import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { firstNameOf, getViewerFirstName } from '../viewer-profile'

const ctx = { userId: 'u1', platformRole: 'tenant_user', projects: [] } as never

function client(profileName: unknown, metaName: unknown) {
  const eq = vi.fn(() => ({ maybeSingle: async () => ({ data: profileName === undefined ? null : { full_name: profileName } }) }))
  return {
    eq,
    client: {
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
      auth: { getUser: async () => ({ data: { user: { user_metadata: { full_name: metaName } } } }) },
    },
  }
}

describe('viewer first name', () => {
  it('firstNameOf takes the first word, null when blank', () => {
    expect(firstNameOf('  Paolo Martegani ')).toBe('Paolo')
    expect(firstNameOf('')).toBeNull()
    expect(firstNameOf(null)).toBeNull()
  })
  it("reads the viewer's own profile row", async () => {
    const c = client('Claudia Hoffmann', 'Other')
    await expect(getViewerFirstName(ctx, { client: c.client })).resolves.toBe('Claudia')
    expect(c.eq).toHaveBeenCalledWith('id', 'u1')
  })
  it('falls back to the auth metadata, then null', async () => {
    await expect(getViewerFirstName(ctx, { client: client('', 'Tom Z').client })).resolves.toBe('Tom')
    await expect(getViewerFirstName(ctx, { client: client(undefined, undefined).client })).resolves.toBeNull()
  })
})
