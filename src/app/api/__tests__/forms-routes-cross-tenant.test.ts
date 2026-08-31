/**
 * ROUTE-LEVEL cross-tenant isolation — finding I-11, test half.
 *
 * `src/lib/forms/__tests__/submissions-tenant-isolation.test.ts` proves the
 * isolation guard inside `completeStep()`. It calls the library function
 * directly, so it can never catch a regression in the layer above it: a route
 * that drops `projectSlug` from the params it forwards, reads the slug from the
 * BODY instead of the URL, swallows the 404 into a 200, or wires the wrong
 * handler to the wrong path. Those are route bugs, and they would leak exactly
 * the same client data.
 *
 * This suite therefore imports and invokes the REAL Next route handlers —
 *   POST /api/forms/[projectSlug]/[formId]/submissions
 *   POST /api/forms/[projectSlug]/[formId]/submissions/[id]/steps
 * — with real `Request` objects and real `params` promises, and asserts on the
 * real `Response` (status + JSON body), for two fixture tenants, A and B.
 *
 * Everything below the routes is real code: the submission service, the spam
 * checks, the definition source, the snapshot pinning, the token issue/verify.
 * Only the two true I/O boundaries are faked — Supabase (an in-memory store,
 * the same approach as the prior-art library test, extended to cover the
 * insert/count/update shapes the CREATE path needs) and the Sanity read that
 * resolves a tenant's published form definition.
 *
 * Coverage:
 *   1. (finding I-2, fixed in v1.0.28) a multi-step submission STARTED on
 *      tenant A cannot be COMPLETED by POSTing its final step to tenant B's
 *      route — even holding the genuine single-use completion token. 404, no
 *      UPDATE, no outbox event, and the submission is still finalizable on its
 *      own tenant afterwards.
 *   2. a form that belongs to another project — published for tenant A only —
 *      cannot be submitted on tenant B's route. 404 'unknown form', nothing
 *      written.
 *   3. tenant/project on a new row are resolved SERVER-SIDE from the URL and a
 *      body that claims another tenant's ids is ignored (ADR-018 §18).
 *   4. the emitted `form.submitted` event's project_slug derives from the ROW's
 *      project, not from the URL the finalize request arrived on.
 *   5. a partial submission cannot be finalized by a caller who knows its id
 *      but not its token — the tenant guard is not the only thing holding.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── The two faked I/O boundaries ──────────────────────────────────────────────

let supabase: FakeSupabase

vi.mock('@/lib/supabase/admin', () => ({
  runAsTrustedSystemOperation: async (_reason: string, fn: (c: unknown) => unknown) => fn(supabase),
}))

// Published, tenant-owned form definitions, keyed by the GROQ query's
// (formId, tenantSlug) pair — exactly what `resolveActiveDefinition` passes.
// `early-access` is published for BOTH tenants, so test 1's rejection is
// provably the project guard and not a missing definition. `clinic-intake` is
// published for tenant A only, and is deliberately NOT one of the code
// descriptors in `definitions.ts`, so tenant B gets no fallback either.
//
// NOTE the keys are the TENANT slugs ('customer-a'), which in this fixture are
// deliberately DIFFERENT from the project slugs the requests are routed on
// ('tenant-a', 'tenant-a-alias'). That is the one-to-N world: a definition is
// owned by a tenant and shared by its projects, so a route that passed its
// project slug to this lookup — as the service used to — resolves nothing here.
const step = (key: string, fields: Record<string, unknown>[]) => ({ key, fields })
const twoStepDoc = (formId: string, version: number) => ({
  formId,
  version,
  notificationTopic: formId,
  requiresConsent: true,
  steps: [
    step('contact', [
      { internalKey: 'name', type: 'text', required: true },
      { internalKey: 'email', type: 'email', required: true },
    ]),
    step('details', [{ internalKey: 'role', type: 'select', required: true, options: ['clinician'] }]),
  ],
})

const PUBLISHED: Record<string, Record<string, unknown>> = {
  'early-access::customer-a': twoStepDoc('early-access', 3),
  'early-access::customer-b': twoStepDoc('early-access', 3),
  'clinic-intake::customer-a': twoStepDoc('clinic-intake', 1),
}

vi.mock('@/lib/sanity/client', () => ({
  sanityClient: {
    fetch: async (_query: string, params: { formId: string; tenantSlug: string }) =>
      PUBLISHED[`${params.formId}::${params.tenantSlug}`] ?? null,
  },
  tryTenantToProjectSlug: () => null,
}))

// Real route handlers, imported after the mocks are registered.
const { POST: createRoute } = await import('@/app/api/forms/[projectSlug]/[formId]/submissions/route')
const { POST: stepsRoute } = await import(
  '@/app/api/forms/[projectSlug]/[formId]/submissions/[id]/steps/route'
)

// ── In-memory Supabase ────────────────────────────────────────────────────────
// Extends the prior-art fake (submissions-tenant-isolation.test.ts) with the
// shapes the CREATE path needs: a head/count query (the per-IP rate limit), a
// chained `.insert(...).select('id').single()`, and an UPDATE that mutates the
// stored row so a second request sees the new state.

type Row = Record<string, unknown>

interface FakeSupabase {
  from: (table: string) => any
  rows: Record<string, Row[]>
  inserts: { table: string; payload: Row }[]
  updates: { table: string; payload: Row; filters: Row }[]
}

let uuidSeq = 0
const nextUuid = () => `aaaaaaaa-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`

function makeSupabase(seed: Record<string, Row[]>): FakeSupabase {
  const rows: Record<string, Row[]> = { form_submissions: [], form_events: [], ...seed }
  const inserts: { table: string; payload: Row }[] = []
  const updates: { table: string; payload: Row; filters: Row }[] = []

  const from = (table: string) => {
    const filters: Row = {}
    let op: 'select' | 'insert' | 'update' = 'select'
    let counting = false
    let payload: Row = {}

    const matches = () =>
      (rows[table] ?? []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))

    const settle = () => {
      if (op === 'insert') {
        const created = { id: nextUuid(), event_id: nextUuid(), ...payload }
        ;(rows[table] ??= []).push(created)
        inserts.push({ table, payload })
        return { data: created, error: null, count: null }
      }
      if (op === 'update') {
        const hit = matches()
        updates.push({ table, payload, filters: { ...filters } })
        for (const r of hit) Object.assign(r, payload)
        return { data: hit.map((r) => ({ id: r.id })), error: null, count: null }
      }
      const hit = matches()
      return { data: hit, error: null, count: hit.length }
    }

    const b: any = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count || opts?.head) counting = true
        return b
      },
      eq: (col: string, val: unknown) => {
        filters[col] = val
        return b
      },
      // The rate-limit window filter; the fake keeps no clock, so every seeded
      // row counts — which is what makes the "5 per hour" cap testable.
      gte: () => b,
      filter: () => b,
      insert: (p: Row) => {
        op = 'insert'
        payload = p
        return b
      },
      update: (p: Row) => {
        op = 'update'
        payload = p
        return b
      },
      maybeSingle: async () => {
        const res = settle()
        return { data: op === 'insert' ? res.data : ((res.data as Row[])[0] ?? null), error: null }
      },
      single: async () => {
        const res = settle()
        return { data: op === 'insert' ? res.data : ((res.data as Row[])[0] ?? null), error: null }
      },
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
        const res = settle()
        return Promise.resolve(
          counting ? { count: res.count, error: null } : { data: res.data, error: null },
        ).then(onOk, onErr)
      },
    }
    return b
  }

  return { from, rows, inserts, updates }
}

// ── Fixture world: two tenants; tenant A owns TWO projects ────────────────────

const PROJECT_A = '22222222-2222-4222-8222-222222222222'
const PROJECT_B = '33333333-3333-4333-8333-333333333333'
// Tenant A's SECOND project — the one-to-N case the whole grain split is for.
const PROJECT_A2 = '55555555-5555-4555-8555-555555555555'
const TENANT_A = 'tenant-a-id'
const TENANT_B = 'tenant-b-id'

function setup() {
  uuidSeq = 0
  supabase = makeSupabase({
    projects: [
      // Canonical slug first — an id lookup resolves to this one.
      { id: PROJECT_A, slug: 'tenant-a', tenant_id: TENANT_A },
      // A second URL slug for the SAME project (alias/rename), so a
      // row-derived slug is distinguishable from the request's slug.
      { id: PROJECT_A, slug: 'tenant-a-alias', tenant_id: TENANT_A },
      // A DIFFERENT project of the same tenant — shares tenant A's forms, but
      // must never share its submissions.
      { id: PROJECT_A2, slug: 'tenant-a-second-site', tenant_id: TENANT_A },
      { id: PROJECT_B, slug: 'tenant-b', tenant_id: TENANT_B },
    ],
    // Scope resolution reads the owning tenant's slug — the key form
    // definitions are filed under. Deliberately unequal to any project slug.
    tenants: [
      { id: TENANT_A, slug: 'customer-a' },
      { id: TENANT_B, slug: 'customer-b' },
    ],
  })
}

beforeEach(setup)

// ── Route invocation helpers (real Request, real params promise) ──────────────

interface RouteResult {
  status: number
  body: any
}

async function postCreate(
  projectSlug: string,
  formId: string,
  body: Record<string, unknown>,
): Promise<RouteResult> {
  const req = new Request(`https://abluo.test/api/forms/${projectSlug}/${formId}/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify(body),
  })
  const res = await createRoute(req, { params: Promise.resolve({ projectSlug, formId }) })
  return { status: res.status, body: await res.json() }
}

async function postStep(
  projectSlug: string,
  formId: string,
  id: string,
  body: Record<string, unknown>,
): Promise<RouteResult> {
  const req = new Request(
    `https://abluo.test/api/forms/${projectSlug}/${formId}/submissions/${id}/steps`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify(body),
    },
  )
  const res = await stepsRoute(req, { params: Promise.resolve({ projectSlug, formId, id }) })
  return { status: res.status, body: await res.json() }
}

/** Starts a real multi-step submission on `projectSlug` and returns its id + token. */
async function startOnTenant(projectSlug: string, formId = 'early-access') {
  const { status, body } = await postCreate(projectSlug, formId, {
    data: { name: 'Ada', email: 'ada@example.test' },
    locale: 'en',
  })
  expect(status).toBe(200)
  expect(body).toMatchObject({ ok: true, done: false, nextStepKey: 'details' })
  expect(typeof body.completionToken).toBe('string')
  return { submissionId: body.submissionId as string, completionToken: body.completionToken as string }
}

