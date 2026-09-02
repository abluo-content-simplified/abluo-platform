/**
 * Abuse-resistance unit suite for the two PUBLIC form endpoints.
 *
 * Every test here targets a bypass that WORKED before this change, so each one
 * fails against the previous code:
 *
 *   1. unbounded writes  — no body cap, no per-field cap when the definition
 *      declares no `maxLength` (the code fallback declares none at all), and a
 *      non-string value skipped every length/format rule.
 *   2. omission bypasses — no `company_website` meant no honeypot check, and no
 *      `openedAt` meant `isTooFast` returned false.
 *   3. rate limiting     — keyed on the FIRST element of the client-supplied
 *      `x-forwarded-for`, per-IP only, and fail-open on any DB error.
 *
 * The companion route-level suite is
 * `src/app/api/__tests__/forms-routes-abuse.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  readJsonBodyWithLimit,
  sanitizeSourceObject,
  sanitizeScalar,
  MAX_REQUEST_BODY_BYTES,
  MAX_SOURCE_VALUE_LENGTH,
  MAX_SOURCE_URL_VALUE_LENGTH,
} from '@/lib/forms/request-limits'
import {
  evaluateHoneypot,
  evaluateTiming,
  extractIp,
  isRateLimited,
  runSpamChecks,
  RATE_LIMIT_MAX,
  RATE_LIMIT_MAX_UNVERIFIED,
  PROJECT_RATE_LIMIT_MAX,
  type RateLimitStore,
} from '@/lib/forms/spam'
import {
  resolveDefinition,
  validateStep,
  maxLengthFor,
  DEFAULT_MAX_FIELD_LENGTH,
  MAX_MULTI_VALUE_ITEMS,
} from '@/lib/forms/definitions'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── 1a. Request body cap ──────────────────────────────────────────────────────

/**
 * A Request-shaped stub. Real enough for `readJsonBodyWithLimit` (it reads
 * `headers` and `body`) and — unlike a real `Request` — able to carry a
 * `content-length` that LIES about the stream behind it, which is the case the
 * cheap header check must not be trusted for.
 */
function fakeRequest(chunks: string[], headers: Record<string, string> = {}): Request {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return {
    headers: new Headers(headers),
    body: stream,
    text: async () => chunks.join(''),
  } as unknown as Request
}

const jsonRequest = (value: unknown, headers: Record<string, string> = {}) =>
  fakeRequest([JSON.stringify(value)], { 'content-type': 'application/json', ...headers })

describe('readJsonBodyWithLimit — the request body is bounded (finding 1)', () => {
  it('caps the body well below Vercel’s 4.5 MB platform limit', () => {
    expect(MAX_REQUEST_BODY_BYTES).toBe(64 * 1024)
    expect(MAX_REQUEST_BODY_BYTES).toBeLessThan(4.5 * 1024 * 1024)
  })

  it('accepts an ordinary submission body', async () => {
    const res = await readJsonBodyWithLimit(jsonRequest({ data: { name: 'Ada' }, locale: 'en' }))
    expect(res.ok).toBe(true)
    expect(res.ok && res.body).toEqual({ data: { name: 'Ada' }, locale: 'en' })
  })

  it('rejects an oversized body on content-length alone, without reading it', async () => {
    // The stream is deliberately tiny: if the header were ignored, this would pass.
    const req = fakeRequest(['{}'], { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) })
    const res = await readJsonBodyWithLimit(req)
    expect(res).toEqual({ ok: false, status: 413, error: 'request body too large' })
  })

  it('rejects an oversized body whose content-length LIES (or is absent entirely)', async () => {
    const megabyte = 'a'.repeat(1024 * 1024)
    // Header says 10 bytes; the stream carries a megabyte. The old route read
    // `request.json()` unconditionally and would have parsed the whole thing.
    const lying = fakeRequest([JSON.stringify({ data: { message: megabyte } })], {
      'content-length': '10',
    })
    expect(await readJsonBodyWithLimit(lying)).toEqual({
      ok: false,
      status: 413,
      error: 'request body too large',
    })

    const noHeader = fakeRequest([JSON.stringify({ data: { message: megabyte } })])
    expect(await readJsonBodyWithLimit(noHeader)).toEqual({
      ok: false,
      status: 413,
      error: 'request body too large',
    })
  })

  it('aborts a chunked upload the moment it passes the cap rather than buffering it all', async () => {
    const chunk = 'x'.repeat(8 * 1024)
    const chunks = Array.from({ length: 64 }, () => chunk) // 512 KB in 64 chunks
    const res = await readJsonBodyWithLimit(fakeRequest(chunks))
    expect(res).toEqual({ ok: false, status: 413, error: 'request body too large' })
  })

  it('normalises malformed and non-object JSON to an empty body (preserving the old catch)', async () => {
    expect(await readJsonBodyWithLimit(fakeRequest(['not json']))).toEqual({ ok: true, body: {} })
    expect(await readJsonBodyWithLimit(jsonRequest([1, 2, 3]))).toEqual({ ok: true, body: {} })
    expect(await readJsonBodyWithLimit(jsonRequest('a string'))).toEqual({ ok: true, body: {} })
    expect(await readJsonBodyWithLimit(fakeRequest(['']))).toEqual({ ok: true, body: {} })
  })
})

