/**
 * ROUTE-LEVEL abuse resistance for the two PUBLIC form endpoints.
 *
 * The sibling suite `forms-routes-cross-tenant.test.ts` proves the isolation
 * guarantees; this one proves the BOUNDS. Same approach: the real Next route
 * handlers, real `Request` objects, real params promises, with only the two true
 * I/O boundaries faked (Supabase and the Sanity definition read). Everything in
 * between — body reading, spam checks, validation, whitelisting, the insert — is
 * the real code.
 *
 * Every test here passes only because of the abuse hardening; each one describes
 * the request an anonymous attacker could previously send successfully.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let supabase: FakeSupabase

vi.mock('@/lib/supabase/admin', () => ({
  runAsTrustedSystemOperation: async (_reason: string, fn: (c: unknown) => unknown) => fn(supabase),
}))

// No published definition for this tenant → the CODE FALLBACK descriptor serves
// the request. That is deliberate: the fallback declares no `maxLength` on any
// field, and it is what most tenants actually get.
vi.mock('@/lib/sanity/client', () => ({
  sanityClient: { fetch: async () => null },
  tryTenantToProjectSlug: () => null,
}))

const { POST: createRoute } = await import('@/app/api/forms/[projectSlug]/[formId]/submissions/route')
const { POST: stepsRoute } = await import(
  '@/app/api/forms/[projectSlug]/[formId]/submissions/[id]/steps/route'
)

// ── In-memory Supabase (same shape as the cross-tenant suite) ─────────────────

type Row = Record<string, unknown>

interface FakeSupabase {
  from: (table: string) => any
  rows: Record<string, Row[]>
  inserts: { table: string; payload: Row }[]
  countError: { message: string } | null
}

let uuidSeq = 0
const nextUuid = () => `bbbbbbbb-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`

function makeSupabase(seed: Record<string, Row[]>): FakeSupabase {
  const rows: Record<string, Row[]> = { form_submissions: [], form_events: [], ...seed }
  const inserts: { table: string; payload: Row }[] = []
  const self: FakeSupabase = { from: () => undefined, rows, inserts, countError: null }

  self.from = (table: string) => {
    const filters: Row = {}
    let op: 'select' | 'insert' | 'update' = 'select'
    let counting = false
    let payload: Row = {}

    const matches = () =>
      (rows[table] ?? []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))

    const settle = () => {
      if (op === 'insert') {
        const created = { id: nextUuid(), ...payload }
        ;(rows[table] ??= []).push(created)
        inserts.push({ table, payload })
        return { data: created, error: null, count: null }
      }
      if (op === 'update') {
        const hit = matches()
        for (const r of hit) Object.assign(r, payload)
        return { data: hit.map((r) => ({ id: r.id })), error: null, count: null }
      }
      const hit = matches()
      return { data: hit, error: null, count: hit.length }
    }

    const b: any = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => {
        if (o?.count || o?.head) counting = true
        return b
      },
      eq: (col: string, val: unknown) => {
        filters[col] = val
        return b
      },
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
      then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => {
        if (counting && self.countError) {
          return Promise.resolve({ count: null, error: self.countError }).then(ok, err)
        }
        const res = settle()
        return Promise.resolve(
          counting ? { count: res.count, error: null } : { data: res.data, error: null },
        ).then(ok, err)
      },
    }
    return b
  }

  return self
}

const PROJECT = '22222222-2222-4222-8222-222222222222'
const OTHER_PROJECT = '33333333-3333-4333-8333-333333333333'
const TENANT = 'tenant-id'

beforeEach(() => {
  uuidSeq = 0
  supabase = makeSupabase({
    projects: [
      { id: PROJECT, slug: 'acme', tenant_id: TENANT },
      { id: OTHER_PROJECT, slug: 'other', tenant_id: TENANT },
    ],
    tenants: [{ id: TENANT, slug: 'acme-client' }],
  })
  // The project cap logs loudly by design; keep the suite output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

// ── Request helpers ───────────────────────────────────────────────────────────

const HUMAN_IP = '203.0.113.7'

/** A payload shaped exactly like a real browser's (honeypot + open timestamp). */
const humanBody = (extra: Record<string, unknown> = {}) => ({
  data: { name: 'Ada', email: 'ada@example.test' },
  locale: 'en',
  company_website: '',
  openedAt: Date.now() - 10_000,
  ...extra,
})

