import { describe, expect, it } from 'vitest'
import {
  audienceModules,
  bodyParagraphs,
  buildClientFeed,
  cleanLocalized,
  countUnread,
  isMissingTableError,
  isSafeHttpsUrl,
  matchesAudience,
  nextStatus,
  pickLocalized,
  productUpdateSlug,
  safeUpdateImageUrl,
  updateImageObjectPath,
  updateImagePathFromUrl,
  validateProductUpdate,
  WHATS_NEW_LIMITS,
  type ProductUpdateInput,
  type ProductUpdateRow,
} from '../model'

const SB = 'https://abc.supabase.co'
const IMG = `${SB}/storage/v1/object/public/product-updates/2026/10/x-1.png`

describe('pickLocalized', () => {
  const v = { en: 'Hello', it: 'Ciao', de: '  ' }
  it('uses the viewer language', () => expect(pickLocalized(v, 'it')).toEqual({ text: 'Ciao', locale: 'it' }))
  it('falls back to English when the viewer language is empty', () => expect(pickLocalized(v, 'de')).toEqual({ text: 'Hello', locale: 'en' }))
  it('falls back to English for a language updates are not written in', () => expect(pickLocalized(v, 'fr')?.locale).toBe('en'))
  it('falls back to any filled language when English is empty', () => expect(pickLocalized({ de: 'Hallo' }, 'it')).toEqual({ text: 'Hallo', locale: 'de' }))
  it('is null when nothing is filled or the shape is wrong', () => {
    expect(pickLocalized({}, 'en')).toBeNull()
    expect(pickLocalized(null, 'en')).toBeNull()
    expect(pickLocalized('Hello', 'en')).toBeNull()
    expect(pickLocalized(['x'], 'en')).toBeNull()
  })
  it('cleanLocalized drops unknown languages and non-strings, trims', () => {
    expect(cleanLocalized({ en: ' a ', fr: 'b', it: 3 })).toEqual({ en: 'a' })
  })
})

describe('audience', () => {
  it('no modules = everyone', () => {
    expect(matchesAudience({}, [])).toBe(true)
    expect(matchesAudience({ modules: [] }, ['blog'])).toBe(true)
    expect(matchesAudience(null, [])).toBe(true)
  })
  it('modules = only projects with at least one of them enabled', () => {
    expect(matchesAudience({ modules: ['gallery'] }, ['blog'])).toBe(false)
    expect(matchesAudience({ modules: ['gallery'] }, ['blog', 'gallery'])).toBe(true)
    expect(matchesAudience({ modules: ['gallery', 'forms'] }, ['forms'])).toBe(true)
  })
  it('audienceModules ignores junk and duplicates', () => {
    expect(audienceModules({ modules: ['blog', 'blog', 3, '', ' forms '] })).toEqual(['blog', 'forms'])
    expect(audienceModules({ modules: 'blog' })).toEqual([])
  })
})

function row(over: Partial<ProductUpdateRow>): ProductUpdateRow {
  return {
    id: 'u1',
    slug: 's',
    status: 'published',
    published_at: '2026-10-01T10:00:00Z',
    title: { en: 'Title' },
    body: { en: 'Body' },
    image_url: null,
    cta_label: null,
    cta_url: null,
    audience: {},
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    ...over,
  }
}