// ── 1b. `source` key whitelist ────────────────────────────────────────────────

describe('sanitizeSourceObject — attribution is a whitelist, like context (finding 1)', () => {
  it('keeps the keys collectClientSource actually produces', () => {
    const collected = {
      page_url: 'https://client.example/en/acme/contact?utm_source=x',
      page_path: '/en/acme/contact',
      page_slug: 'contact',
      referrer: 'https://google.com/',
      referrer_domain: 'google.com',
      utm_source: 'newsletter',
      utm_medium: 'email',
      utm_campaign: 'spring',
      utm_term: null,
      utm_content: null,
      gclid: null,
      fbclid: null,
      source: 'footer_cta',
      cta_internal_name: 'Footer CTA',
      cta_label_snapshot: 'Get early access',
      device_type: 'mobile',
      country: 'IT',
    }
    expect(sanitizeSourceObject(collected)).toEqual(collected)
  })

  it('DROPS arbitrary attacker keys instead of writing them to the tenant’s database', () => {
    const out = sanitizeSourceObject({
      page_url: 'https://client.example/',
      // Everything below used to be spread wholesale into the stored JSONB.
      evil: 'x'.repeat(500_000),
      __proto__: { polluted: true },
      tenant_id: 'someone-elses-tenant',
      nested: { deep: { deeper: [1, 2, 3] } },
      arr: [1, 2, 3],
    })
    expect(out).toEqual({ page_url: 'https://client.example/' })
    expect(Object.keys(out)).not.toContain('evil')
  })

  it('truncates over-long values rather than losing the lead', () => {
    const out = sanitizeSourceObject({
      page_url: 'https://x/' + 'a'.repeat(10_000),
      utm_campaign: 'b'.repeat(10_000),
    })
    expect((out.page_url as string).length).toBe(MAX_SOURCE_URL_VALUE_LENGTH)
    expect((out.utm_campaign as string).length).toBe(MAX_SOURCE_VALUE_LENGTH)
  })

  it('returns {} for a non-object source (array, string, null)', () => {
    expect(sanitizeSourceObject([1, 2])).toEqual({})
    expect(sanitizeSourceObject('nope')).toEqual({})
    expect(sanitizeSourceObject(null)).toEqual({})
    expect(sanitizeSourceObject(undefined)).toEqual({})
  })

  it('sanitizeScalar bounds leaves and drops non-scalars', () => {
    expect(sanitizeScalar('abcdef', 3)).toBe('abc')
    expect(sanitizeScalar(42, 10)).toBe(42)
    expect(sanitizeScalar(Number.POSITIVE_INFINITY, 10)).toBeUndefined()
    expect(sanitizeScalar(NaN, 10)).toBeUndefined()
    expect(sanitizeScalar(true, 10)).toBe(true)
    expect(sanitizeScalar(null, 10)).toBeNull()
    expect(sanitizeScalar({ a: 1 }, 10)).toBeUndefined()
    expect(sanitizeScalar([1], 10)).toBeUndefined()
  })
})

