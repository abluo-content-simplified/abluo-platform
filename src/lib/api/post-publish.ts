/**
 * Publishing a client-dashboard post draft (ADR-025 · slice S5).
 *
 * Turns `drafts.<uuid>` into the published document `<uuid>` in ONE Sanity
 * transaction. Same enforcement as `post-drafts.ts`, plus the publish rules:
 *
 *   1. `assertModuleAction(ctx, projectId, 'blog.post.write')` before any I/O.
 *      Identity comes from the GRANT: `_id` is the draft's uuid, `_type` is
 *      always `post`, `projectSlug` is the grant's.
 *   2. The draft is re-read and must be a `post` whose own `projectSlug` equals
 *      the grant's (else "not_found", so ids can't be probed). A published doc
 *      with the same id must also be this project's post. Stale `rev` →
 *      "conflict".
 *   3. A title AND a non-empty body in the site's default language are
 *      required ("missing_title" / "missing_body"). The post goes live only in
 *      the site languages that have both a title and a non-empty body (D9 — no
 *      default-language fallback, never an empty page), each with a slug.
 *   4. Slugs: an already-published language keeps its slug (URLs never move).
 *      A new language gets one generated from its title, unique among this
 *      project's published posts for that language (-2, -3, …).
 *   5. Dates: "now" → publishedAt = now. "schedule" → publishAt must be a valid
 *      ISO date-time in the future and at most two years away; a scheduled post
 *      is just a published doc with a future publishedAt (D5, no cron).
 *      expiresAt is optional and must be after publishedAt.
 *   6. One transaction: revision-guard patch on the draft (and on the
 *      published doc when it exists), createOrReplace published, delete draft.
 *      A concurrent edit makes Sanity answer 409 → "conflict".
 *
 * Website freshness: every website route reading posts is
 * `dynamic = 'force-dynamic'` and the Sanity clients run with `useCdn: false`,
 * so the change is visible on the next request — no revalidation call or
 * webhook is needed. A scheduled post appears by itself once `publishedAt`
 * passes, via the `POST_IS_LIVE` filter in `src/lib/sanity/queries.ts`.
 *
 * Error codes (PostPublishErrorCode): the PostDraftError codes plus
 *   missing_title    — no title in the site's default language
 *   missing_body     — no text in the body in the site's default language
 *   invalid_schedule — publishAt missing, malformed, in the past or > 2 years
 *   invalid_expiry   — expiresAt malformed or not after publishedAt
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { BLOG_POST_WRITE_PERMISSION, type PostDraftErrorCode } from '@/lib/api/post-drafts'
import { slugifyNestedPath } from '@/lib/sanity/fields/nested-slug'
import { sanityWriteClient } from '@/lib/sanity/server-clients'

export type PostPublishErrorCode =
  | PostDraftErrorCode
  | 'missing_title'
  | 'missing_body'
  | 'invalid_schedule'
  | 'invalid_expiry'

export class PostPublishError extends Error {
  constructor(
    readonly code: PostPublishErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'PostPublishError'
  }
}

type PublishClient = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch' | 'transaction'>
export type PostPublishDeps = { client?: PublishClient; now?: () => Date }

export type PublishPostInput = {
  id: string
  rev: string
  mode: 'now' | 'schedule'
  publishAt?: string
  expiresAt?: string | null
}
export type PublishPostResult = { id: string; publishedAt: string; slugs: Record<string, string> }

export const SLUG_MAX = 80
export const MAX_SCHEDULE_MS = 2 * 366 * 24 * 60 * 60 * 1000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/
/** System fields and fields this step owns — never copied from the draft. */
const NOT_COPIED = new Set([
  '_id',
  '_type',
  '_rev',
  '_createdAt',
  '_updatedAt',
  'projectSlug',
  'wizard',
  'slug',
  'publishedAt',
  'expiresAt',
])

