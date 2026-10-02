import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  recordPageView,
  readActiveFirstTouch,
  firstTouchSourceFields,
  externalReferrer,
  FIRST_TOUCH_ACTIVE_KEY,
  type StorageLike,
  type PageContext,
} from '@/lib/forms/first-touch'
import { collectClientSource } from '@/lib/forms/source'

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

const blockedStorage: StorageLike = {
  getItem: () => { throw new Error('SecurityError') },
  setItem: () => { throw new Error('QuotaExceededError') },
}

const page = (over: Partial<PageContext> = {}): PageContext => ({
  href: 'https://studio.example/en/home?utm_source=newsletter&utm_medium=email&utm_campaign=autumn&gclid=G1',
  pathname: '/en/home',
  hostname: 'studio.example',
  search: '?utm_source=newsletter&utm_medium=email&utm_campaign=autumn&gclid=G1',
  referrer: 'https://www.google.com/search?q=dentist',
  ...over,
})

const T0 = Date.UTC(2026, 9, 2, 9, 0, 0)

describe('first-touch recording', () => {
  it('captures the external entry once: landing page, referrer, campaign, session start', () => {
    const s = memoryStorage()
    const rec = recordPageView(s, 'studio', page(), T0)!
    expect(rec).toMatchObject({
      landing_page_path: '/en/home',
      first_referrer: 'https://www.google.com/search?q=dentist',
      first_referrer_domain: 'www.google.com',
      first_utm_source: 'newsletter',
      first_utm_medium: 'email',
      first_utm_campaign: 'autumn',
      first_gclid: 'G1',
      first_fbclid: null,
      pages_viewed: 1,
      session_started_at: new Date(T0).toISOString(),
    })
  })

  it('later pages only count — the entry is never overwritten by an internal page', () => {
    const s = memoryStorage()
    recordPageView(s, 'studio', page(), T0)
    const rec = recordPageView(
      s,
      'studio',
      page({ pathname: '/en/contact', href: 'https://studio.example/en/contact', search: '', referrer: 'https://studio.example/en/home' }),
      T0 + 5_000,
    )!
    expect(rec.pages_viewed).toBe(2)
    expect(rec.landing_page_path).toBe('/en/home')
    expect(rec.first_referrer_domain).toBe('www.google.com')
    expect(rec.first_utm_campaign).toBe('autumn')
  })

  it('a re-render of the same page is not a new view', () => {
    const s = memoryStorage()
    recordPageView(s, 'studio', page(), T0)
    expect(recordPageView(s, 'studio', page(), T0 + 1)!.pages_viewed).toBe(1)
  })

  it('an INTERNAL referrer is never recorded as first-touch (www. is the same site)', () => {
    expect(externalReferrer('https://studio.example/en/about', 'studio.example')).toBeNull()
    expect(externalReferrer('https://www.studio.example/x', 'studio.example')).toBeNull()
    expect(externalReferrer('', 'studio.example')).toBeNull()
    expect(externalReferrer('not a url', 'studio.example')).toBeNull()
    const s = memoryStorage()
    const rec = recordPageView(s, 'studio', page({ referrer: 'https://studio.example/en/old' }), T0)!
    expect(rec.first_referrer).toBeNull()
    expect(rec.first_referrer_domain).toBeNull()
  })

  it('records per website scope and marks the active one (shared preview origin)', () => {
    const s = memoryStorage()
    recordPageView(s, 'livener', page({ pathname: '/en/livener' }), T0)
    recordPageView(s, 'abluo', page({ pathname: '/en/abluo', referrer: '' }), T0 + 10)
    expect(s.getItem(FIRST_TOUCH_ACTIVE_KEY)).toBe('abluo')
    expect(readActiveFirstTouch(s)!.landing_page_path).toBe('/en/abluo')
  })

  it('storage blocked → no record, no throw', () => {
    expect(recordPageView(blockedStorage, 'studio', page(), T0)).toBeNull()
    expect(recordPageView(null, 'studio', page(), T0)).toBeNull()
    expect(readActiveFirstTouch(blockedStorage)).toBeNull()
    expect(firstTouchSourceFields(null)).toEqual({})
  })

  it('a corrupted record is ignored, not trusted', () => {
    const s = memoryStorage()
    s.setItem(FIRST_TOUCH_ACTIVE_KEY, 'studio')
    s.setItem('abluo.ft.studio', '{not json')
    expect(readActiveFirstTouch(s)).toBeNull()
  })

  it('source fields include pages_viewed and seconds_to_submit, omit empties', () => {
    const s = memoryStorage()
    const rec = recordPageView(s, 'studio', page({ referrer: '' }), T0)!
    const out = firstTouchSourceFields(rec, T0 + 200_400)
    expect(out.seconds_to_submit).toBe(200)
    expect(out.pages_viewed).toBe(1)
    expect('first_referrer' in out).toBe(false)
    expect('last_path' in out).toBe(false)
  })
})

describe('collectClientSource', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubBrowser(storage: StorageLike | 'throws') {
    const win: Record<string, unknown> = {
      location: {
        href: 'https://studio.example/en/contact',
        pathname: '/en/studio/contact',
        search: '',
        hostname: 'studio.example',
      },
    }
    Object.defineProperty(win, 'sessionStorage', {
      get: () => {
        if (storage === 'throws') throw new Error('SecurityError: storage disabled')
        return storage
      },
    })
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', { referrer: 'https://studio.example/en/home' })
    vi.stubGlobal('navigator', { language: 'it-IT' })
  }

  it('adds first-touch, browser language and timezone on top of the per-submit fields', () => {
    const s = memoryStorage()
    recordPageView(s, 'studio', page(), Date.now() - 90_000)
    stubBrowser(s)
    const src = collectClientSource({ source: 'header_cta' })
    expect(src).toMatchObject({
      page_path: '/en/studio/contact',
      referrer_domain: 'studio.example', // the immediate (internal) referrer is still kept
      first_referrer_domain: 'www.google.com',
      landing_page_path: '/en/home',
      first_utm_source: 'newsletter',
      pages_viewed: 1,
      browser_language: 'it-IT',
      source: 'header_cta',
    })
    expect(typeof src.timezone).toBe('string')
    expect(src.seconds_to_submit).toBeGreaterThanOrEqual(89)
  })

  it('still returns the per-submit attribution when storage access throws', () => {
    stubBrowser('throws')
    const src = collectClientSource({ source: 'footer_cta' })
    expect(src.page_path).toBe('/en/studio/contact')
    expect(src.source).toBe('footer_cta')
    expect('landing_page_url' in src).toBe(false)
    expect('seconds_to_submit' in src).toBe(false)
  })
})
