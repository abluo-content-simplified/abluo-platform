/**
 * The client dashboard's ONLY write path into Sanity (ADR-025 · slice S2b).
 *
 * The wizard and, later, the direct editor create and autosave blog-post
 * DRAFTS (`drafts.<uuid>`). Drafts are invisible to the websites (the API's
 * default `published` perspective), so nothing a client types here can reach a
 * live site until a separate, later publish step (S5).
 *
 * Enforcement, in order, on every call:
 *   1. `assertModuleAction(ctx, projectId, 'blog.post.write')` — a grant on the
 *      project, Blog installed, a role holding the write permission (owner /
 *      editor; never viewer).
 *   2. Identity comes from the GRANT, never from the caller: the server picks
 *      the id, `_type` is always `post`, `projectSlug` is the grant's.
 *   3. Before every patch the draft is re-read and must be a `post` draft whose
 *      own `projectSlug` equals the grant's — another project's draft is
 *      reported as "not found", so ids can't be probed.
 *   4. Field allowlist: title / subtitle / excerpt / body per language, the
 *      categories configured for this site, and the hidden wizard position
 *      (`wizard.step` = where the user is, `wizard.furthest` = the furthest
 *      step reached in the first pass; 'review' is the overview)
 *      (ADR-025 D3). Anything else — projectSlug, _type, _id, slug, author,
 *      publish dates, images — is refused. Languages must be the site's own.
 *      Body blocks are rebuilt from a strict shape (unknown keys dropped).
 *   5. Size limits, then `ifRevisionId` so two tabs can't silently overwrite
 *      each other ("conflict" → the UI says "edited elsewhere").
 */
import { randomUUID } from 'crypto'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { POST_CTA_MODES } from '@/lib/blog/post-cta'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import { bodyReference, cleanLink, collectInternalRefs, preserved } from '@/lib/client/normalize-blocks'
import { LINK_TARGET_TYPES } from '@/lib/links/link-target'

export const BLOG_POST_WRITE_PERMISSION = 'blog.post.write'

export const WIZARD_STEPS = [
  'type',
  'category',
  'title',
  'story',
  'cover',
  'languages',
  // Overview-only edit screen (never part of the first pass).
  'cta',
  'preview',
  'publish',
  'promote',
  'review',
  'done',
] as const
export type WizardStep = (typeof WIZARD_STEPS)[number]

export type PostDraftErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_field'
  | 'invalid_value'
  | 'too_large'
  | 'conflict'
  | 'failed'

export class PostDraftError extends Error {
  constructor(
    readonly code: PostDraftErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'PostDraftError'
  }
}

type WriteClient = Pick<typeof sanityWriteClient, 'create' | 'getDocument' | 'patch' | 'fetch'>
export type PostDraftDeps = { client?: WriteClient; now?: () => Date; uuid?: () => string }

export const LIMITS = {
  title: 200,
  subtitle: 300,
  excerpt: 1000,
  categories: 10,
  blocks: 2000,
  spansPerBlock: 500,
  spanText: 20_000,
  markDefsPerBlock: 100,
  href: 2048,
  patchBytes: 1_000_000,
} as const

/**
 * A post's public id. Dashboard-created posts use a uuid, migrated posts a
 * readable id (`hoffmann-post-…`). Letters, digits, `_` and `-` only: no dots
 * (so never `drafts.` / `versions.` or any other path), no slashes, ≤ 128.
 * Ownership is always re-checked on the document itself.
 */
const POST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
export function isPostId(id: unknown): id is string {
  return typeof id === 'string' && POST_ID.test(id)
}
const KEY = /^[A-Za-z0-9_-]{1,64}$/
const LOCALIZED: Record<string, { type: string; max?: number; blocks?: true }> = {
  title: { type: 'localizedString', max: LIMITS.title },
  subtitle: { type: 'localizedString', max: LIMITS.subtitle },
  excerpt: { type: 'localizedText', max: LIMITS.excerpt },
  body: { type: 'localizedPortableText', blocks: true },
}
const BLOCK_STYLES = ['normal', 'h2', 'h3', 'blockquote']
const LIST_ITEMS = ['bullet', 'number']
const DECORATORS = ['strong', 'em']