describe('buildClientFeed', () => {
  const opts = { locale: 'it', enabledModuleIds: ['blog'], readIds: new Set(['u2']), supabaseUrl: SB }

  it('keeps published, audience-matched rows with a title; newest first; marks unread', () => {
    const feed = buildClientFeed(
      [
        row({ id: 'u1', published_at: '2026-10-01T10:00:00Z' }),
        row({ id: 'u2', published_at: '2026-10-05T10:00:00Z', title: { en: 'B', it: 'B it' } }),
        row({ id: 'u3', audience: { modules: ['gallery'] } }),
        row({ id: 'u4', status: 'draft' }),
        row({ id: 'u5', title: {} }),
      ],
      opts,
    )
    expect(feed.map((u) => u.id)).toEqual(['u2', 'u1'])
    expect(feed[0]).toMatchObject({ title: 'B it', lang: 'it', unread: false })
    expect(feed[1]).toMatchObject({ title: 'Title', lang: 'en', unread: true })
    expect(countUnread(feed)).toBe(1)
    expect(countUnread(feed, new Set(['u1']))).toBe(0)
  })

  it('shows a CTA only with an https URL and a label; images only from our bucket', () => {
    const [a] = buildClientFeed([row({ cta_label: { en: 'Open' }, cta_url: 'https://abluo.app/x', image_url: IMG })], opts)
    expect(a.cta).toEqual({ label: 'Open', url: 'https://abluo.app/x' })
    expect(a.imageUrl).toBe(IMG)
    const [b] = buildClientFeed([row({ cta_label: { en: 'Open' }, cta_url: 'javascript:alert(1)', image_url: 'https://evil.example/x.png' })], opts)
    expect(b.cta).toBeNull()
    expect(b.imageUrl).toBeNull()
  })
})

describe('urls', () => {
  it('isSafeHttpsUrl', () => {
    expect(isSafeHttpsUrl('https://abluo.app/help')).toBe(true)
    expect(isSafeHttpsUrl('http://abluo.app')).toBe(false)
    expect(isSafeHttpsUrl('https://user:pw@abluo.app')).toBe(false)
    expect(isSafeHttpsUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeHttpsUrl('not a url')).toBe(false)
    expect(isSafeHttpsUrl(`https://a.b/${'x'.repeat(WHATS_NEW_LIMITS.url)}`)).toBe(false)
  })
  it('safeUpdateImageUrl accepts only the product-updates bucket of this project', () => {
    expect(safeUpdateImageUrl(IMG, SB)).toBe(IMG)
    expect(safeUpdateImageUrl(IMG, `${SB}/`)).toBe(IMG)
    expect(safeUpdateImageUrl(`${SB}/storage/v1/object/public/avatars/a.png`, SB)).toBeNull()
    expect(safeUpdateImageUrl(`${SB}/storage/v1/object/public/product-updates/../avatars/a.png`, SB)).toBeNull()
    expect(safeUpdateImageUrl(IMG, undefined)).toBeNull()
    expect(updateImagePathFromUrl(IMG, SB)).toBe('2026/10/x-1.png')
  })
  it('updateImageObjectPath is server-chosen and clean', () => {
    const t = Date.UTC(2026, 9, 8)
    expect(updateImageObjectPath('image/png', t, 'Ab/../C')).toBe(`2026/10/${t.toString(36)}-abc.png`)
    expect(updateImageObjectPath('image/jpeg', t, '')).toMatch(/-x\.jpg$/)
  })
})