// ── 1c. Per-field caps that hold with NO definition maxLength ─────────────────

describe('validateStep — every field is bounded even when the definition sets no maxLength (finding 1)', () => {
  const def = resolveDefinition('early-access')!
  const detailsBase = { role: 'founder', orgType: 'company' }

  it('the code-fallback definition genuinely declares no maxLength — the caps come from the server', () => {
    for (const step of def.steps) {
      for (const field of step.fields) expect(field.maxLength).toBeUndefined()
      for (const field of step.fields) expect(maxLengthFor(field)).toBeGreaterThan(0)
    }
    expect(DEFAULT_MAX_FIELD_LENGTH).toBe(2_000)
  })

  it('rejects a multi-megabyte `name` that used to be stored verbatim', () => {
    const errors = validateStep(def, 'contact', {
      name: 'a'.repeat(1024 * 1024),
      email: 'ada@example.test',
    })
    expect(errors.name).toBe('invalid')
  })

  it('rejects a 4 MB `email` that satisfies the email regex', () => {
    const huge = 'a'.repeat(200) + '@' + 'b'.repeat(200) + '.com'
    expect(huge).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/) // the old check passed this
    expect(validateStep(def, 'contact', { name: 'Ada', email: huge }).email).toBe('invalid')
  })

  it('rejects an unbounded `message` / `organization` while allowing a genuinely long message', () => {
    expect(
      validateStep(def, 'details', { ...detailsBase, message: 'm'.repeat(3_000) }).message,
    ).toBeUndefined() // 3k chars is a long but real message — must still go through
    expect(
      validateStep(def, 'details', { ...detailsBase, message: 'm'.repeat(9_000) }).message,
    ).toBe('invalid')
    expect(
      validateStep(def, 'details', { ...detailsBase, organization: 'o'.repeat(5_000) }).organization,
    ).toBe('invalid')
  })

  it('rejects a value sent as a nested OBJECT — which used to skip every check', () => {
    const errors = validateStep(def, 'contact', {
      name: { nested: 'a'.repeat(100_000) },
      email: 'ada@example.test',
    })
    expect(errors.name).toBe('invalid')

    // …and an object in the email field can no longer dodge the format check.
    const errors2 = validateStep(def, 'contact', { name: 'Ada', email: { toString: 'x' } })
    expect(errors2.email).toBe('invalid')
  })

  it('rejects an ARRAY in a single-value field, and bounds a real multi-value field', () => {
    expect(validateStep(def, 'contact', { name: ['Ada'], email: 'a@b.co' }).name).toBe('invalid')

    const useCases = def.steps[1].fields.find((f) => f.key === 'useCases')!
    const good = useCases.options![0]
    expect(
      validateStep(def, 'details', { ...detailsBase, useCases: [good] }).useCases,
    ).toBeUndefined()
    expect(
      validateStep(def, 'details', {
        ...detailsBase,
        useCases: Array.from({ length: MAX_MULTI_VALUE_ITEMS + 1 }, () => good),
      }).useCases,
    ).toBe('invalid')
    // Nested junk inside the array is rejected before option-membership runs.
    expect(
      validateStep(def, 'details', { ...detailsBase, useCases: [{ a: 1 }] }).useCases,
    ).toBe('invalid')
  })

  it('still accepts a completely normal submission (no legitimate user is rejected)', () => {
    expect(validateStep(def, 'contact', { name: 'Ada Lovelace', email: 'ada@example.test' })).toEqual({})
    expect(
      validateStep(def, 'details', {
        ...detailsBase,
        organization: 'Analytical Engines Ltd',
        website: 'https://example.test/a-fairly-long-path?with=query',
        message: 'Hello, we would like access. '.repeat(20),
      }),
    ).toEqual({})
  })
})