function grantFor(ctx: TenantAuthorizationContext, projectId: string) {
  assertModuleAction(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  // assertModuleAction guarantees the grant exists.
  return ctx.projects.find((p) => p.projectId === projectId)!
}

/** Creates an empty post draft for the caller's project. Returns its public id. */
export async function createPostDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  deps: PostDraftDeps = {}
): Promise<{ id: string; rev: string }> {
  const grant = grantFor(ctx, projectId)
  const client = deps.client ?? sanityWriteClient
  const id = (deps.uuid ?? randomUUID)()
  const now = (deps.now ?? (() => new Date()))().toISOString()
  await assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug)
  const created = await client.create({
    _id: `drafts.${id}`,
    _type: 'post',
    projectSlug: grant.projectSlug,
    wizard: { step: 'type', updatedAt: now },
  })
  return { id, rev: (created as { _rev?: string })._rev ?? '' }
}

/** Validates and applies one autosave patch. Returns the new revision. */
export async function patchPostDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string; set: Record<string, unknown> },
  deps: PostDraftDeps = {}
): Promise<{ rev: string }> {
  const grant = grantFor(ctx, projectId)
  const client = deps.client ?? sanityWriteClient

  if (!isPostId(input.id)) {
    throw new PostDraftError('not_found', 'Unknown draft id.')
  }
  if (typeof input.rev !== 'string' || !input.rev) {
    throw new PostDraftError('conflict', 'Missing revision.')
  }
  if (!input.set || typeof input.set !== 'object' || Array.isArray(input.set)) {
    throw new PostDraftError('invalid_value', 'Nothing to save.')
  }
  if (JSON.stringify(input.set).length > LIMITS.patchBytes) {
    throw new PostDraftError('too_large', 'Patch too large.')
  }

  const draftId = `drafts.${input.id}`
  const current = (await client.getDocument(draftId)) as
    | { _type?: string; _rev?: string; projectSlug?: string }
    | undefined
  // Another project's draft and a missing draft look the same to the caller.
  if (!current || current._type !== 'post' || current.projectSlug !== grant.projectSlug) {
    throw new PostDraftError('not_found', 'Unknown draft id.')
  }
  if (current._rev !== input.rev) {
    throw new PostDraftError('conflict', 'This draft was edited elsewhere.')
  }
  // The published document under the same id (edit mode) must be this
  // project's post too — same rule as getPostDraft / publish / lifecycle.
  const published = (await client.getDocument(input.id)) as { _type?: string; projectSlug?: string } | undefined
  if (published && (published._type !== 'post' || published.projectSlug !== grant.projectSlug)) {
    throw new PostDraftError('not_found', 'Unknown draft id.')
  }

  const site = await client.fetch<{
    locales?: string[] | null
    categories?: string[] | null
  } | null>(
    `{
      "locales": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].supportedLocales,
      "categories": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]
        .moduleInstallations[moduleId == "blog"][0].config.categories[].value
    }`,
    { projectSlug: grant.projectSlug }
  )
  const locales = site?.locales?.length ? site.locales : []
  const categoryKeys = site?.categories ?? []

  const set: Record<string, unknown> = {}
  const unset: string[] = []
  const ensure: Record<string, unknown> = {}
  // Links round 2: internal-link targets added in this patch (checked below in one read).
  const newInternalRefs = new Set<string>()

  for (const [path, value] of Object.entries(input.set)) {
    const [field, locale, ...rest] = path.split('.')

    if (path === 'categories') {
      if (!Array.isArray(value) || value.length > LIMITS.categories) {
        throw new PostDraftError('invalid_value', 'Categories must be a short list.')
      }
      const keys = [...new Set(value)]
      if (!keys.every((k) => typeof k === 'string' && categoryKeys.includes(k))) {
        throw new PostDraftError('invalid_value', 'Unknown category.')
      }
      if (keys.length) set.categories = keys
      else unset.push('categories')
      continue
    }

    // Call to action at the end of the post: the website default, none, or one
    // of THIS project's callToAction documents (ADR-027), stored as a weak ref.
    if (path === 'cta.mode') {
      if (!(POST_CTA_MODES as readonly unknown[]).includes(value)) {
        throw new PostDraftError('invalid_value', 'Unknown call-to-action choice.')
      }
      ensure.cta = {}
      set[path] = value
      continue
    }
    if (path === 'cta.ref') {
      if (value === null || value === '') {
        unset.push(path)
        continue
      }
      if (!isPostId(value)) throw new PostDraftError('invalid_value', 'Unknown call to action.')
      // One read: the id must be a callToAction of THIS project (published).
      const found = await client.fetch<string | null>(
        `*[_type == "callToAction" && _id == $id && projectSlug == $projectSlug][0]._id`,
        { id: value, projectSlug: grant.projectSlug }
      )
      if (found !== value) throw new PostDraftError('invalid_value', 'Unknown call to action.')
      ensure.cta = {}
      set[path] = { _type: 'reference', _ref: value, _weak: true }
      continue
    }

    if (path === 'wizard.step' || path === 'wizard.furthest') {
      if (!WIZARD_STEPS.includes(value as WizardStep)) {
        throw new PostDraftError('invalid_value', 'Unknown wizard step.')
      }
      set[path] = value
      continue
    }

    const spec = LOCALIZED[field]
    if (!spec || !locale || rest.length || !locales.includes(locale)) {
      throw new PostDraftError('invalid_field', `Field "${path}" cannot be changed here.`)
    }
    ensure[field] = { _type: spec.type }

    if (spec.blocks) {
      // Wave 2 (edit existing posts): content the dashboard can't create (images,
      // h1/h4, unknown annotations) is accepted only as an unchanged copy of
      // what this draft already stores for the language.
      const stored = (current as { body?: Record<string, unknown> }).body?.[locale]
      const blocks = sanitizeBlocks(value, stored)
      const storedRefs = collectInternalRefs(stored)
      for (const ref of collectInternalRefs(blocks)) if (!storedRefs.has(ref)) newInternalRefs.add(ref)
      if (blocks.length) set[path] = blocks
      else unset.push(path)
      continue
    }
    if (typeof value !== 'string' || value.length > (spec.max ?? 0)) {
      throw new PostDraftError('invalid_value', `"${path}" is too long or not text.`)
    }
    if (value.trim()) set[path] = value
    else unset.push(path)
  }

  // A NEW internal link must point at a published page / post / news item /
  // event of THIS project (refs already stored are left alone, so a target
  // deleted later never blocks saving). One read for the whole patch.
  if (newInternalRefs.size) {
    const ids = [...newInternalRefs]
    const found = await client.fetch<string[] | null>(
      `*[_id in $ids && _type in $types && projectSlug == $projectSlug]._id`,
      { ids, types: [...LINK_TARGET_TYPES], projectSlug: grant.projectSlug }
    )
    const ok = new Set(Array.isArray(found) ? found : [])
    if (!ids.every((id) => ok.has(id))) {
      throw new PostDraftError('invalid_value', 'That link points to a page that is not on this website.')
    }
  }

  set['wizard.updatedAt'] = (deps.now ?? (() => new Date()))().toISOString()

  await assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug)
  try {
    let patch = client.patch(draftId).ifRevisionId(input.rev)
    if (Object.keys(ensure).length) patch = patch.setIfMissing(ensure)
    patch = patch.set(set)
    if (unset.length) patch = patch.unset(unset)
    const result = (await patch.commit()) as { _rev?: string }
    return { rev: result._rev ?? '' }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) {
      throw new PostDraftError('conflict', 'This draft was edited elsewhere.')
    }
    throw new PostDraftError('failed', 'Could not save.')
  }
}