async function postCreate(
  body: unknown,
  headers: Record<string, string> = { 'x-vercel-forwarded-for': HUMAN_IP },
  projectSlug = 'acme',
  formId = 'early-access',
) {
  const req = new Request(`https://abluo.test/api/forms/${projectSlug}/${formId}/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const res = await createRoute(req, { params: Promise.resolve({ projectSlug, formId }) })
  return { status: res.status, body: await res.json() }
}

const submissions = () => supabase.rows.form_submissions
const row = (id: string) => submissions().find((r) => r.id === id)!

/** Seeds `n` prior submissions for the given IP/project inside the rate window. */
function seedSubmissions(n: number, over: Row = {}) {
  for (let i = 0; i < n; i++) {
    submissions().push({
      id: nextUuid(),
      submitter_ip: HUMAN_IP,
      project_id: PROJECT,
      tenant_id: TENANT,
      created_at: new Date().toISOString(),
      ...over,
    })
  }
}

// ── Finding 1: unbounded writes ───────────────────────────────────────────────

describe('POST …/submissions — the request body is bounded (finding 1)', () => {
  it('413s a multi-megabyte body instead of parsing it and storing it', async () => {
    const res = await postCreate(humanBody({ data: { name: 'a'.repeat(2 * 1024 * 1024), email: 'a@b.co' } }))
    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'request body too large' })
    expect(submissions()).toEqual([])
    expect(supabase.inserts).toEqual([])
  })

  it('413s the STEP path too — the same row is writable from there', async () => {
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const req = new Request(
      `https://abluo.test/api/forms/acme/early-access/submissions/${id}/steps`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stepKey: 'details', data: { message: 'x'.repeat(2 * 1024 * 1024) } }),
      },
    )
    const res = await stepsRoute(req, {
      params: Promise.resolve({ projectSlug: 'acme', formId: 'early-access', id }),
    })
    expect(res.status).toBe(413)
  })

  it('a normal-sized submission is unaffected', async () => {
    const res = await postCreate(humanBody())
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, done: false, nextStepKey: 'details' })
  })
})

describe('POST …/submissions — per-field caps hold with no definition maxLength (finding 1)', () => {
  it('400s an over-long `name` under the code-fallback definition, which declares no maxLength', async () => {
    const res = await postCreate(humanBody({ data: { name: 'a'.repeat(50_000), email: 'a@b.co' } }))
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: 'validation failed', errors: { name: 'invalid' } })
    expect(submissions()).toEqual([])
  })

  it('400s a field sent as a nested OBJECT — which used to skip validation and land in the DB', async () => {
    const res = await postCreate(
      humanBody({ data: { name: { nested: 'a'.repeat(10_000) }, email: 'a@b.co' } }),
    )
    expect(res.status).toBe(400)
    expect(res.body.errors.name).toBe('invalid')
    expect(submissions()).toEqual([])
  })
})

describe('POST …/submissions — `source` is a whitelist, like `context` (finding 1)', () => {
  it('stores only whitelisted attribution keys and drops arbitrary attacker JSON', async () => {
    const res = await postCreate(
      humanBody({
        source: {
          page_url: 'https://client.example/en/acme/contact',
          utm_source: 'newsletter',
          // None of these may reach the tenant's database.
          payload: 'x'.repeat(20_000),
          nested: { deep: [1, 2, 3] },
          tenant_id: 'someone-else',
        },
      }),
    )
    expect(res.status).toBe(200)
    const stored = row(res.body.submissionId).source as Record<string, unknown>
    expect(stored).toEqual({
      page_url: 'https://client.example/en/acme/contact',
      utm_source: 'newsletter',
      device_type: 'desktop',
    })
  })

  it('a client-sent `device_type` / `country` cannot override the server-derived ones', async () => {
    const res = await postCreate(
      humanBody({ source: { device_type: 'spoofed', country: 'ZZ' } }),
      { 'x-vercel-forwarded-for': HUMAN_IP, 'x-vercel-ip-country': 'IT' },
    )
    const stored = row(res.body.submissionId).source as Record<string, unknown>
    expect(stored.device_type).toBe('desktop')
    expect(stored.country).toBe('IT')
  })
})

// ── Finding 2 + 3: omission bypasses and the rate limit ──────────────────────