const finalStepBody = (completionToken: string) => ({
  stepKey: 'details',
  completionToken,
  data: { role: 'clinician' },
  gdprConsent: true,
})

const submissionRow = (id: string) => supabase.rows.form_submissions.find((r) => r.id === id)!
const outboxEvents = () => supabase.inserts.filter((i) => i.table === 'form_events')

// ── 1. Finding I-2: finish A's submission on B's route ────────────────────────

describe('POST /api/forms/[projectSlug]/[formId]/submissions/[id]/steps — cross-tenant finalize (finding I-2)', () => {
  it("REJECTS the final step of tenant A's submission when POSTed to tenant B's route, holding the genuine token", async () => {
    const { submissionId, completionToken } = await startOnTenant('tenant-a')
    expect(submissionRow(submissionId).project_id).toBe(PROJECT_A)

    const res = await postStep('tenant-b', 'early-access', submissionId, finalStepBody(completionToken))

    // 404, and the same generic message an unknown submission gets — the
    // response must not confirm that this submission exists.
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not found' })
  })

  it('and writes NOTHING while doing so: the row stays partial with its token intact, and no outbox event is emitted', async () => {
    const { submissionId, completionToken } = await startOnTenant('tenant-a')
    const tokenHashBefore = submissionRow(submissionId).step_token_hash
    supabase.updates.length = 0
    supabase.inserts.length = 0

    await postStep('tenant-b', 'early-access', submissionId, finalStepBody(completionToken))

    expect(supabase.updates).toEqual([])
    expect(outboxEvents()).toEqual([])
    const row = submissionRow(submissionId)
    expect(row.completion_state).toBe('partial')
    expect(row.step_token_hash).toBe(tokenHashBefore) // token not spent
    expect(row.submission_data).toEqual({ name: 'Ada', email: 'ada@example.test' })
  })

  it('the rejected attempt does not burn the token — the visitor can still legitimately finish on their OWN tenant afterwards (a denial must not become a denial-of-service)', async () => {
    const { submissionId, completionToken } = await startOnTenant('tenant-a')
    await postStep('tenant-b', 'early-access', submissionId, finalStepBody(completionToken))

    const ok = await postStep('tenant-a', 'early-access', submissionId, finalStepBody(completionToken))
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ ok: true, done: true, submissionId })
    expect(submissionRow(submissionId).completion_state).toBe('complete')
    expect(outboxEvents()).toHaveLength(1)
  })

  it('a projectSlug that resolves to no project at all is rejected too — an attacker cannot dodge the guard by inventing a slug', async () => {
    const { submissionId, completionToken } = await startOnTenant('tenant-a')
    const res = await postStep('no-such-tenant', 'early-access', submissionId, finalStepBody(completionToken))
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not found' })
    expect(outboxEvents()).toEqual([])
  })

  it('and it is symmetric: a submission started on tenant B cannot be finished on tenant A either', async () => {
    const { submissionId, completionToken } = await startOnTenant('tenant-b')
    expect(submissionRow(submissionId).project_id).toBe(PROJECT_B)

    const res = await postStep('tenant-a', 'early-access', submissionId, finalStepBody(completionToken))
    expect(res.status).toBe(404)
    expect(submissionRow(submissionId).completion_state).toBe('partial')
  })

  it('knowing the submission id is not enough on the RIGHT tenant either — a wrong/absent token is a 401, so the tenant guard is not the only thing holding this path shut', async () => {
    const { submissionId } = await startOnTenant('tenant-a')

    const noToken = await postStep('tenant-a', 'early-access', submissionId, {
      stepKey: 'details',
      data: { role: 'clinician' },
      gdprConsent: true,
    })
    expect(noToken.status).toBe(401)

    const wrongToken = await postStep(
      'tenant-a',
      'early-access',
      submissionId,
      finalStepBody('deadbeef'.repeat(8)),
    )
    expect(wrongToken.status).toBe(401)
    expect(submissionRow(submissionId).completion_state).toBe('partial')
    expect(outboxEvents()).toEqual([])
  })
})