/**
 * Rebuilds Portable Text blocks from a strict shape: paragraphs, h2/h3,
 * quotes, bullet/number lists, bold/italic and links with a safe href
 * (http(s), mailto:, tel:, site-relative "/…"). Unknown keys are dropped.
 *
 * `existing` is the body currently stored for this language. Anything the
 * dashboard can't create — a non-text block (image, embed), an inline object,
 * an unknown annotation — is accepted ONLY as a deep-equal copy (same `_key`)
 * of something in `existing`; unsupported styles / list types / decorators
 * (h1, h4, code…) only if `existing` already uses them. Without `existing`
 * (new content, AI input) the strict shape applies. Never accepts new
 * arbitrary objects from the client. Mirrors `normalizeBlocks`.
 */
export function sanitizeBlocks(value: unknown, existing?: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > LIMITS.blocks) {
    throw new PostDraftError('invalid_value', 'Body must be a list of blocks.')
  }
  const ref = bodyReference(existing)
  const blockKeys = new Set<string>()
  return value.map((raw) => {
    const b = raw as Record<string, unknown>
    if (!b || typeof b !== 'object' || typeof b._key !== 'string' || !KEY.test(b._key) || blockKeys.has(b._key)) {
      throw new PostDraftError('invalid_value', 'Unsupported body block.')
    }
    blockKeys.add(b._key)
    if (b._type !== 'block') {
      const kept = preserved(b, ref.objects)
      if (!kept) throw new PostDraftError('invalid_value', 'Unsupported body block.')
      return kept
    }
    const style = b.style ?? 'normal'
    if (typeof style !== 'string' || !(BLOCK_STYLES.includes(style) || ref.styles.has(style))) {
      throw new PostDraftError('invalid_value', 'Unsupported style.')
    }
    const block: Record<string, unknown> = { _type: 'block', _key: b._key, style, markDefs: [] }
    if (b.listItem !== undefined) {
      if (typeof b.listItem !== 'string' || !(LIST_ITEMS.includes(b.listItem) || ref.lists.has(b.listItem))) {
        throw new PostDraftError('invalid_value', 'Unsupported list.')
      }
      const level = b.level ?? 1
      if (!Number.isInteger(level) || (level as number) < 1 || (level as number) > 4) {
        throw new PostDraftError('invalid_value', 'Unsupported list level.')
      }
      block.listItem = b.listItem
      block.level = level
    }
    if (b.markDefs !== undefined && (!Array.isArray(b.markDefs) || b.markDefs.length > LIMITS.markDefsPerBlock)) {
      throw new PostDraftError('invalid_value', 'Unsupported links.')
    }
    const defs = new Map<string, Record<string, unknown>>()
    for (const d of (b.markDefs as unknown[] | undefined) ?? []) {
      const def = cleanLink(d) ?? preserved(d, ref.markDefs)
      if (!def || defs.has(def._key)) throw new PostDraftError('invalid_value', 'Unsupported link.')
      defs.set(def._key, def)
    }
    if (!Array.isArray(b.children) || b.children.length === 0 || b.children.length > LIMITS.spansPerBlock) {
      throw new PostDraftError('invalid_value', 'Unsupported block content.')
    }
    const usedMarks = new Set<string>()
    const childKeys = new Set<string>()
    block.children = b.children.map((rawSpan) => {
      const s = rawSpan as Record<string, unknown>
      if (!s || typeof s._key !== 'string' || !KEY.test(s._key) || childKeys.has(s._key)) {
        throw new PostDraftError('invalid_value', 'Unsupported text.')
      }
      childKeys.add(s._key)
      if (s._type !== 'span') {
        const kept = preserved(s, ref.inlines)
        if (!kept) throw new PostDraftError('invalid_value', 'Unsupported text.')
        return kept
      }
      if (typeof s.text !== 'string' || s.text.length > LIMITS.spanText) {
        throw new PostDraftError('invalid_value', 'Text too long.')
      }
      const marks = s.marks ?? []
      if (
        !Array.isArray(marks) ||
        !marks.every((m) => typeof m === 'string' && (DECORATORS.includes(m) || ref.decorators.has(m) || defs.has(m)))
      ) {
        throw new PostDraftError('invalid_value', 'Unsupported formatting.')
      }
      for (const m of marks) usedMarks.add(m)
      return { _type: 'span', _key: s._key, text: s.text, marks: [...new Set(marks)] }
    })
    // Unused definitions are dropped (the editor treats them as orphaned data).
    block.markDefs = [...defs.values()].filter((d) => usedMarks.has(d._key as string))
    return block
  })
}