describe('validateProductUpdate', () => {
  const base: ProductUpdateInput = { title: { en: 'New' }, body: {}, ctaLabel: {}, ctaUrl: '', imageUrl: null, modules: [] }
  const opts = { knownModules: ['blog', 'gallery'], supabaseUrl: SB }

  it('accepts a title in one language and normalises', () => {
    const r = validateProductUpdate({ ...base, title: { de: ' Neu ', en: '' }, body: { de: 'Text' } }, opts)
    expect(r).toEqual({ ok: true, values: { title: { de: 'Neu' }, body: { de: 'Text' }, cta_label: null, cta_url: null, image_url: null, audience: {} } })
  })
  it('requires a title in at least one language', () => {
    expect(validateProductUpdate({ ...base, title: { en: '  ' } }, opts)).toEqual({ ok: false, errors: ['titleRequired'] })
  })
  it('enforces length limits', () => {
    const r = validateProductUpdate(
      { ...base, title: { en: 'x'.repeat(WHATS_NEW_LIMITS.title + 1) }, body: { it: 'y'.repeat(WHATS_NEW_LIMITS.body + 1) } },
      opts,
    )
    expect(r.ok === false && r.errors).toEqual(['titleTooLong', 'bodyTooLong'])
  })
  it('CTA: https only, and both URL and label', () => {
    expect(validateProductUpdate({ ...base, ctaUrl: 'http://x.y', ctaLabel: { en: 'Go' } }, opts)).toEqual({ ok: false, errors: ['ctaUrlInvalid'] })
    expect(validateProductUpdate({ ...base, ctaUrl: 'https://x.y' }, opts)).toEqual({ ok: false, errors: ['ctaLabelRequired'] })
    expect(validateProductUpdate({ ...base, ctaLabel: { en: 'Go' } }, opts)).toEqual({ ok: false, errors: ['ctaUrlRequired'] })
    const ok = validateProductUpdate({ ...base, ctaUrl: ' https://x.y/a ', ctaLabel: { it: 'Vai' } }, opts)
    expect(ok.ok && ok.values).toMatchObject({ cta_url: 'https://x.y/a', cta_label: { it: 'Vai' } })
  })
  it('image must be from our bucket; modules must be known', () => {
    expect(validateProductUpdate({ ...base, imageUrl: 'https://evil.example/a.png' }, opts)).toEqual({ ok: false, errors: ['imageInvalid'] })
    expect(validateProductUpdate({ ...base, modules: ['nope'] }, opts)).toEqual({ ok: false, errors: ['unknownModule'] })
    const ok = validateProductUpdate({ ...base, imageUrl: IMG, modules: ['gallery', 'gallery'] }, opts)
    expect(ok.ok && ok.values).toMatchObject({ image_url: IMG, audience: { modules: ['gallery'] } })
  })
})

describe('status and slug', () => {
  const now = '2026-10-08T12:00:00Z'
  it('publish sets the date once; other intents keep it', () => {
    expect(nextStatus('publish', null, now)).toEqual({ status: 'published', publishedAt: now })
    expect(nextStatus('publish', { status: 'archived', publishedAt: '2026-01-01T00:00:00Z' }, now)).toEqual({
      status: 'published',
      publishedAt: '2026-01-01T00:00:00Z',
    })
    expect(nextStatus('archive', { status: 'published', publishedAt: now }, now)).toEqual({ status: 'archived', publishedAt: now })
    expect(nextStatus('save', null, now)).toEqual({ status: 'draft', publishedAt: null })
    expect(nextStatus('save', { status: 'published', publishedAt: now }, now).status).toBe('published')
    expect(nextStatus('draft', { status: 'archived', publishedAt: now }, now).status).toBe('draft')
  })
  it('slug matches the database check', () => {
    const re = /^[a-z0-9][a-z0-9-]{1,79}$/
    for (const title of [{ en: 'Galleries: now with tabs!' }, { de: 'Größere Übersicht' }, { it: '!!!' }, {}]) {
      expect(productUpdateSlug(title, 1_700_000_000_000)).toMatch(re)
    }
    expect(productUpdateSlug({ en: 'Galleries: now with tabs!' }, 0)).toBe('galleries-now-with-tabs-0')
    expect(productUpdateSlug({ en: 'x'.repeat(200) }).length).toBeLessThanOrEqual(80)
  })
})

describe('misc', () => {
  it('bodyParagraphs splits on blank lines and line breaks', () => {
    expect(bodyParagraphs('One\nline two\r\n\r\n\nThree\n')).toEqual([['One', 'line two'], ['Three']])
    expect(bodyParagraphs('   ')).toEqual([])
  })
  it('isMissingTableError', () => {
    expect(isMissingTableError({ code: '42P01' })).toBe(true)
    expect(isMissingTableError({ code: 'PGRST205' })).toBe(true)
    expect(isMissingTableError({ code: '42501' })).toBe(false)
    expect(isMissingTableError(null)).toBe(false)
  })
})