describe('POST …/submissions — omitting the spam signals costs the caller its lenient quota (findings 2 + 3)', () => {
  it('a caller that sends no honeypot and no openedAt is capped lower than a real browser', async () => {
    seedSubmissions(3)

    // Same IP, same moment: the silent caller is out of quota, the browser is not.
    const silent = await postCreate({ data: { name: 'Ada', email: 'ada@example.test' } })
    expect(silent.status).toBe(200)
    expect(silent.body).toEqual({ ok: true }) // silent spam response — nothing written
    expect(submissions()).toHaveLength(3)

    const human = await postCreate(humanBody())
    expect(human.body).toMatchObject({ ok: true, done: false })
    expect(submissions()).toHaveLength(4)
  })

  it('a filled honeypot and an instant submission are still blocked silently', async () => {
    const bot = await postCreate(humanBody({ company_website: 'http://spam.example' }))
    expect(bot.status).toBe(200)
    expect(bot.body).toEqual({ ok: true })

    const instant = await postCreate(humanBody({ openedAt: Date.now() }))
    expect(instant.body).toEqual({ ok: true })
    expect(submissions()).toEqual([])
  })
})

describe('POST …/submissions — the rate-limit key cannot be spoofed (finding 3)', () => {
  it('counts against the address Vercel observed, not the one the client claims', async () => {
    seedSubmissions(5) // the human IP is already at its cap

    // The old extractIp took x-forwarded-for's FIRST element, so this header
    // minted a brand-new bucket and sailed through.
    const spoofed = await postCreate(humanBody(), {
      'x-vercel-forwarded-for': HUMAN_IP,
      'x-forwarded-for': 'a-fresh-fake-ip, ' + HUMAN_IP,
    })
    expect(spoofed.body).toEqual({ ok: true }) // silently dropped
    expect(submissions()).toHaveLength(5)
  })

  it('falls back to the LAST x-forwarded-for hop when no Vercel header is present', async () => {
    seedSubmissions(5)
    const spoofed = await postCreate(humanBody(), {
      'x-forwarded-for': 'a-fresh-fake-ip, ' + HUMAN_IP,
    })
    expect(spoofed.body).toEqual({ ok: true })
    expect(submissions()).toHaveLength(5)
  })

  it('a genuinely different visitor on the same site is NOT blocked by someone else’s flood', async () => {
    seedSubmissions(5)
    const other = await postCreate(humanBody(), { 'x-vercel-forwarded-for': '198.51.100.4' })
    expect(other.body).toMatchObject({ ok: true, done: false })
  })
})

describe('POST …/submissions — the per-project ceiling bounds a distributed attack (finding 3)', () => {
  it('drops submissions once one project passes its hourly cap, from any IP', async () => {
    const { PROJECT_RATE_LIMIT_MAX } = await import('@/lib/forms/spam')
    // Every submission from a DIFFERENT IP: the per-IP cap never fires.
    for (let i = 0; i < PROJECT_RATE_LIMIT_MAX; i++) {
      submissions().push({
        id: nextUuid(),
        submitter_ip: `198.51.100.${i}`,
        project_id: PROJECT,
        tenant_id: TENANT,
      })
    }

    const res = await postCreate(humanBody(), { 'x-vercel-forwarded-for': '192.0.2.55' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true }) // silent, and nothing written
    expect(submissions()).toHaveLength(PROJECT_RATE_LIMIT_MAX)
  })

  it('and the ceiling is PER PROJECT — a flooded tenant does not lock out its neighbour', async () => {
    const { PROJECT_RATE_LIMIT_MAX } = await import('@/lib/forms/spam')
    for (let i = 0; i < PROJECT_RATE_LIMIT_MAX; i++) {
      submissions().push({ id: nextUuid(), submitter_ip: `198.51.100.${i}`, project_id: PROJECT })
    }

    const res = await postCreate(humanBody(), { 'x-vercel-forwarded-for': '192.0.2.56' }, 'other')
    expect(res.body).toMatchObject({ ok: true, done: false })
    expect(row(res.body.submissionId).project_id).toBe(OTHER_PROJECT)
  })
})

describe('POST …/submissions — the rate-limit failure mode is deliberate (finding 3)', () => {
  it('fails OPEN for a real browser when the count query errors: a Supabase blip must not eat a paying client’s lead', async () => {
    supabase.countError = { message: 'connection reset by peer' }
    const res = await postCreate(humanBody())
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, done: false })
    expect(submissions()).toHaveLength(1)
  })

  it('fails CLOSED for a caller that supplied no spam signals — its only remaining bound IS the rate limit', async () => {
    supabase.countError = { message: 'connection reset by peer' }
    const res = await postCreate({ data: { name: 'Ada', email: 'ada@example.test' } })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true }) // silent block
    expect(submissions()).toEqual([])
  })
})
