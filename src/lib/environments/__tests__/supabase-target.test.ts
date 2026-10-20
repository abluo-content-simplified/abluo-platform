import { describe, expect, it } from 'vitest'
import { assertSandboxSupabase, isProductionSupabase, supabaseRefOf, PRODUCTION_SUPABASE_REFS } from '../supabase-target'

const PROD = `https://${PRODUCTION_SUPABASE_REFS[0]}.supabase.co`
const SANDBOX = 'https://abcdefghijklmnopqrst.supabase.co'

describe('Supabase target guard (ADR-038 D8)', () => {
  it('reads the project ref from a Supabase URL', () => {
    expect(supabaseRefOf(SANDBOX)).toBe('abcdefghijklmnopqrst')
    expect(supabaseRefOf('https://example.com')).toBeNull()
    expect(supabaseRefOf('')).toBeNull()
  })
  it('recognises the shared production project', () => {
    expect(isProductionSupabase(PROD)).toBe(true)
    expect(isProductionSupabase(SANDBOX)).toBe(false)
  })
  it('refuses production and a missing sandbox; accepts the sandbox', () => {
    expect(() => assertSandboxSupabase(PROD, 'test')).toThrow(/refusing to write to the production Supabase/)
    expect(() => assertSandboxSupabase(undefined, 'test')).toThrow(/no sandbox Supabase configured/)
    expect(assertSandboxSupabase(SANDBOX, 'test')).toBe('abcdefghijklmnopqrst')
  })
})
