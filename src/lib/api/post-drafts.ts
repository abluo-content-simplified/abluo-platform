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
 *      categories configured for this site, and the hidden wizard step
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

export const BLOG_POST_WRITE_PERMISSION = 'blog.post.write'

export const WIZARD_STEPS = [
  'type',
  'category',
  'title',
  'story',
  'cover',
  'languages',
  'preview',
  'publish',
  'promote',
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
  patchBytes: 1_000_000,
} as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
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

  if (typeof input.id !== 'string' || !UUID.test(input.id)) {
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

  const site = await client.fetch<{ locales?: string[] | null; categories?: string[] | null } | null>(
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

    if (path === 'wizard.step') {
      if (!WIZARD_STEPS.includes(value as WizardStep)) {
        throw new PostDraftError('invalid_value', 'Unknown wizard step.')
      }
      set['wizard.step'] = value
      continue
    }

    const spec = LOCALIZED[field]
    if (!spec || !locale || rest.length || !locales.includes(locale)) {
      throw new PostDraftError('invalid_field', `Field "${path}" cannot be changed here.`)
    }
    ensure[field] = { _type: spec.type }

    if (spec.blocks) {
      const blocks = sanitizeBlocks(value)
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

  set['wizard.updatedAt'] = (deps.now ?? (() => new Date()))().toISOString()

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
 * quotes, bullet/number lists, bold/italic. Unknown keys are dropped; anything
 * that isn't a text block (images, embeds, links) is refused for now.
 */
export function sanitizeBlocks(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > LIMITS.blocks) {
    throw new PostDraftError('invalid_value', 'Body must be a list of blocks.')
  }
  return value.map((raw) => {
    const b = raw as Record<string, unknown>
    if (!b || b._type !== 'block' || typeof b._key !== 'string' || !KEY.test(b._key)) {
      throw new PostDraftError('invalid_value', 'Unsupported body block.')
    }
    const style = b.style ?? 'normal'
    if (!BLOCK_STYLES.includes(style as string)) throw new PostDraftError('invalid_value', 'Unsupported style.')
    const block: Record<string, unknown> = { _type: 'block', _key: b._key, style, markDefs: [] }
    if (b.listItem !== undefined) {
      if (!LIST_ITEMS.includes(b.listItem as string)) throw new PostDraftError('invalid_value', 'Unsupported list.')
      const level = b.level ?? 1
      if (!Number.isInteger(level) || (level as number) < 1 || (level as number) > 4) {
        throw new PostDraftError('invalid_value', 'Unsupported list level.')
      }
      block.listItem = b.listItem
      block.level = level
    }
    if (Array.isArray(b.markDefs) && b.markDefs.length) {
      throw new PostDraftError('invalid_value', 'Links are not supported yet.')
    }
    if (!Array.isArray(b.children) || b.children.length === 0 || b.children.length > LIMITS.spansPerBlock) {
      throw new PostDraftError('invalid_value', 'Unsupported block content.')
    }
    block.children = b.children.map((rawSpan) => {
      const s = rawSpan as Record<string, unknown>
      if (!s || s._type !== 'span' || typeof s._key !== 'string' || !KEY.test(s._key)) {
        throw new PostDraftError('invalid_value', 'Unsupported text.')
      }
      if (typeof s.text !== 'string' || s.text.length > LIMITS.spanText) {
        throw new PostDraftError('invalid_value', 'Text too long.')
      }
      const marks = s.marks ?? []
      if (!Array.isArray(marks) || !marks.every((m) => DECORATORS.includes(m as string))) {
        throw new PostDraftError('invalid_value', 'Unsupported formatting.')
      }
      return { _type: 'span', _key: s._key, text: s.text, marks: [...new Set(marks)] }
    })
    return block
  })
}