// ── Reads for the wizard (ADR-025 · S2c) ─────────────────────────────────────
//
// Drafts are invisible to every website query (published perspective). The
// wizard reads them here, through the same write-permission gate as the patch
// path: a viewer can list posts, but a draft is something you EDIT, so opening
// one needs 'blog.post.write'. Ownership is re-checked on the document itself
// (projectSlug from the grant); another project's draft is "not_found".

/** One draft, as the wizard shell needs it (mirrors `DraftSnapshot`). */
export type PostDraftSnapshot = {
  id: string
  rev: string
  title: Record<string, string>
  subtitle: Record<string, string>
  excerpt: Record<string, string>
  body: Record<string, unknown[]>
  categories: string[]
  cover: { assetId: string; url: string; alt: Record<string, string>; focal?: { x: number; y: number } | null } | null
  step: WizardStep
  /** Furthest step reached in the first pass (drafts from before it existed: their step). */
  furthest: WizardStep
  /** 'edit' when a published version exists (the draft holds unpublished changes to it). */
  mode: 'create' | 'edit'
  /** The published version's state, when there is one. */
  live: PostLiveState | null
  /** The post's call-to-action choice; null = never chosen (= the site default). */
  cta: { mode: 'default' | 'none' | 'custom'; ref: string | null } | null
}

