/**
 * Regression tests for the cross-tenant leak in `completeStep()`.
 *
 * A multi-step submission started on tenant A's route could be finalized by
 * POSTing the last step to tenant B's route: the row was only matched on
 * `submissionId` + `form_id`, and the emitted `form.submitted` event took its
 * `project_slug` from the ROUTE — so tenant A's content was delivered to
 * tenant B's recipients with tenant B's branding.
 *
 * These tests pin both halves of the fix:
 *   1. a projectSlug that does not resolve to the row's project is rejected
 *      (404 'not found' — it must not reveal that the submission exists), with
 *      no UPDATE and no outbox event;
 *   2. the emitted event's projectSlug is the slug of the ROW's project, never
 *      the slug from the request URL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { issueStepToken } from '@/lib/forms/tokens'
import { asProjectSlug } from '@/lib/tenancy/ids'

// definition-source pulls in the Sanity client (and, through it, the query
// module) purely for the live-definition lookup this test does not exercise.
// Stub it so the unit test stays independent of Sanity/network config.
vi.mock('@/lib/sanity/client', () => ({
  sanityClient: { fetch: async () => null },
  tryTenantToProjectSlug: () => null,
}))

vi.mock('@/lib/forms/definition-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/forms/definition-source')>()
  return { ...actual, resolveActiveDefinition: vi.fn(async () => null) }
})

// The service always runs under the service-role wrapper; hand it our fake client.
let supabase: FakeSupabase
vi.mock('@/lib/supabase/admin', () => ({
  runAsTrustedSystemOperation: async (_reason: string, fn: (c: unknown) => unknown) => fn(supabase),
}))

const { completeStep } = await import('@/lib/forms/submissions')

// ── Fake Supabase ──────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

interface FakeSupabase {
  from: (table: string) => any
  inserts: { table: string; payload: Row }[]
  updates: { table: string; payload: Row; filters: Row }[]
}

function makeSupabase(rows: { form_submissions: Row[]; projects: Row[]; tenants: Row[] }): FakeSupabase {
  const inserts: { table: string; payload: Row }[] = []
  const updates: { table: string; payload: Row; filters: Row }[] = []

  const match = (table: string, filters: Row) =>
    (rows[table as keyof typeof rows] ?? []).find((r) =>
      Object.entries(filters).every(([k, v]) => r[k] === v),
    ) ?? null

  const from = (table: string) => {
    const filters: Row = {}
    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        filters[col] = val
        return b
      },
      maybeSingle: async () => ({ data: match(table, filters), error: null }),
      single: async () => ({ data: match(table, filters), error: null }),
      update: (payload: Row) => {
        updates.push({ table, payload, filters })
        return b
      },
      insert: async (payload: Row) => {
        inserts.push({ table, payload })
        return { data: null, error: null }
      },
      // Awaiting the builder resolves the guarded UPDATE ... select('id').
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
        const hit = match(table, filters)
        return Promise.resolve({ data: hit ? [{ id: hit.id }] : [], error: null }).then(onOk, onErr)
      },
    }
    return b
  }

  return { from, inserts, updates }
}

// ── Fixture: a 2-step submission owned by tenant A, sitting on its last step ───

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_A = '22222222-2222-4222-8222-222222222222'
const PROJECT_B = '33333333-3333-4333-8333-333333333333'

const snapshot = {
  formId: 'early-access',
  version: 1,
  requiresConsentAtFinalStep: false,
  steps: [
    { key: 'need', fields: [{ key: 'treatment', type: 'select', required: true }] },
    { key: 'contact', fields: [{ key: 'name', type: 'text', required: true }] },
  ],
}

let token: ReturnType<typeof issueStepToken>

function setup() {
  token = issueStepToken(Date.now())
  supabase = makeSupabase({
    form_submissions: [
      {
        id: SUBMISSION_ID,
        form_id: 'early-access',
        completion_state: 'partial',
        step_token_hash: token.hash,
        step_token_expires_at: token.expiresAt,
        submission_data: { treatment: 'implantology' },
        definition_snapshot: snapshot,
        form_version: 1,
        tenant_id: 'tenant-a-id',
        project_id: PROJECT_A,
        locale: 'en',
      },
    ],
    projects: [
      // Canonical row for tenant A — an id lookup resolves to this slug first.
      { id: PROJECT_A, slug: 'tenant-a', tenant_id: 'tenant-a-id' },
      // A second URL slug pointing at the same project (alias/rename), so the
      // test can tell a row-derived slug apart from the route's slug.
      { id: PROJECT_A, slug: 'tenant-a-alias', tenant_id: 'tenant-a-id' },
      { id: PROJECT_B, slug: 'tenant-b', tenant_id: 'tenant-b-id' },
    ],
    // Scope resolution now also reads the OWNING TENANT's slug — the key a
    // `formDefinition` is filed under. It is deliberately NOT equal to the
    // project slug here, which is the whole one-to-N point.
    tenants: [
      { id: 'tenant-a-id', slug: 'customer-a' },
      { id: 'tenant-b-id', slug: 'customer-b' },
    ],
  })
}

const finalStep = () => ({
  formId: 'early-access',
  submissionId: SUBMISSION_ID,
  completionToken: token.token,
  stepKey: 'contact',
  data: { name: 'Ada' },
  gdprConsent: true,
})

beforeEach(setup)

describe('completeStep tenant isolation', () => {
  it("rejects a final step posted on another tenant's route", async () => {
    const res = await completeStep({ projectSlug: asProjectSlug('tenant-b'), ...finalStep() })

    // 404 + the same generic message as an unknown submission — no oracle.
    expect(res).toEqual({ ok: false, status: 404, error: 'not found' })
    // Nothing was written: the submission stays partial and nothing is emitted.
    expect(supabase.updates).toEqual([])
    expect(supabase.inserts).toEqual([])
  })

  it('rejects a projectSlug that resolves to no project at all', async () => {
    const res = await completeStep({ projectSlug: asProjectSlug('does-not-exist'), ...finalStep() })
    expect(res).toEqual({ ok: false, status: 404, error: 'not found' })
    expect(supabase.inserts).toEqual([])
  })

  it("emits an event whose projectSlug comes from the row's project, not the route", async () => {
    const res = await completeStep({ projectSlug: asProjectSlug('tenant-a-alias'), ...finalStep() })

    expect(res).toEqual({ ok: true, done: true, submissionId: SUBMISSION_ID })

    const event = supabase.inserts.find((i) => i.table === 'form_events')
    expect(event).toBeDefined()
    expect(event!.payload.project_slug).toBe('tenant-a')
    expect(event!.payload.project_slug).not.toBe('tenant-a-alias')
    expect(event!.payload.project_id).toBe(PROJECT_A)
    expect(event!.payload.submission_id).toBe(SUBMISSION_ID)
  })

  it('still completes normally on the tenant its own route', async () => {
    const res = await completeStep({ projectSlug: asProjectSlug('tenant-a'), ...finalStep() })
    expect(res).toEqual({ ok: true, done: true, submissionId: SUBMISSION_ID })
    const event = supabase.inserts.find((i) => i.table === 'form_events')
    expect(event!.payload.project_slug).toBe('tenant-a')
  })
})

// ── D1 regression: unresolvable route scope must FAIL CLOSED ───────────────────
//
// The guard above used to compare `resolveProjectScope()`'s `projectId` against
// the row's. That helper returned `{ tenantId: null, projectId: null }` for a
// slug naming no project, which is EXACTLY the shape a legitimately
// platform-level row has (migration 016 allows `project_id null`). So for such a
// row the comparison was `null !== null` — false — and the guard passed for any
// invented slug: submission started via one unresolvable URL, finalized via
// another. `resolveProjectScope` now returns `null` for "unknown", which the
// call sites cannot silently compare, and both fail closed.

describe('completeStep — an unresolvable route slug is never a match (D1)', () => {
  const PLATFORM_SUBMISSION = '44444444-4444-4444-8444-444444444444'

  function setupPlatformRow() {
    token = issueStepToken(Date.now())
    supabase = makeSupabase({
      form_submissions: [
        {
          id: PLATFORM_SUBMISSION,
          form_id: 'early-access',
          completion_state: 'partial',
          step_token_hash: token.hash,
          step_token_expires_at: token.expiresAt,
          submission_data: { treatment: 'implantology' },
          definition_snapshot: snapshot,
          form_version: 1,
          // Platform-level: no tenant, no project (migration 016 §Scoping).
          tenant_id: null,
          project_id: null,
          locale: 'en',
        },
      ],
      projects: [{ id: PROJECT_A, slug: 'tenant-a', tenant_id: 'tenant-a-id' }],
      tenants: [{ id: 'tenant-a-id', slug: 'customer-a' }],
    })
  }

  const platformFinalStep = () => ({
    formId: 'early-access',
    submissionId: PLATFORM_SUBMISSION,
    completionToken: token.token,
    stepKey: 'contact',
    data: { name: 'Ada' },
    gdprConsent: true,
  })

  beforeEach(setupPlatformRow)

  it('REJECTS a platform-level (project_id null) submission finalized through a slug that resolves to no project — the null === null hole', async () => {
    const res = await completeStep({
      projectSlug: asProjectSlug('made-up-slug'),
      ...platformFinalStep(),
    })
    expect(res).toEqual({ ok: false, status: 404, error: 'not found' })
    expect(supabase.updates).toEqual([])
    expect(supabase.inserts).toEqual([])
  })

  it('REJECTS it through a DIFFERENT invented slug too — two unrelated unresolvable URLs must not be "the same scope"', async () => {
    const res = await completeStep({
      projectSlug: asProjectSlug('another-made-up-slug'),
      ...platformFinalStep(),
    })
    expect(res).toEqual({ ok: false, status: 404, error: 'not found' })
    expect(supabase.inserts).toEqual([])
  })

  it('REJECTS it on a REAL tenant route as well — a platform-level row cannot be adopted by a project', async () => {
    const res = await completeStep({
      projectSlug: asProjectSlug('tenant-a'),
      ...platformFinalStep(),
    })
    expect(res).toEqual({ ok: false, status: 404, error: 'not found' })
    expect(supabase.inserts).toEqual([])
  })

  it('rejects an unresolvable slug BEFORE the token is checked, so a real submission is never advanced by it either', async () => {
    setup() // the tenant-A fixture, whose row has a real project_id
    const res = await completeStep({
      projectSlug: asProjectSlug('made-up-slug'),
      ...finalStep(),
    })
    expect(res).toEqual({ ok: false, status: 404, error: 'not found' })
    expect(supabase.updates).toEqual([])
  })
})