// ── 2. Omission bypasses ──────────────────────────────────────────────────────

describe('spam signals — omitting a signal is no longer a pass (finding 2)', () => {
  it('evaluateHoneypot separates "empty" (pass) from "absent" (unverified)', () => {
    expect(evaluateHoneypot('')).toBe('ok') // every first-party client sends this
    expect(evaluateHoneypot('   ')).toBe('ok')
    expect(evaluateHoneypot('http://spam.example')).toBe('failed')
    // The bypass: just do not send the key.
    expect(evaluateHoneypot(undefined)).toBe('unverified')
    expect(evaluateHoneypot(null)).toBe('unverified')
    expect(evaluateHoneypot({ company_website: 'x' })).toBe('unverified')
  })

  it('evaluateTiming separates "slow enough" from "no timestamp at all"', () => {
    const now = 1_700_000_000_000
    expect(evaluateTiming(now - 10_000, now)).toBe('ok')
    expect(evaluateTiming(now - 500, now)).toBe('failed')
    // The bypass: omit openedAt and isTooFast() returned false.
    expect(evaluateTiming(undefined, now)).toBe('unverified')
    expect(evaluateTiming('123', now)).toBe('unverified')
    expect(evaluateTiming(NaN, now)).toBe('unverified')
    // Forged: a timestamp in the future would otherwise look arbitrarily slow.
    expect(evaluateTiming(now + 60_000, now)).toBe('failed')
    // Stale beyond a day proves nothing either.
    expect(evaluateTiming(now - 3 * 24 * 60 * 60 * 1_000, now)).toBe('unverified')
  })
})

// ── 3. Rate limiting ──────────────────────────────────────────────────────────

const STORE: RateLimitStore = {
  table: 'form_submissions',
  ipColumn: 'submitter_ip',
  projectColumn: 'project_id',
}