/** What the editor needs to know about the live version of a post. */
export type PostLiveState = {
  rev: string
  publishedAt: string | null
  expiresAt: string | null
  /** Slug per language, for "View on your site". */
  slugs: Record<string, string>
}

export function liveState(doc: Record<string, unknown>): PostLiveState {
  const slugs: Record<string, string> = {}
  const raw = doc.slug as Record<string, { current?: unknown } | unknown> | undefined
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      const cur = (v as { current?: unknown } | null)?.current
      if (!k.startsWith('_') && typeof cur === 'string' && cur) slugs[k] = cur
    }
  }
  return {
    rev: typeof doc._rev === 'string' ? doc._rev : '',
    publishedAt: typeof doc.publishedAt === 'string' ? doc.publishedAt : null,
    expiresAt: typeof doc.expiresAt === 'string' ? doc.expiresAt : null,
    slugs,
  }
}

/** A row of the "Continue editing" list. */
export type PostDraftSummary = {
  id: string
  /** Title in the site's default language, else any language; null when untitled. */
  title: string | null
  step: WizardStep
  furthest: WizardStep
  updatedAt: string
  /** Every language's title (for search and the language badges in the posts list). */
  titles: Record<string, string>
  categoryKeys: string[]
  /** Small square cover thumbnail cropped around the focal point, or null. */
  coverThumb: string | null
}

/** What the wizard needs to know about the site. Mirrors `SiteInfo`. */
export type PostEditorSite = {
  projectSlug: string
  defaultLocale: string
  languages: string[]
  categories: { value: string; label: string }[]
  /** `https://<customDomain>`, or null when the site has no domain yet. */
  origin: string | null
  /** The site's prepared calls to action, texts in the site's main language. Empty = feature hidden. */
  ctas: PostEditorCta[]
}

export type PostEditorCta = {
  /** The callToAction document id. */
  id: string
  name: string
  isDefault: boolean
  heading: string | null
  buttonLabel: string | null
}

function ctaChoice(value: unknown): PostDraftSnapshot['cta'] {
  const v = value as { mode?: unknown; ref?: { _ref?: unknown } | null } | null | undefined
  if (!v || typeof v !== 'object') return null
  const mode = (POST_CTA_MODES as readonly unknown[]).includes(v.mode) ? (v.mode as 'default' | 'none' | 'custom') : 'default'
  const ref = v.ref?._ref
  return { mode, ref: typeof ref === 'string' && ref ? ref.replace(/^drafts\./, '') : null }
}

function textMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [k, v] of Object.entries(value)) {
    if (!k.startsWith('_') && typeof v === 'string') out[k] = v
  }
  return out
}

function blockMap(value: unknown): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [k, v] of Object.entries(value)) {
    if (!k.startsWith('_') && Array.isArray(v)) out[k] = v
  }
  return out
}

function asStep(value: unknown): WizardStep {
  return WIZARD_STEPS.includes(value as WizardStep) ? (value as WizardStep) : 'type'
}

