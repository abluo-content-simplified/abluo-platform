/**
 * "What's new" — product updates Abluo writes in the admin and clients read in
 * their dashboard (ADR-030 step 6, migration 035).
 *
 * Pure and browser-safe: types, the localized pick with fallback, audience
 * matching, unread counting and input validation. The Supabase reads/writes
 * live in `client-feed.ts` (client, own session + RLS) and `admin.ts`
 * (service role behind requireAbluoAdmin).
 */

/**
 * The languages an update is written in: the languages the dashboard interface
 * itself is translated into (messages/en|it|de.json). A client whose interface
 * is in one of them reads the update in it.
 */
export const WHATS_NEW_LOCALES = ['en', 'it', 'de'] as const
export type WhatsNewLocale = (typeof WHATS_NEW_LOCALES)[number]

/** One value per language; any may be missing. */
export type LocalizedText = Partial<Record<WhatsNewLocale, string>>

export const PRODUCT_UPDATE_STATUSES = ['draft', 'published', 'archived'] as const
export type ProductUpdateStatus = (typeof PRODUCT_UPDATE_STATUSES)[number]

/** Empty / absent `modules` = everyone. */
export type ProductUpdateAudience = { modules?: string[] }

/** A row of public.product_updates as Supabase returns it. */
export type ProductUpdateRow = {
  id: string
  slug: string
  status: ProductUpdateStatus
  published_at: string | null
  title: unknown
  body: unknown
  image_url: string | null
  cta_label: unknown
  cta_url: string | null
  audience: unknown
  created_at: string
  updated_at: string
}

export const PRODUCT_UPDATE_COLUMNS =
  'id, slug, status, published_at, title, body, image_url, cta_label, cta_url, audience, created_at, updated_at'

export const WHATS_NEW_LIMITS = {
  title: 120,
  body: 4000,
  ctaLabel: 40,
  url: 500,
  /** Updates a client sees at most (newest first). */
  feed: 50,
} as const

/** Storage bucket for update images (migration 035). */
export const PRODUCT_UPDATE_BUCKET = 'product-updates'
export const PRODUCT_UPDATE_IMAGE_MAX_BYTES = 5 * 1024 * 1024

// ── Localized values ─────────────────────────────────────────────────────────

const isLocale = (l: string): l is WhatsNewLocale => (WHATS_NEW_LOCALES as readonly string[]).includes(l)

/** A stored jsonb value → only known languages with non-empty trimmed text. */
export function cleanLocalized(value: unknown): LocalizedText {
  const out: LocalizedText = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isLocale(k) && typeof v === 'string' && v.trim() !== '') out[k] = v.trim()
  }
  return out
}

/**
 * The text to show a viewer: their UI language, else English, else the first
 * language that is filled (in WHATS_NEW_LOCALES order). Null when empty.
 */
export function pickLocalized(value: unknown, locale: string): { text: string; locale: WhatsNewLocale } | null {
  const clean = cleanLocalized(value)
  const order: WhatsNewLocale[] = [
    ...(isLocale(locale) ? [locale] : []),
    'en',
    ...WHATS_NEW_LOCALES,
  ]
  for (const l of order) {
    const text = clean[l]
    if (text) return { text, locale: l }
  }
  return null
}

// ── Audience ─────────────────────────────────────────────────────────────────

/** The module ids an audience names (unknown shapes → everyone). */
export function audienceModules(audience: unknown): string[] {
  if (!audience || typeof audience !== 'object' || Array.isArray(audience)) return []
  const modules = (audience as { modules?: unknown }).modules
  if (!Array.isArray(modules)) return []
  return [...new Set(modules.filter((m): m is string => typeof m === 'string' && m.trim() !== '').map((m) => m.trim()))]
}

/**
 * Does an update reach a project? Everyone when no modules are named;
 * otherwise the project must have at least one of them enabled.
 */
export function matchesAudience(audience: unknown, enabledModuleIds: readonly string[]): boolean {
  const modules = audienceModules(audience)
  return modules.length === 0 || modules.some((m) => enabledModuleIds.includes(m))
}

