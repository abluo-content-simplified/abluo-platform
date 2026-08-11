import { describe, it, expect } from 'vitest'
import {
  generateStepToken,
  hashToken,
  tokensMatch,
  isTokenExpired,
  issueStepToken,
  STEP_TOKEN_TTL_MS,
} from '@/lib/forms/tokens'
import {
  resolveDefinition,
  resolveDefinitionSnapshot,
  isMultiStep,
  isFinalStep,
  nextStepKey,
  validateStep,
  whitelistStepValues,
} from '@/lib/forms/definitions'

// ── Tokens ──────────────────────────────────────────────────────────────────

describe('forms tokens', () => {
  it('generates unique, non-trivial tokens', () => {
    const a = generateStepToken()
    const b = generateStepToken()
    expect(a).not.toEqual(b)
    expect(a.length).toBeGreaterThan(20)
  })

  it('hashes deterministically and never returns the plaintext', () => {
    const t = generateStepToken()
    expect(hashToken(t)).toEqual(hashToken(t))
    expect(hashToken(t)).not.toEqual(t)
  })

  it('matches a token against its own hash and rejects others', () => {
    const t = generateStepToken()
    const h = hashToken(t)
    expect(tokensMatch(t, h)).toBe(true)
    expect(tokensMatch(generateStepToken(), h)).toBe(false)
    expect(tokensMatch(t, null)).toBe(false)
    expect(tokensMatch(undefined, h)).toBe(false)
    expect(tokensMatch(t, 'not-a-hash')).toBe(false)
  })

  it('treats missing/expired expiry as expired', () => {
    expect(isTokenExpired(null)).toBe(true)
    expect(isTokenExpired(undefined)).toBe(true)
    expect(isTokenExpired(new Date(Date.now() - 1000).toISOString())).toBe(true)
    expect(isTokenExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false)
  })

  it('issues a token with a future expiry ~TTL away', () => {
    const now = 1_000_000_000_000
    const { token, hash, expiresAt } = issueStepToken(now)
    expect(tokensMatch(token, hash)).toBe(true)
    expect(Date.parse(expiresAt)).toBe(now + STEP_TOKEN_TTL_MS)
    expect(isTokenExpired(expiresAt, now)).toBe(false)
  })
})

// ── Definition resolution + snapshot ─────────────────────────────────────────

describe('early-access definition', () => {
  it('resolves early-access and returns null for unknown forms', () => {
    expect(resolveDefinition('early-access')).not.toBeNull()
    expect(resolveDefinition('does-not-exist')).toBeNull()
  })

  it('is multi-step: contact → details', () => {
    const def = resolveDefinition('early-access')!
    expect(isMultiStep(def)).toBe(true)
    expect(def.steps.map((s) => s.key)).toEqual(['contact', 'details'])
    expect(isFinalStep(def, 'details')).toBe(true)
    expect(isFinalStep(def, 'contact')).toBe(false)
    expect(nextStepKey(def, 'contact')).toBe('details')
    expect(nextStepKey(def, 'details')).toBeNull()
  })

  it('snapshot carries only interpretation data (no secrets/recipients)', () => {
    const def = resolveDefinition('early-access')!
    const snap = resolveDefinitionSnapshot(def)
    expect(snap.formId).toBe('early-access')
    expect(snap.version).toBe(1)
    const json = JSON.stringify(snap)
    expect(json).not.toMatch(/recipient|email@|channel|secret|token|apiKey/i)
    // structural: steps + fields present
    expect(Array.isArray(snap.steps)).toBe(true)
  })
})

// ── Server-side step validation ──────────────────────────────────────────────

describe('validateStep (contact)', () => {
  const def = resolveDefinition('early-access')!

  it('requires name + email', () => {
    const errors = validateStep(def, 'contact', {})
    expect(errors.name).toBe('required')
    expect(errors.email).toBe('required')
  })

  it('rejects an invalid email', () => {
    const errors = validateStep(def, 'contact', { name: 'Tom', email: 'not-an-email' })
    expect(errors.email).toBe('invalid')
    expect(errors.name).toBeUndefined()
  })

  it('passes a valid contact step', () => {
    const errors = validateStep(def, 'contact', { name: 'Tom', email: 'tom@example.com' })
    expect(Object.keys(errors)).toHaveLength(0)
  })
})

describe('validateStep (details)', () => {
  const def = resolveDefinition('early-access')!

  it('requires role + orgType', () => {
    const errors = validateStep(def, 'details', {})
    expect(errors.role).toBe('required')
    expect(errors.orgType).toBe('required')
  })

  it('rejects option values outside the allowed set', () => {
    const errors = validateStep(def, 'details', { role: 'not-a-role', orgType: 'company' })
    expect(errors.role).toBe('not_allowed')
    expect(errors.orgType).toBeUndefined()
  })

  it('accepts valid option values', () => {
    const errors = validateStep(def, 'details', { role: 'founder', orgType: 'company' })
    expect(Object.keys(errors)).toHaveLength(0)
  })
})

// ── Whitelist (§18 — a step can only write its own fields) ────────────────────

describe('whitelistStepValues', () => {
  const def = resolveDefinition('early-access')!

  it('keeps only the presented step fields, dropping foreign/identity keys', () => {
    const out = whitelistStepValues(def, 'details', {
      role: 'founder',
      orgType: 'company',
      email: 'attacker@evil.com', // belongs to the contact step — must be dropped
      tenant_id: 'hacked',        // identity — must be dropped
      arbitrary: 'x',
    })
    expect(out).toEqual({ role: 'founder', orgType: 'company' })
    expect(out.email).toBeUndefined()
    expect(out.tenant_id).toBeUndefined()
  })
})