/** Reads one of the caller's project drafts for the wizard. */
export async function getPostDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  id: string,
  deps: PostDraftDeps = {}
): Promise<PostDraftSnapshot> {
  const grant = grantFor(ctx, projectId)
  const client = deps.client ?? sanityWriteClient
  if (!isPostId(id)) {
    throw new PostDraftError('not_found', 'Unknown draft id.')
  }
  const doc = (await client.getDocument(`drafts.${id}`)) as Record<string, unknown> | undefined
  if (!doc || doc._type !== 'post' || doc.projectSlug !== grant.projectSlug) {
    throw new PostDraftError('not_found', 'Unknown draft id.')
  }
  // A draft over a live post is "edit" mode: the overview offers Update post.
  const published = (await client.getDocument(id)) as Record<string, unknown> | undefined
  if (published && (published._type !== 'post' || published.projectSlug !== grant.projectSlug)) {
    throw new PostDraftError('not_found', 'Unknown draft id.')
  }

  let cover: PostDraftSnapshot['cover'] = null
  const image = doc.coverImage as
    | { asset?: { _ref?: unknown }; alt?: unknown; hotspot?: { x?: unknown; y?: unknown } }
    | undefined
  const ref = image?.asset?._ref
  if (typeof ref === 'string' && ref) {
    const url = await client.fetch<string | null>(`*[_id == $ref][0].url`, { ref })
    if (typeof url === 'string' && url) {
      const hx = image?.hotspot?.x
      const hy = image?.hotspot?.y
      const focal =
        typeof hx === 'number' && typeof hy === 'number' && hx >= 0 && hx <= 1 && hy >= 0 && hy <= 1
          ? { x: hx, y: hy }
          : undefined
      cover = { assetId: ref, url, alt: textMap(image?.alt), ...(focal ? { focal } : {}) }
    }
  }

  const wizard = doc.wizard as { step?: unknown; furthest?: unknown } | undefined
  return {
    id,
    rev: typeof doc._rev === 'string' ? doc._rev : '',
    title: textMap(doc.title),
    subtitle: textMap(doc.subtitle),
    excerpt: textMap(doc.excerpt),
    body: blockMap(doc.body),
    categories: Array.isArray(doc.categories) ? doc.categories.filter((c): c is string => typeof c === 'string') : [],
    cover,
    step: published ? 'review' : asStep(wizard?.step),
    furthest: published ? 'review' : asStep(wizard?.furthest ?? wizard?.step),
    mode: published ? 'edit' : 'create',
    live: published ? liveState(published) : null,
    cta: ctaChoice(doc.cta),
  }
}

/** The caller's project's unfinished wizard drafts, most recently edited first. */
export async function listPostDrafts(
  ctx: TenantAuthorizationContext,
  projectId: string,
  deps: PostDraftDeps = {}
): Promise<PostDraftSummary[]> {
  const grant = grantFor(ctx, projectId)
  const client = deps.client ?? sanityWriteClient
  const result = await client.fetch<{
    defaultLocale?: string | null
    drafts?: Array<{
      _id?: string
      projectSlug?: string
      title?: unknown
      categories?: unknown
      step?: unknown
      furthest?: unknown
      updatedAt?: string
      coverUrl?: unknown
      hotspot?: { x?: unknown; y?: unknown } | null
    }> | null
  } | null>(
    `{
      "defaultLocale": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].defaultLocale,
      "drafts": *[_type == "post" && _id in path("drafts.**") && projectSlug == $projectSlug && defined(wizard.step)]
        | order(coalesce(wizard.updatedAt, _updatedAt) desc)[0...50]{
          _id, projectSlug, title, categories, "step": wizard.step, "furthest": coalesce(wizard.furthest, wizard.step), "updatedAt": coalesce(wizard.updatedAt, _updatedAt),
          "coverUrl": coverImage.asset->url, "hotspot": coverImage.hotspot
        }
    }`,
    { projectSlug: grant.projectSlug },
    { perspective: 'raw' }
  )
  const defaultLocale = result?.defaultLocale ?? ''
  return (result?.drafts ?? [])
    .filter((d) => typeof d?._id === 'string' && d._id.startsWith('drafts.') && d.projectSlug === grant.projectSlug)
    .map((d) => {
      const titles = textMap(d.title)
      const title =
        (titles[defaultLocale]?.trim() && titles[defaultLocale]) ||
        Object.values(titles).find((t) => t.trim()) ||
        null
      return {
        id: d._id!.slice('drafts.'.length),
        title,
        step: asStep(d.step),
        furthest: asStep(d.furthest ?? d.step),
        updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : '',
        titles,
        categoryKeys: Array.isArray(d.categories) ? d.categories.filter((c): c is string => typeof c === 'string') : [],
        coverThumb: coverThumbUrl(d.coverUrl, d.hotspot, 192),
      }
    })
}

