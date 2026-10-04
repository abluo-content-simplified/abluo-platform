import { describe, it, expect } from 'vitest'
import {
  acceptableNext,
  localeOfPath,
  platformLocale,
  postLoginDestination,
  type PostLoginInput,
} from '../post-login'
import { routing } from '@/i18n/routing'

const CFG = { locales: routing.locales, defaultLocale: routing.defaultLocale }
// Two platform locales that are NOT the default, picked from the registry so
// the tests never assume which languages exist.
const [OTHER, THIRD] = routing.locales.filter((l) => l !== routing.defaultLocale)

function input(over: Partial<PostLoginInput>): PostLoginInput {
  return {
    hasUser: true,
    platformRole: 'tenant_user',
    currentLevel: null,
    next: null,
    cookieLocale: null,
    acceptLanguage: null,
    ...CFG,
    ...over,
  }
}

describe('postLoginDestination — who goes where', () => {
  it('no user → /login (carrying a safe next)', () => {
    expect(postLoginDestination(input({ hasUser: false, platformRole: null }))).toBe('/login')
    expect(postLoginDestination(input({ hasUser: false, platformRole: null, next: `/${OTHER}/dashboard` }))).toBe(
      `/login?next=${encodeURIComponent(`/${OTHER}/dashboard`)}`
    )
  })

  it('tenant user → /<locale>/account (never a bare /account)', () => {
    expect(postLoginDestination(input({}))).toBe(`/${routing.defaultLocale}/account`)
  })

  it('tenant user honours a safe next that is not admin-only', () => {
    expect(postLoginDestination(input({ next: `/${OTHER}/livener/posts` }))).toBe(`/${OTHER}/livener/posts`)
  })

  it('tenant user with an admin-only next goes to their own account, in that locale', () => {
    expect(postLoginDestination(input({ next: `/${OTHER}/dashboard` }))).toBe(`/${OTHER}/account`)
    expect(postLoginDestination(input({ next: '/studio/structure' }))).toBe(`/${routing.defaultLocale}/account`)
  })

  it('admin at aal1 WITH a verified factor → /mfa?next=<dashboard> (challenge)', () => {
    expect(postLoginDestination(input({ platformRole: 'abluo_admin', currentLevel: 'aal1' }))).toBe(
      `/mfa?next=${encodeURIComponent(`/${routing.defaultLocale}/dashboard`)}`
    )
  })

  it('admin at aal1 WITHOUT a factor → also /mfa (the page enrolls) — the route never skips 2FA', () => {
    // Without a factor Supabase reports aal1 as well; an unreadable level is null.
    for (const currentLevel of ['aal1', null, undefined, 'weird']) {
      expect(postLoginDestination(input({ platformRole: 'abluo_admin', currentLevel, next: '/studio' }))).toBe(
        `/mfa?next=${encodeURIComponent('/studio')}`
      )
    }
  })

  it('admin at aal2 → the dashboard, or a safe next', () => {
    expect(postLoginDestination(input({ platformRole: 'abluo_admin', currentLevel: 'aal2' }))).toBe(
      `/${routing.defaultLocale}/dashboard`
    )
    expect(postLoginDestination(input({ platformRole: 'abluo_admin', currentLevel: 'aal2', next: '/studio' }))).toBe('/studio')
  })

  it('unwraps /mfa?next=X so the original target survives a sign-in from the MFA page', () => {
    const next = `/mfa?next=${encodeURIComponent(`/${OTHER}/media`)}`
    expect(postLoginDestination(input({ platformRole: 'abluo_admin', currentLevel: 'aal1', next }))).toBe(
      `/mfa?next=${encodeURIComponent(`/${OTHER}/media`)}`
    )
  })
})

describe('postLoginDestination — unsafe next is ignored', () => {
  const unsafe = [
    '//evil.example', 'https://evil.example', '/\\evil.example', 'evil', '',
    '/login', '/login?next=/x', '/auth/continue', '/auth/continue?next=/x', '/auth/callback',
    '/mfa?next=//evil.example', '/x\u0000y', '/a\\b',
  ]
  it.each(unsafe)('%s', (next) => {
    expect(acceptableNext(next)).toBeNull()
    expect(postLoginDestination(input({ next }))).toBe(`/${routing.defaultLocale}/account`)
    expect(postLoginDestination(input({ platformRole: 'abluo_admin', currentLevel: 'aal2', next }))).toBe(
      `/${routing.defaultLocale}/dashboard`
    )
  })
})

describe('locale selection', () => {
  it('prefers the locale named by a safe next', () => {
    expect(
      postLoginDestination(input({ next: `/${OTHER}/dashboard`, cookieLocale: THIRD }))
    ).toBe(`/${OTHER}/account`)
  })

  it('else the NEXT_LOCALE cookie, when it is a platform locale', () => {
    expect(postLoginDestination(input({ cookieLocale: OTHER, acceptLanguage: `${THIRD}` }))).toBe(`/${OTHER}/account`)
  })

  it('else the first Accept-Language the platform offers', () => {
    expect(postLoginDestination(input({ acceptLanguage: `xx-YY, ${THIRD};q=0.9, ${OTHER};q=0.8` }))).toBe(
      `/${THIRD}/account`
    )
    expect(
      postLoginDestination(input({ platformRole: 'abluo_admin', currentLevel: 'aal2', acceptLanguage: `${OTHER}-XX` }))
    ).toBe(`/${OTHER}/dashboard`)
  })

  it('else the platform default — and an unknown cookie never leaks into the URL', () => {
    expect(postLoginDestination(input({ cookieLocale: 'xx', acceptLanguage: 'zz' }))).toBe(
      `/${routing.defaultLocale}/account`
    )
  })

  it('helpers', () => {
    expect(localeOfPath(`/${OTHER}/account?x=1`, CFG.locales)).toBe(OTHER)
    expect(localeOfPath('/account', CFG.locales)).toBeNull()
    expect(localeOfPath('/xx/account', CFG.locales)).toBeNull()
    expect(platformLocale({}, CFG)).toBe(routing.defaultLocale)
  })
})