type PostDoc = Record<string, unknown> & {
  _type?: string
  _rev?: string
  projectSlug?: string
  title?: Record<string, unknown>
  slug?: Record<string, { current?: unknown } | undefined>
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !ISO.test(value)) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** One URL segment from a title: lowercase, accent-stripped, hyphenated, ≤ SLUG_MAX. */
export function slugFromTitle(title: string, maxLength = SLUG_MAX): string {
  // A post slug is a single segment — "/" in a title is a word break here.
  return slugifyNestedPath(title.replace(/\//g, ' '), maxLength).replace(/-+$/, '')
}

/** `base`, else `base-2`, `base-3`, … — whichever is not in `taken`; always ≤ SLUG_MAX. */
export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

export async function publishPostDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: PublishPostInput,
  deps: PostPublishDeps = {}
): Promise<PublishPostResult> {
  assertModuleAction(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  const client = deps.client ?? sanityWriteClient
  const now = (deps.now ?? (() => new Date()))()

  // ── Input shape and dates — refused before anything is read ────────────────
  if (typeof input?.id !== 'string' || !UUID.test(input.id)) {
    throw new PostPublishError('not_found', 'Unknown draft id.')
  }
  if (typeof input.rev !== 'string' || !input.rev) {
    throw new PostPublishError('conflict', 'Missing revision.')
  }
  let publishedAt: Date
  if (input.mode === 'now') {
    publishedAt = now
  } else if (input.mode === 'schedule') {
    const at = parseDate(input.publishAt)
    if (!at || at.getTime() <= now.getTime() || at.getTime() - now.getTime() > MAX_SCHEDULE_MS) {
      throw new PostPublishError('invalid_schedule', 'Pick a date and time in the future, within two years.')
    }
    publishedAt = at
  } else {
    throw new PostPublishError('invalid_value', 'Unknown publish mode.')
  }
  let expiresAt: Date | null = null
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    expiresAt = parseDate(input.expiresAt)
    if (!expiresAt || expiresAt.getTime() <= publishedAt.getTime()) {
      throw new PostPublishError('invalid_expiry', 'The offline date must be after the go-live date.')
    }
  }

  // ── Ownership re-read ──────────────────────────────────────────────────────
  const draftId = `drafts.${input.id}`
  const draft = (await client.getDocument(draftId)) as PostDoc | undefined
  if (!draft || draft._type !== 'post' || draft.projectSlug !== grant.projectSlug) {
    throw new PostPublishError('not_found', 'Unknown draft id.')
  }
  if (draft._rev !== input.rev) {
    throw new PostPublishError('conflict', 'This draft was edited elsewhere.')
  }
  const published = (await client.getDocument(input.id)) as PostDoc | undefined
  if (published && (published._type !== 'post' || published.projectSlug !== grant.projectSlug)) {
    throw new PostPublishError('not_found', 'Unknown draft id.')
  }

  // ── Languages (D9) ─────────────────────────────────────────────────────────
  const site = await client.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`,
    { projectSlug: grant.projectSlug }
  )
  const supported = site?.supportedLocales?.length ? site.supportedLocales : []
  const defaultLocale = site?.defaultLocale ?? supported[0]
  if (!defaultLocale) throw new PostPublishError('failed', 'Site languages are not configured.')
  const titleIn = (locale: string) => {
    const t = draft.title?.[locale]
    return typeof t === 'string' ? t.trim() : ''
  }
  const hasBody = (locale: string) => {
    const blocks = (draft.body as Record<string, unknown> | undefined)?.[locale]
    if (!Array.isArray(blocks)) return false
    return blocks.some((b) => {
      const children = (b as { children?: unknown } | null)?.children
      return (
        Array.isArray(children) &&
        children.some((c) => typeof (c as { text?: unknown })?.text === 'string' && (c as { text: string }).text.trim() !== '')
      )
    })
  }
  if (!titleIn(defaultLocale)) {
    throw new PostPublishError('missing_title', 'Add a title in the main language first.')
  }
  if (!hasBody(defaultLocale)) {
    throw new PostPublishError('missing_body', 'Write the story in the main language first.')
  }
  // D9: a language goes live only with a title AND a non-empty body.
  const locales = [defaultLocale, ...supported.filter((l) => l !== defaultLocale)].filter(
    (l) => titleIn(l) && hasBody(l)
  )

  // ── Slugs ──────────────────────────────────────────────────────────────────
  const slugs: Record<string, string> = {}
  const needed = locales.filter((l) => {
    const existing = published?.slug?.[l]?.current
    if (typeof existing === 'string' && existing) {
      slugs[l] = existing
      return false
    }
    return true
  })
  if (needed.length) {
    const others = await client.fetch<Array<{ slug?: Record<string, { current?: string } | undefined> | null }>>(
      `*[_type == "post" && projectSlug == $projectSlug && _id != $id
          && !(_id in path("drafts.**")) && !(_id in path("versions.**"))]{ slug }`,
      { projectSlug: grant.projectSlug, id: input.id }
    )
    for (const locale of needed) {
      const taken = new Set(
        (others ?? []).map((o) => o?.slug?.[locale]?.current).filter((s): s is string => typeof s === 'string')
      )
      const base = slugFromTitle(titleIn(locale)) || `post-${input.id.slice(0, 8)}`
      slugs[locale] = uniqueSlug(base, taken)
    }
  }

  // ── Published document ─────────────────────────────────────────────────────
  const doc: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(draft)) {
    if (!NOT_COPIED.has(key)) doc[key] = value
  }
  doc._id = input.id
  doc._type = 'post'
  doc.projectSlug = grant.projectSlug
  doc.slug = {
    _type: 'localizedSlug',
    ...Object.fromEntries(locales.map((l) => [l, { _type: 'slug', current: slugs[l] }])),
  }
  doc.publishedAt = publishedAt.toISOString()
  if (expiresAt) doc.expiresAt = expiresAt.toISOString()

  // ── Commit — one transaction, revision-guarded ─────────────────────────────
  try {
    let tx = client.transaction().patch(draftId, { ifRevisionID: input.rev, unset: ['_publishGuard'] })
    if (published?._rev) tx = tx.patch(input.id, { ifRevisionID: published._rev, unset: ['_publishGuard'] })
    await tx.createOrReplace(doc as { _id: string; _type: string }).delete(draftId).commit()
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) {
      throw new PostPublishError('conflict', 'This draft was edited elsewhere.')
    }
    throw new PostPublishError('failed', 'Could not publish.')
  }

  return {
    id: input.id,
    publishedAt: doc.publishedAt as string,
    slugs: Object.fromEntries(locales.map((l) => [l, slugs[l]])),
  }
}