// ── 2. A form that belongs to another project ─────────────────────────────────

describe('POST /api/forms/[projectSlug]/[formId]/submissions — a form owned by another project', () => {
  it("REJECTS a submission for `clinic-intake` (published for tenant A only) when POSTed to tenant B's route — 404 'unknown form', nothing written", async () => {
    const res = await postCreate('tenant-b', 'clinic-intake', {
      data: { name: 'Ada', email: 'ada@example.test' },
    })
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'unknown form', errors: undefined })
    expect(supabase.rows.form_submissions).toEqual([])
    expect(supabase.inserts).toEqual([])
  })

  it('POSITIVE CONTROL: the same form on its OWN tenant succeeds and pins tenant A — so the rejection above is ownership, not a broken fixture', async () => {
    const res = await postCreate('tenant-a', 'clinic-intake', {
      data: { name: 'Ada', email: 'ada@example.test' },
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, done: false })
    const row = submissionRow(res.body.submissionId)
    expect(row.form_id).toBe('clinic-intake')
    expect(row.project_id).toBe(PROJECT_A)
    expect(row.tenant_id).toBe(TENANT_A)
  })

  it('a step of a tenant-A `clinic-intake` submission cannot be completed on tenant B — the form-ownership check and the row-project check are independent guards', async () => {
    const { submissionId, completionToken } = await startOnTenant('tenant-a', 'clinic-intake')
    const res = await postStep('tenant-b', 'clinic-intake', submissionId, finalStepBody(completionToken))
    expect(res.status).toBe(404)
    expect(submissionRow(submissionId).completion_state).toBe('partial')
  })

  it("a formId the row was NOT created with is rejected on the row's own tenant (404) — the id/formId pair must match, so a submission cannot be re-labelled as another project's form mid-flow", async () => {
    const { submissionId, completionToken } = await startOnTenant('tenant-a', 'clinic-intake')
    const res = await postStep('tenant-a', 'early-access', submissionId, finalStepBody(completionToken))
    expect(res.status).toBe(404)
    expect(submissionRow(submissionId).completion_state).toBe('partial')
  })
})