/** Sanity CDN square thumbnail, cropped around the focal point when one is set. */
export function coverThumbUrl(url: unknown, hotspot?: { x?: unknown; y?: unknown } | null, size = 160): string | null {
  if (typeof url !== 'string' || !url.startsWith('https://cdn.sanity.io/')) return null
  const params = new URLSearchParams({ w: String(size), h: String(size), fit: 'crop', auto: 'format' })
  const x = hotspot?.x
  const y = hotspot?.y
  if (typeof x === 'number' && typeof y === 'number' && x >= 0 && x <= 1 && y >= 0 && y <= 1) {
    params.set('crop', 'focalpoint')
    params.set('fp-x', x.toFixed(3))
    params.set('fp-y', y.toFixed(3))
  }
  return `${url}?${params.toString()}`
}

/** Site languages, blog categories (labels in `locale`) and public origin, for the wizard. */
export async function getPostEditorSite(
  ctx: TenantAuthorizationContext,
  projectId: string,
  params: { locale: string },
  deps: PostDraftDeps = {}
): Promise<PostEditorSite> {
  const grant = grantFor(ctx, projectId)
  const client = deps.client ?? sanityWriteClient
  const r = await client.fetch<{
    site?: { defaultLocale?: string | null; supportedLocales?: string[] | null } | null
    categories?: Array<{ value?: string; label?: unknown }> | null
    customDomain?: string | null
    ctas?: Array<{ _id?: unknown; internalName?: unknown; isDefault?: unknown; heading?: unknown; buttonLabel?: unknown }> | null
  } | null>(
    `{
      "ctas": *[_type == "callToAction" && projectSlug == $projectSlug && !(_id in path("drafts.**"))]
        | order(_createdAt asc){ _id, internalName, isDefault, heading, buttonLabel },
      "site": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales },
      "categories": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]
        .moduleInstallations[moduleId == "blog"][0].config.categories[]{ value, label },
      "customDomain": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && defined(customDomain)][0].customDomain
    }`,
    { projectSlug: grant.projectSlug }
  )
  const supported = (r?.site?.supportedLocales ?? []).filter((l): l is string => typeof l === 'string' && !!l)
  const defaultLocale = r?.site?.defaultLocale || supported[0] || params.locale
  const languages = [defaultLocale, ...supported.filter((l) => l !== defaultLocale)]
  const categories = (r?.categories ?? [])
    .filter((c): c is { value: string; label?: unknown } => typeof c?.value === 'string' && !!c.value)
    .map((c) => {
      const labels = textMap(c.label)
      const label = [params.locale, defaultLocale, 'en'].map((l) => labels[l]?.trim()).find(Boolean) ??
        Object.values(labels).find((l) => l.trim()) ??
        c.value.replace(/-/g, ' ')
      return { value: c.value, label }
    })
  const domain = typeof r?.customDomain === 'string' ? r.customDomain.trim().replace(/\/+$/, '') : ''
  return {
    projectSlug: grant.projectSlug,
    defaultLocale,
    languages,
    categories,
    origin: domain ? `https://${domain}` : null,
    ctas: (r?.ctas ?? [])
      .filter((c) => typeof c?._id === 'string' && !!c._id)
      .map((c) => {
        const heading = textMap(c.heading)[defaultLocale]?.trim() || null
        const buttonLabel = textMap(c.buttonLabel)[defaultLocale]?.trim() || null
        return {
          id: c._id as string,
          name: (typeof c.internalName === 'string' && c.internalName.trim()) || heading || (c._id as string),
          isDefault: c.isDefault === true,
          heading,
          buttonLabel,
        }
      }),
  }
}
