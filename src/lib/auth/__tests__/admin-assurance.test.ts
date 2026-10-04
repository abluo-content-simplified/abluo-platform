import { describe, it, expect } from 'vitest'
import {
  adminGateDecision,
  mfaRedirectPath,
  normalizeAssuranceLevel,
  readAssuranceLevel,
  safeNextPath,
} from '../admin-assurance'

describe('adminGateDecision — admin surfaces require AAL2', () => {
  it('no session → login', () => {
    expect(adminGateDecision({ hasUser: false, platformRole: null, currentLevel: 'aal2' })).toBe('login')
  })

  it('tenant user → unauthorized, whatever their AAL (tenant users are unaffected by MFA)', () => {
    for (const lvl of ['aal1', 'aal2', null] as const) {
      expect(adminGateDecision({ hasUser: true, platformRole: 'tenant_user', currentLevel: lvl })).toBe('unauthorized')
    }
  })

  it('admin with a password-only (aal1) session → mfa', () => {
    expect(adminGateDecision({ hasUser: true, platformRole: 'abluo_admin', currentLevel: 'aal1' })).toBe('mfa')
  })

  it('admin at aal2 → allow', () => {
    expect(adminGateDecision({ hasUser: true, platformRole: 'abluo_admin', currentLevel: 'aal2' })).toBe('allow')
  })

  it('fails closed on any unexpected level', () => {
    for (const lvl of [null, undefined, '', 'AAL2', 'aal3', ' aal2']) {
      expect(adminGateDecision({ hasUser: true, platformRole: 'abluo_admin', currentLevel: lvl })).toBe('mfa')
    }
  })
})

describe('normalizeAssuranceLevel', () => {
  it('accepts only the two exact strings', () => {
    expect(normalizeAssuranceLevel('aal2')).toBe('aal2')
    expect(normalizeAssuranceLevel('aal1')).toBe('aal1')
    expect(normalizeAssuranceLevel('aal3')).toBeNull()
    expect(normalizeAssuranceLevel(2)).toBeNull()
  })
})

describe('readAssuranceLevel', () => {
  const reader = (impl: () => Promise<unknown>) =>
    ({ auth: { mfa: { getAuthenticatorAssuranceLevel: impl } } }) as Parameters<typeof readAssuranceLevel>[0]

  it('returns the current level', async () => {
    expect(await readAssuranceLevel(reader(async () => ({ data: { currentLevel: 'aal2' }, error: null })))).toBe('aal2')
  })

  it('is null (fail-closed) on an error, a missing payload, or a throw', async () => {
    expect(await readAssuranceLevel(reader(async () => ({ data: { currentLevel: 'aal2' }, error: new Error('x') })))).toBeNull()
    expect(await readAssuranceLevel(reader(async () => ({ data: null, error: null })))).toBeNull()
    expect(
      await readAssuranceLevel(
        reader(async () => {
          throw new Error('network')
        })
      )
    ).toBeNull()
  })
})

describe('safeNextPath / mfaRedirectPath — no open redirect through /mfa', () => {
  it('keeps same-origin relative paths', () => {
    expect(safeNextPath('/studio/structure')).toBe('/studio/structure')
    expect(safeNextPath('/en/media?tenant=x')).toBe('/en/media?tenant=x')
  })

  it('replaces protocol-relative, absolute and backslash tricks with the fallback', () => {
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 'evil', '', null, undefined]) {
      expect(safeNextPath(bad)).toBe('/auth/continue')
    }
  })

  it('builds the MFA redirect carrying the original target', () => {
    expect(mfaRedirectPath('/studio', '?x=1')).toBe('/mfa?next=%2Fstudio%3Fx%3D1')
    expect(mfaRedirectPath('//evil')).toBe('/mfa?next=%2Fauth%2Fcontinue')
  })
})
