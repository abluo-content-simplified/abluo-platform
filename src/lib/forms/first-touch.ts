/**
 * First-touch attribution — how the visitor ARRIVED, not where the form was.
 *
 * `document.referrer` at form time is usually one of the site's own pages: by
 * the time someone fills a form they have clicked around. What a tenant wants
 * to know is the EXTERNAL entry — the landing page, the search engine / social
 * post / newsletter that sent them, the campaign tags on that first URL — and
 * how much of the site they looked at before writing.
 *
 * So once per browsing session the site layout records that entry
 * (`recordPageView`, called by `FirstTouchRecorder` on every navigation), and
 * the form reads it back at submit time (`firstTouchSourceFields`, called by
 * `collectClientSource`).
 *
 * Privacy contract — keep it this way:
 *   - sessionStorage ONLY. No cookie, no localStorage: the record dies with
 *     the tab, and is never shared across tabs or visits.
 *   - Nothing leaves the browser on its own. The record is read only when the
 *     visitor submits a form (behind that form's consent), and only these
 *     whitelisted keys reach the server (`ALLOWED_SOURCE_KEYS`).
 *   - Every storage access is wrapped: a browser that blocks storage (Safari
 *     private mode, strict settings, sandboxed iframes) gets no first-touch
 *     data and a form that works exactly as before.
 *
 * Scoping: sessionStorage is per ORIGIN, and preview hosts serve several
 * tenants from one origin (`dev.abluo.app/en/<tenant>`). Records are therefore
 * keyed by the website scope (the `[tenant]` URL segment), and the recorder
 * marks which scope is active so the form — which does not know its scope —
 * reads the right one.
 */

export const FIRST_TOUCH_KEY_PREFIX = 'abluo.ft.'
export const FIRST_TOUCH_ACTIVE_KEY = 'abluo.ft.active'

/** Cap for every stored string — the server re-bounds anyway (request-limits). */
const MAX_STORED = 2_048

export interface FirstTouchRecord {
  landing_page_url: string
  landing_page_path: string
  first_referrer: string | null
  first_referrer_domain: string | null
  first_utm_source: string | null
  first_utm_medium: string | null
  first_utm_campaign: string | null
  first_utm_term: string | null
  first_utm_content: string | null
  first_gclid: string | null
  first_fbclid: string | null
  /** ISO timestamp of the first page view in this session. */
  session_started_at: string
  /** Page views in this session, including the landing page. */
  pages_viewed: number
  /** Last path counted — a re-render of the same page is not a new view. */
  last_path?: string
}

/** Minimal Storage surface (so tests can pass a fake or a throwing one). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PageContext {
  href: string
  pathname: string
  hostname: string
  search: string
  referrer: string
}

/** sessionStorage, or null when the browser refuses it (it can THROW on access). */
export function getSessionStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null
    // The property getter itself throws when storage is blocked; a browser that
    // exposes it but refuses writes is handled by each caller's own try/catch.
    return window.sessionStorage
  } catch {
    return null
  }
}

function clip(v: string | null | undefined): string | null {
  if (!v) return null
  const t = v.trim()
  if (!t) return null
  return t.length > MAX_STORED ? t.slice(0, MAX_STORED) : t
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

/** A referrer counts as first-touch only when it is a DIFFERENT site. */
export function externalReferrer(referrer: string, hostname: string): { url: string; domain: string } | null {
  const url = clip(referrer)
  const domain = hostOf(url)
  if (!url || !domain) return null
  const norm = (h: string) => h.toLowerCase().replace(/^www\./, '')
  if (norm(domain) === norm(hostname)) return null
  return { url, domain }
}

function storageKey(scope: string): string {
  return `${FIRST_TOUCH_KEY_PREFIX}${scope || 'site'}`
}

function readRecord(storage: StorageLike, scope: string): FirstTouchRecord | null {
  try {
    const raw = storage.getItem(storageKey(scope))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const rec = parsed as FirstTouchRecord
    if (typeof rec.session_started_at !== 'string' || typeof rec.pages_viewed !== 'number') return null
    return rec
  } catch {
    return null
  }
}

/**
 * Records one page view. The FIRST call in a session (per scope) captures the
 * entry; later calls only count pages. Never throws.
 */
export function recordPageView(
  storage: StorageLike | null,
  scope: string,
  page: PageContext,
  now: number = Date.now(),
): FirstTouchRecord | null {
  if (!storage) return null
  try {
    storage.setItem(FIRST_TOUCH_ACTIVE_KEY, scope || 'site')
    const existing = readRecord(storage, scope)
    if (existing) {
      if (existing.last_path === page.pathname) return existing
      const next: FirstTouchRecord = {
        ...existing,
        pages_viewed: existing.pages_viewed + 1,
        last_path: page.pathname,
      }
      storage.setItem(storageKey(scope), JSON.stringify(next))
      return next
    }

    const params = new URLSearchParams(page.search)
    const pick = (k: string) => clip(params.get(k))
    const ext = externalReferrer(page.referrer, page.hostname)
    const rec: FirstTouchRecord = {
      landing_page_url: clip(page.href) ?? page.pathname,
      landing_page_path: page.pathname,
      first_referrer: ext?.url ?? null,
      first_referrer_domain: ext?.domain ?? null,
      first_utm_source: pick('utm_source'),
      first_utm_medium: pick('utm_medium'),
      first_utm_campaign: pick('utm_campaign'),
      first_utm_term: pick('utm_term'),
      first_utm_content: pick('utm_content'),
      first_gclid: pick('gclid'),
      first_fbclid: pick('fbclid'),
      session_started_at: new Date(now).toISOString(),
      pages_viewed: 1,
      last_path: page.pathname,
    }
    storage.setItem(storageKey(scope), JSON.stringify(rec))
    return rec
  } catch {
    return null
  }
}

/** The record for the scope the recorder last marked active, or null. Never throws. */
export function readActiveFirstTouch(storage: StorageLike | null): FirstTouchRecord | null {
  if (!storage) return null
  try {
    const scope = storage.getItem(FIRST_TOUCH_ACTIVE_KEY)
    if (!scope) return null
    return readRecord(storage, scope)
  } catch {
    return null
  }
}

/**
 * The first-touch keys merged into a submission's `source`, plus
 * `seconds_to_submit` (session start → this submit). Empty object when there is
 * no record (storage blocked, recorder not mounted) — the form still works.
 */
export function firstTouchSourceFields(
  record: FirstTouchRecord | null,
  now: number = Date.now(),
): Record<string, unknown> {
  if (!record) return {}
  const out: Record<string, unknown> = {}
  const keys: (keyof FirstTouchRecord)[] = [
    'landing_page_url',
    'landing_page_path',
    'first_referrer',
    'first_referrer_domain',
    'first_utm_source',
    'first_utm_medium',
    'first_utm_campaign',
    'first_utm_term',
    'first_utm_content',
    'first_gclid',
    'first_fbclid',
    'session_started_at',
    'pages_viewed',
  ]
  for (const k of keys) {
    const v = record[k]
    if (v !== null && v !== undefined && v !== '') out[k] = v
  }
  const started = Date.parse(record.session_started_at)
  if (Number.isFinite(started) && now >= started) {
    out.seconds_to_submit = Math.round((now - started) / 1000)
  }
  return out
}