// ── 3. Scope comes from the URL, never the body ───────────────────────────────

describe('POST /api/forms/[projectSlug]/[formId]/submissions — scope is server-derived (ADR-018 §18)', () => {
  it("IGNORES tenant_id / project_id / projectSlug supplied in the request BODY and pins the scope resolved from the URL's projectSlug", async () => {
    const res = await postCreate('tenant-a', 'early-access', {
      data: { name: 'Ada', email: 'ada@example.test' },
      // Everything a hostile client might try to steer the row with:
      tenant_id: TENANT_B,
      project_id: PROJECT_B,
      projectSlug: 'tenant-b',
      context: { project_id: PROJECT_B },
      source: { project_id: PROJECT_B },
    })
    expect(res.status).toBe(200)

    const row = submissionRow(res.body.submissionId)
    expect(row.project_id).toBe(PROJECT_A)
    expect(row.tenant_id).toBe(TENANT_A)
    expect(row.project_id).not.toBe(PROJECT_B)
    // Context is whitelisted to the definition's contextMappable keys, so the
    // injected project_id never even reaches the stored JSONB.
    expect(row.context).toEqual({})
  })

  it('the form_version and definition_snapshot pinned on the row come from the tenant-owned published definition for THIS route (v3), not from the code fallback (v1)', async () => {
    const res = await postCreate('tenant-a', 'early-access', {
      data: { name: 'Ada', email: 'ada@example.test' },
    })
    const row = submissionRow(res.body.submissionId)
    expect(row.form_version).toBe(3)
    expect((row.definition_snapshot as any).formId).toBe('early-access')
  })
})