// ── The client feed ──────────────────────────────────────────────────────────

/** What the client panel renders: already in the viewer's language. */
export type ClientProductUpdate = {
  id: string
  title: string
  body: string
  /** Language the title was picked in (the body/CTA follow the same rule). */
  lang: WhatsNewLocale
  imageUrl: string | null
  cta: { label: string; url: string } | null
  publishedAt: string | null
  unread: boolean
}

/** https only, no credentials, bounded length. */
export function isSafeHttpsUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > WHATS_NEW_LIMITS.url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname !== ''
  } catch {
    return false
  }
}

/** Only images Abluo stored in this project's public `product-updates` bucket. */
export function safeUpdateImageUrl(url: unknown, supabaseUrl: string | undefined): string | null {
  if (typeof url !== 'string' || !supabaseUrl) return null
  const prefix = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${PRODUCT_UPDATE_BUCKET}/`
  if (!url.startsWith(prefix)) return null
  const rest = url.slice(prefix.length)
  return rest !== '' && !rest.includes('..') ? url : null
}

/** The object path inside the bucket for an image URL we issued, else null. */
export function updateImagePathFromUrl(url: string | null | undefined, supabaseUrl: string | undefined): string | null {
  const safe = safeUpdateImageUrl(url, supabaseUrl)
  if (!safe || !supabaseUrl) return null
  return safe.slice(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${PRODUCT_UPDATE_BUCKET}/`.length)
}

/**
 * Published rows → what one viewer on one project sees: audience-matched,
 * localized, newest first, each marked unread unless in `readIds`. Rows
 * without a title in any language are skipped.
 */
export function buildClientFeed(
  rows: readonly ProductUpdateRow[],
  opts: { locale: string; enabledModuleIds: readonly string[]; readIds: ReadonlySet<string>; supabaseUrl: string | undefined },
): ClientProductUpdate[] {
  const out: ClientProductUpdate[] = []
  for (const row of rows) {
    if (row.status !== 'published') continue
    if (!matchesAudience(row.audience, opts.enabledModuleIds)) continue
    const title = pickLocalized(row.title, opts.locale)
    if (!title) continue
    const body = pickLocalized(row.body, opts.locale)
    const ctaLabel = pickLocalized(row.cta_label, opts.locale)
    out.push({
      id: row.id,
      title: title.text,
      body: body?.text ?? '',
      lang: title.locale,
      imageUrl: safeUpdateImageUrl(row.image_url, opts.supabaseUrl),
      cta: ctaLabel && isSafeHttpsUrl(row.cta_url) ? { label: ctaLabel.text, url: row.cta_url } : null,
      publishedAt: row.published_at,
      unread: !opts.readIds.has(row.id),
    })
  }
  return out.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
}

export function countUnread(updates: readonly { id: string; unread: boolean }[], alsoRead: ReadonlySet<string> = new Set()): number {
  return updates.filter((u) => u.unread && !alsoRead.has(u.id)).length
}

/** Body text → paragraphs (blank line) → lines (single line break). */
export function bodyParagraphs(body: string): string[][] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((p) => p.length > 0)
}

// ── Admin input ──────────────────────────────────────────────────────────────

export type ProductUpdateInput = {
  title: LocalizedText
  body: LocalizedText
  ctaLabel: LocalizedText
  ctaUrl: string
  imageUrl: string | null
  modules: string[]
}

export type ProductUpdateError =
  | 'titleRequired'
  | 'titleTooLong'
  | 'bodyTooLong'
  | 'ctaLabelTooLong'
  | 'ctaUrlInvalid'
  | 'ctaLabelRequired'
  | 'ctaUrlRequired'
  | 'imageInvalid'
  | 'unknownModule'

export type ProductUpdateValues = {
  title: LocalizedText
  body: LocalizedText
  cta_label: LocalizedText | null
  cta_url: string | null
  image_url: string | null
  audience: ProductUpdateAudience
}