/** Minimal count-query stub: returns `count` (or an error) for any filter. */
function countingSupabase(byColumn: Record<string, number>, error?: { message: string }) {
  const calls: { column: string; value: unknown }[] = []
  const client = {
    from: () => {
      let column = ''
      let value: unknown
      const b: Record<string, unknown> = {}
      const chain = () => b
      Object.assign(b, {
        select: chain,
        gte: chain,
        eq: (c: string, v: unknown) => {
          column = c
          value = v
          return b
        },
        filter: (c: string, _op: string, v: unknown) => {
          column = c
          value = v
          return b
        },
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => {
          calls.push({ column, value })
          return Promise.resolve(
            error ? { count: null, error } : { count: byColumn[column] ?? 0, error: null },
          ).then(ok, err)
        },
      })
      return b
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('rate limiting — a sound key, a project ceiling, and a deliberate failure mode (finding 3)', () => {
  it('extractIp prefers the header the CLIENT cannot set', () => {
    // The bypass: x-forwarded-for is client-supplied and the old code took its
    // FIRST element, so one header minted a fresh bucket per request.
    expect(
      extractIp(
        new Headers({
          'x-forwarded-for': 'evil-spoof-1',
          'x-vercel-forwarded-for': '203.0.113.7',
        }),
      ),
    ).toBe('203.0.113.7')

    expect(
      extractIp(new Headers({ 'x-forwarded-for': 'evil-spoof-2', 'x-real-ip': '203.0.113.7' })),
    ).toBe('203.0.113.7')

    // Falling back to XFF, the LAST element is the one our edge observed.
    expect(extractIp(new Headers({ 'x-forwarded-for': 'evil-spoof-3, 203.0.113.7' }))).toBe(
      '203.0.113.7',
    )
    // Vercel sends a single address, so production behaviour is unchanged.
    expect(extractIp(new Headers({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(extractIp(new Headers())).toBe('dev-local')
  })

  it('applies a STRICTER per-IP cap to a caller that skipped the honeypot/timer', async () => {
    const at = (n: number) => countingSupabase({ submitter_ip: n }).client
    const vouched = { honeypot: '', openedAt: Date.now() - 10_000, ip: '1.2.3.4' }
    const silent = { ip: '1.2.3.4', honeypot: undefined, openedAt: undefined }

    expect(RATE_LIMIT_MAX_UNVERIFIED).toBeLessThan(RATE_LIMIT_MAX)

    // At 3 prior submissions the silent caller is done; a real browser is not.
    expect((await runSpamChecks(silent, at(RATE_LIMIT_MAX_UNVERIFIED), STORE)).reason).toBe('rate_limit')
    expect((await runSpamChecks(vouched, at(RATE_LIMIT_MAX_UNVERIFIED), STORE)).blocked).toBe(false)
    // Both are stopped at the lenient cap.
    expect((await runSpamChecks(vouched, at(RATE_LIMIT_MAX), STORE)).reason).toBe('rate_limit')
  })

  it('adds a PER-PROJECT ceiling so a distributed attack still hits a wall', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = countingSupabase({ submitter_ip: 0, project_id: PROJECT_RATE_LIMIT_MAX }).client
    const res = await runSpamChecks(
      { honeypot: '', openedAt: Date.now() - 10_000, ip: 'a-fresh-ip', projectId: 'project-1' },
      supabase,
      STORE,
    )
    // The IP is clean — only the project total is over.
    expect(res).toEqual({ blocked: true, reason: 'project_rate_limit' })
    vi.restoreAllMocks()
  })

  it('the project ceiling is scoped per project — one abused tenant cannot lock out another', async () => {
    const { client, calls } = countingSupabase({ submitter_ip: 0, project_id: 0 })
    await runSpamChecks(
      { honeypot: '', openedAt: Date.now() - 10_000, ip: 'ip', projectId: 'project-1' },
      client,
      STORE,
    )
    expect(calls).toEqual([
      { column: 'submitter_ip', value: 'ip' },
      { column: 'project_id', value: 'project-1' },
    ])
  })

  it('a DB error fails OPEN for a vouched request and CLOSED for an unverified one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = () => countingSupabase({}, { message: 'connection reset' }).client

    // A real browser must not lose its lead to a Supabase blip: the INSERT that
    // follows would fail anyway if Supabase were truly down.
    expect(
      (await runSpamChecks({ honeypot: '', openedAt: Date.now() - 10_000, ip: 'ip' }, broken(), STORE))
        .blocked,
    ).toBe(false)

    // A caller that declined to prove it is a browser has the rate limit as its
    // only remaining bound, so an unavailable counter is a rejection.
    expect(
      (await runSpamChecks({ honeypot: undefined, openedAt: undefined, ip: 'ip' }, broken(), STORE))
        .reason,
    ).toBe('rate_limit')

    // The low-level helper honours the flag both ways.
    expect(await isRateLimited('ip', broken(), STORE, { failClosed: true })).toBe(true)
    expect(await isRateLimited('ip', broken(), STORE, { failClosed: false })).toBe(false)
    vi.restoreAllMocks()
  })

  it('honeypot and timing still short-circuit before any DB work', async () => {
    const { client, calls } = countingSupabase({})
    expect(await runSpamChecks({ honeypot: 'bot', openedAt: undefined, ip: 'ip' }, client, STORE)).toEqual({
      blocked: true,
      reason: 'honeypot',
    })
    expect(await runSpamChecks({ honeypot: '', openedAt: Date.now(), ip: 'ip' }, client, STORE)).toEqual({
      blocked: true,
      reason: 'timing',
    })
    expect(calls).toEqual([])
  })
})