// ── 4. The emitted event's slug follows the ROW, not the URL ──────────────────

describe('form.submitted outbox event — project attribution follows the row', () => {
  it("emits an event whose project_slug and project_id are the ROW's project, even when the finalize request arrives on a different URL slug for that same project", async () => {
    const { submissionId, completionToken } = await startOnTenant('tenant-a')

    // 'tenant-a-alias' resolves to the SAME project id, so the tenant guard
    // legitimately passes — which is exactly the case where a route-derived
    // slug would silently be wrong in the delivered notification.
    const res = await postStep('tenant-a-alias', 'early-access', submissionId, finalStepBody(completionToken))
    expect(res.status).toBe(200)

    const events = outboxEvents()
    expect(events).toHaveLength(1)
    const payload = events[0].payload as Record<string, unknown>
    expect(payload.project_slug).toBe('tenant-a')
    expect(payload.project_slug).not.toBe('tenant-a-alias')
    expect(payload.project_id).toBe(PROJECT_A)
    expect(payload.tenant_id).toBe(TENANT_A)
    expect(payload.submission_id).toBe(submissionId)
    expect(payload.status).toBe('pending')
  })

  it('a single-step-equivalent finalize on tenant B attributes to tenant B — the two tenants never cross-contaminate within one test run', async () => {
    const a = await startOnTenant('tenant-a')
    const b = await startOnTenant('tenant-b')
    await postStep('tenant-a', 'early-access', a.submissionId, finalStepBody(a.completionToken))
    await postStep('tenant-b', 'early-access', b.submissionId, finalStepBody(b.completionToken))

    const events = outboxEvents().map((e) => e.payload as Record<string, unknown>)
    expect(events).toHaveLength(2)
    expect(events.find((e) => e.submission_id === a.submissionId)!.project_id).toBe(PROJECT_A)
    expect(events.find((e) => e.submission_id === b.submissionId)!.project_id).toBe(PROJECT_B)
  })
})

// ── 5. An unknown projectSlug now FAILS CLOSED on both paths (D1) ─────────────
//
// This section previously pinned the opposite behaviour as characterization: an
// unrecognised slug fell through to a platform-level write (tenant_id/project_id
// null) from an arbitrary URL, and — because `resolveProjectScope` reported
// "unknown" with the same `{ null, null }` shape a legitimately platform-level
// row has — `completeStep`'s guard then compared `null !== null`, passed, and
// let ANY unresolvable slug finalize such a row. The comment there named the
// condition for changing it ("if the create path ever gains a reject-unknown
// rule, this test is the one to update deliberately"); this is that change.

