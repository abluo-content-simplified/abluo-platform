/**
 * GET /auth/continue — the route's I/O half: it must read the session with
 * getUser() (and the AAL only for an admin) and redirect where
 * postLoginDestination() says. Supabase is mocked; no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { routing } from '@/i18n/routing'

const state: {
  user: { id: string; app_metadata: Record<string, unknown> } | null
  aal: string | null
  aalCalls: number
} = { user: null, aal: null, aalCalls: 0 }

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => {
          state.aalCalls++
          return { data: { currentLevel: state.aal }, error: null }
        },
      },
    },
  }),
}))

import { GET } from '@/app/(platform)/auth/continue/route'

const OTHER = routing.locales.find((l) => l !== routing.defaultLocale)!

async function land(path: string, headers: Record<string, string> = {}) {
  const res = await GET(new NextRequest(new URL(`https://preview.abluo.app${path}`), { headers }))
  expect(res.status).toBe(303)
  const loc = new URL(res.headers.get('location')!)
  expect(loc.origin).toBe('https://preview.abluo.app') // never off-origin
  return loc.pathname + loc.search
}

beforeEach(() => {
  state.user = null
  state.aal = null
  state.aalCalls = 0
})

describe('GET /auth/continue', () => {
  it('unauthenticated → /login', async () => {
    expect(await land('/auth/continue')).toBe('/login')
    expect(state.aalCalls).toBe(0)
  })

  it('tenant user → localized account, AAL never read', async () => {
    state.user = { id: 'u', app_metadata: {} }
    expect(await land('/auth/continue', { 'accept-language': OTHER })).toBe(`/${OTHER}/account`)
    expect(state.aalCalls).toBe(0)
  })

  it('admin at aal1 → /mfa carrying the dashboard', async () => {
    state.user = { id: 'a', app_metadata: { platform_role: 'abluo_admin' } }
    state.aal = 'aal1'
    expect(await land('/auth/continue')).toBe(
      `/mfa?next=${encodeURIComponent(`/${routing.defaultLocale}/dashboard`)}`
    )
  })

  it('admin at aal2 → the explicit next', async () => {
    state.user = { id: 'a', app_metadata: { platform_role: 'abluo_admin' } }
    state.aal = 'aal2'
    expect(await land(`/auth/continue?next=${encodeURIComponent(`/${OTHER}/media`)}`)).toBe(`/${OTHER}/media`)
  })

  it('an open-redirect next is ignored', async () => {
    state.user = { id: 'a', app_metadata: { platform_role: 'abluo_admin' } }
    state.aal = 'aal2'
    expect(await land('/auth/continue?next=//evil.example')).toBe(`/${routing.defaultLocale}/dashboard`)
  })

  it('NEXT_LOCALE cookie picks the locale', async () => {
    state.user = { id: 'u', app_metadata: {} }
    expect(await land('/auth/continue', { cookie: `NEXT_LOCALE=${OTHER}` })).toBe(`/${OTHER}/account`)
  })
})
