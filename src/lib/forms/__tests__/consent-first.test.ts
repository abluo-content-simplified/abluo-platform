/**
 * Consent first — ADR-018 amendment (2026-10).
 *
 * Before: step 1 "Continue" of a multi-step form POSTed name + email as a
 * partial row with `gdpr_consent: false`; the checkbox only appeared on the
 * final step. Now, for a form that requires consent, the checkbox is on the
 * FIRST screen that stores data, the create refuses without it, and the row
 * carries consent + timestamp from its first write.
 *
 * Fixtures mirror the two live definitions read from Sanity production
 * (2026-10-02): Livener `early-access` (3 steps + review screen) and abluo
 * `early-access` (2 steps, no review).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { consentPlacement } from '@/lib/forms/multistep'
import { mapSanityFormDefinition } from '@/lib/forms/definition-source'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import type { FormDefinition } from '@/lib/forms/definitions'

// ── Definitions as stored in Sanity (projection of formDefinitionByKeyQuery) ──

const livenerDoc = {
  formId: 'early-access',
  version: 1,
  requiresConsent: true,
  steps: [
    { key: 'contact', fields: [
      { internalKey: 'name', type: 'text', required: true },
      { internalKey: 'email', type: 'email', required: true },
    ] },
    { key: 'organisation', fields: [
      { internalKey: 'organization', type: 'text' },
      { internalKey: 'orgType', type: 'select', required: true, options: ['broadcaster', 'other'] },
      { internalKey: 'role', type: 'select', required: true, options: ['producer', 'other'] },
    ] },
    { key: 'streaming', fields: [
      { internalKey: 'useCases', type: 'multiselect' },
      { internalKey: 'audienceSize', type: 'select' },
      { internalKey: 'website', type: 'url' },
      { internalKey: 'referralSource', type: 'select' },
    ] },
  ],
}

const abluoDoc = {
  formId: 'early-access',
  version: 1,
  requiresConsent: true,
  steps: [
    { key: 'contact', fields: [
      { internalKey: 'name', type: 'text', required: true },
      { internalKey: 'email', type: 'email', required: true },
    ] },
    { key: 'practice', fields: [
      { internalKey: 'organization', type: 'text' },
      { internalKey: 'practiceType', type: 'text' },
      { internalKey: 'website', type: 'url' },
      { internalKey: 'message', type: 'textarea' },
    ] },
  ],
}

// Client-side view of the same two forms (only what placement needs).
const livenerClient = { requireConsent: true, reviewStep: true, stepCount: 3 }
const abluoClient = { requireConsent: true, reviewStep: false, stepCount: 2 }

// ── Client: where the checkbox renders ────────────────────────────────────────

describe('consentPlacement — the checkbox is on the first screen that stores data', () => {
  for (const [name, f] of [['Livener early-access', livenerClient], ['abluo early-access', abluoClient]] as const) {
    describe(name, () => {
      it('shows consent on step 1 when no row exists yet', () => {
        expect(consentPlacement({ ...f, hasSubmission: false, stepIndex: 0, isRecap: false })).toBe('step')
      })
      it('never re-asks once the row exists (consent travelled with step 1)', () => {
        for (let i = 0; i < f.stepCount; i++) {
          expect(consentPlacement({ ...f, hasSubmission: true, stepIndex: i, isRecap: false })).toBeNull()
        }
        expect(consentPlacement({ ...f, hasSubmission: true, stepIndex: f.stepCount, isRecap: true })).toBeNull()
      })
    })
  }

  it('with a review screen, the last step only advances (no post) — so the recap asks if nothing was stored yet', () => {
    expect(consentPlacement({ ...livenerClient, hasSubmission: false, stepIndex: 2, isRecap: false })).toBeNull()
    expect(consentPlacement({ ...livenerClient, hasSubmission: false, stepIndex: 3, isRecap: true })).toBe('recap')
  })

  it('without a review screen, a context-deferred landing on the last step asks there', () => {
    expect(consentPlacement({ ...abluoClient, hasSubmission: false, stepIndex: 1, isRecap: false })).toBe('step')
  })

  it('a form that does not require consent never shows it', () => {
    expect(
      consentPlacement({ requireConsent: false, reviewStep: false, stepCount: 2, hasSubmission: false, stepIndex: 0, isRecap: false }),
    ).toBeNull()
  })
})

// ── Server: no step-1 row without consent ─────────────────────────────────────

let activeDef: FormDefinition | null = null
let supabase: ReturnType<typeof makeSupabase>

vi.mock('@/lib/sanity/client', () => ({
  sanityClient: { fetch: async () => null },
  tryTenantToProjectSlug: () => null,
}))
vi.mock('@/lib/forms/definition-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/forms/definition-source')>()
  return { ...actual, resolveActiveDefinition: vi.fn(async () => activeDef) }
})
vi.mock('@/lib/forms/spam', () => ({ runSpamChecks: async () => ({ blocked: false }) }))
vi.mock('@/lib/supabase/admin', () => ({
  runAsTrustedSystemOperation: async (_r: string, fn: (c: unknown) => unknown) => fn(supabase),
}))

const { createSubmission, completeStep } = await import('@/lib/forms/submissions')

type Row = Record<string, unknown>
const PROJECT = '22222222-2222-4222-8222-222222222222'

function makeSupabase() {
  const rows: Record<string, Row[]> = {
    projects: [{ id: PROJECT, slug: 'livener', tenant_id: 'tenant-id' }],
    tenants: [{ id: 'tenant-id', slug: 'livener' }],
    form_submissions: [],
    form_events: [],
  }
  let seq = 0
  const from = (table: string) => {
    const filters: Row = {}
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: Row = {}
    const matches = () => (rows[table] ?? []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
    const settle = () => {
      if (op === 'insert') {
        const created = { id: `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, '0')}`, ...payload }
        rows[table].push(created)
        return created
      }
      if (op === 'update') {
        const hit = matches()
        hit.forEach((r) => Object.assign(r, payload))
        return hit.map((r) => ({ id: r.id }))
      }
      return matches()
    }
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => ((filters[c] = v), b),
      insert: (p: Row) => ((op = 'insert'), (payload = p), b),
      update: (p: Row) => ((op = 'update'), (payload = p), b),
      maybeSingle: async () => {
        const r = settle()
        return { data: Array.isArray(r) ? (r[0] ?? null) : r, error: null }
      },
      single: async () => {
        const r = settle()
        return { data: Array.isArray(r) ? (r[0] ?? null) : r, error: null }
      },
      then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve({ data: settle(), error: null }).then(ok, err),
    }
    return b
  }
  return { from, rows }
}

const create = (gdprConsent?: boolean) =>
  createSubmission({
    projectSlug: asSupabaseProjectSlug('livener'),
    formId: 'early-access',
    locale: 'en',
    data: { name: 'Ada', email: 'ada@example.test' },
    gdprConsent,
    ip: '203.0.113.7',
  })

describe.each([
  ['Livener early-access', livenerDoc],
  ['abluo early-access', abluoDoc],
])('createSubmission — %s', (_name, doc) => {
  beforeEach(() => {
    supabase = makeSupabase()
    activeDef = mapSanityFormDefinition(doc)
  })

  it('maps the Sanity privacy.requireConsent flag onto the server definition', () => {
    expect(activeDef?.requiresConsentAtFinalStep).toBe(true)
  })

  it('REFUSES step 1 without consent and stores nothing', async () => {
    const res = await create(false)
    expect(res).toMatchObject({ ok: false, status: 400, errors: { _consent: 'required' } })
    expect(supabase.rows.form_submissions).toEqual([])
    const missing = await create(undefined)
    expect(missing).toMatchObject({ ok: false, status: 400 })
    expect(supabase.rows.form_submissions).toEqual([])
  })

  it('stores the partial row WITH consent + timestamp when step 1 carries it', async () => {
    const res = await create(true)
    expect(res).toMatchObject({ ok: true, done: false })
    const row = supabase.rows.form_submissions[0]
    expect(row.completion_state).toBe('partial')
    expect(row.gdpr_consent).toBe(true)
    expect(typeof row.gdpr_consent_at).toBe('string')
  })

  it('walks to the end without the final step re-asking for consent', async () => {
    const created = (await create(true)) as { submissionId: string; completionToken: string; nextStepKey: string }
    const def = activeDef!
    let token = created.completionToken
    let res: Awaited<ReturnType<typeof completeStep>> | null = null
    for (const step of def.steps.slice(1)) {
      const data: Record<string, unknown> = {}
      for (const f of step.fields) if (f.required) data[f.key] = f.options?.[0] ?? 'x'
      res = await completeStep({
        projectSlug: asSupabaseProjectSlug('livener'),
        formId: 'early-access',
        submissionId: created.submissionId,
        completionToken: token,
        stepKey: step.key,
        data,
        // The client no longer shows the checkbox here; send nothing.
        gdprConsent: false,
      })
      if ('completionToken' in res && res.completionToken) token = res.completionToken
    }
    expect(res).toMatchObject({ ok: true, done: true })
    const row = supabase.rows.form_submissions[0]
    expect(row.completion_state).toBe('complete')
    expect(row.gdpr_consent).toBe(true)
  })
})

describe('createSubmission — a form that does not require consent', () => {
  beforeEach(() => {
    supabase = makeSupabase()
    activeDef = mapSanityFormDefinition({ ...abluoDoc, requiresConsent: false })
  })
  it('keeps partial-lead capture without consent', async () => {
    const res = await create(false)
    expect(res).toMatchObject({ ok: true, done: false })
    expect(supabase.rows.form_submissions[0].gdpr_consent).toBe(false)
  })
})