describe('POST /api/forms/[projectSlug]/[formId]/submissions — an unknown projectSlug is rejected', () => {
  it('404s CREATE on a slug that names no project, instead of storing a scope-less platform-level row from an arbitrary URL', async () => {
    const res = await postCreate('there-is-no-such-project', 'early-access', {
      data: { name: 'Ada', email: 'ada@example.test' },
    })
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'unknown project', errors: undefined })
    expect(supabase.rows.form_submissions).toEqual([])
    expect(outboxEvents()).toEqual([])
  })

  it('404s the STEP path on an unresolvable slug — an existing platform-level row (project_id null) can no longer be finalized by inventing a URL', async () => {
    // Seed the row the OLD create path would have produced, so the regression is
    // pinned even for rows that already exist in the database.
    const legacyId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const { issueStepToken } = await import('@/lib/forms/tokens')
    const token = issueStepToken(Date.now())
    supabase.rows.form_submissions.push({
      id: legacyId,
      form_id: 'early-access',
      completion_state: 'partial',
      step_token_hash: token.hash,
      step_token_expires_at: token.expiresAt,
      submission_data: { name: 'Ada', email: 'ada@example.test' },
      definition_snapshot: {
        formId: 'early-access',
        version: 3,
        requiresConsentAtFinalStep: true,
        steps: [
          { key: 'contact', fields: [{ key: 'name', type: 'text', required: true }] },
          { key: 'details', fields: [{ key: 'role', type: 'select', required: true, options: ['clinician'] }] },
        ],
      },
      form_version: 3,
      tenant_id: null,
      project_id: null,
      locale: 'en',
    })

    const res = await postStep('there-is-no-such-project', 'early-access', legacyId, finalStepBody(token.token))
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not found' })

    // And a second, unrelated invented slug is not "the same scope" either.
    const res2 = await postStep('nor-this-one', 'early-access', legacyId, finalStepBody(token.token))
    expect(res2.status).toBe(404)

    // Nor can a real project adopt it.
    const res3 = await postStep('tenant-a', 'early-access', legacyId, finalStepBody(token.token))
    expect(res3.status).toBe(404)

    const row = supabase.rows.form_submissions.find((r) => r.id === legacyId)!
    expect(row.completion_state).toBe('partial')
    expect(row.step_token_hash).toBe(token.hash) // token not spent
    expect(outboxEvents()).toEqual([])
  })
})

// ── 6. Definitions are TENANT-owned; submissions are PROJECT-owned (D3) ───────

describe('one tenant, two projects', () => {
  it("resolves the form definition by the OWNING TENANT's slug, not the route's project slug — tenant A's second website submits the same published `early-access` v3", async () => {
    const res = await postCreate('tenant-a-second-site', 'early-access', {
      data: { name: 'Ada', email: 'ada@example.test' },
    })
    expect(res.status).toBe(200)
    const row = submissionRow(res.body.submissionId)
    // v3 is the PUBLISHED tenant-owned definition (the code fallback is v1), so
    // this proves the Sanity lookup hit on 'customer-a' — a lookup keyed by the
    // route slug 'tenant-a-second-site' would have missed and fallen back.
    expect(row.form_version).toBe(3)
    // …while the submission itself is pinned to THIS project, not its sibling.
    expect(row.project_id).toBe(PROJECT_A2)
    expect(row.tenant_id).toBe(TENANT_A)
  })

  it('but the two sibling projects still cannot finalize each other\'s submissions — shared forms are not shared submissions', async () => {
    const { submissionId, completionToken } = await startOnTenant('tenant-a')
    const res = await postStep(
      'tenant-a-second-site',
      'early-access',
      submissionId,
      finalStepBody(completionToken),
    )
    expect(res.status).toBe(404)
    expect(submissionRow(submissionId).completion_state).toBe('partial')
    expect(outboxEvents()).toEqual([])
  })
})