function tooLong(text: LocalizedText, max: number): boolean {
  return Object.values(text).some((v) => (v ?? '').length > max)
}

/**
 * Validate and normalise what the admin typed. Errors are codes (the admin UI
 * translates them). A title in at least one language; a CTA needs both an
 * https URL and a label (in some language); modules must be known ids.
 */
export function validateProductUpdate(
  input: ProductUpdateInput,
  opts: { knownModules: readonly string[]; supabaseUrl: string | undefined },
): { ok: true; values: ProductUpdateValues } | { ok: false; errors: ProductUpdateError[] } {
  const errors: ProductUpdateError[] = []
  const title = cleanLocalized(input.title)
  const body = cleanLocalized(input.body)
  const ctaLabel = cleanLocalized(input.ctaLabel)
  const ctaUrl = (input.ctaUrl ?? '').trim()

  if (Object.keys(title).length === 0) errors.push('titleRequired')
  if (tooLong(title, WHATS_NEW_LIMITS.title)) errors.push('titleTooLong')
  if (tooLong(body, WHATS_NEW_LIMITS.body)) errors.push('bodyTooLong')
  if (tooLong(ctaLabel, WHATS_NEW_LIMITS.ctaLabel)) errors.push('ctaLabelTooLong')
  if (ctaUrl && !isSafeHttpsUrl(ctaUrl)) errors.push('ctaUrlInvalid')
  if (ctaUrl && Object.keys(ctaLabel).length === 0) errors.push('ctaLabelRequired')
  if (!ctaUrl && Object.keys(ctaLabel).length > 0) errors.push('ctaUrlRequired')

  let image: string | null = null
  if (input.imageUrl) {
    image = safeUpdateImageUrl(input.imageUrl, opts.supabaseUrl)
    if (!image) errors.push('imageInvalid')
  }

  const modules = audienceModules({ modules: input.modules })
  if (modules.some((m) => !opts.knownModules.includes(m))) errors.push('unknownModule')

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    values: {
      title,
      body,
      cta_label: ctaUrl ? ctaLabel : null,
      cta_url: ctaUrl || null,
      image_url: image,
      audience: modules.length ? { modules } : {},
    },
  }
}

/** A readable, unique slug from the title (English first) + a time suffix. */
export function productUpdateSlug(title: LocalizedText, now: number = Date.now()): string {
  const source = title.en ?? WHATS_NEW_LOCALES.map((l) => title[l]).find(Boolean) ?? 'update'
  const base = source
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return `${base || 'update'}-${now.toString(36)}`
}

/**
 * The status after an admin action, and the published date to store.
 * Publishing keeps the first publication date; anything else keeps the date
 * so a re-publish after archiving does not jump to the top again.
 */
export function nextStatus(
  intent: 'save' | 'publish' | 'archive' | 'draft',
  current: { status: ProductUpdateStatus; publishedAt: string | null } | null,
  nowIso: string,
): { status: ProductUpdateStatus; publishedAt: string | null } {
  const publishedAt = current?.publishedAt ?? null
  switch (intent) {
    case 'publish':
      return { status: 'published', publishedAt: publishedAt ?? nowIso }
    case 'archive':
      return { status: 'archived', publishedAt }
    case 'draft':
      return { status: 'draft', publishedAt }
    case 'save':
      return { status: current?.status ?? 'draft', publishedAt }
  }
}

const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const

/** `YYYY/MM/{stamp}-{random}.{ext}` — a new name per upload, never a caller-chosen path. */
export function updateImageObjectPath(
  type: keyof typeof IMAGE_EXT,
  now: number = Date.now(),
  random: string = Math.random().toString(36).slice(2, 10),
): string {
  const rand = random.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12) || 'x'
  const d = new Date(now)
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${now.toString(36)}-${rand}.${IMAGE_EXT[type]}`
}

/** A Postgres/PostgREST "table does not exist" error (migration not applied yet). */
export function isMissingTableError(error: { code?: string | null } | null | undefined): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205')
}
