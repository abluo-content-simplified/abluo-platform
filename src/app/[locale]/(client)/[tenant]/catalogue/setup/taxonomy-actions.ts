'use server'

/**
 * Catalogue → Setup → Categories & Tags — server actions (C1.7, C8 §8.3, K-4).
 * Thin wrappers over `CatalogueTaxonomyService` (src/lib/modules/catalogue/taxonomy/service.ts),
 * the ONLY writer of Catalogue categories and tags. The item editor's inline "+ Add category"
 * calls `createCatalogueCategoryAction` — the same service function as Setup (D-3, P-21).
 *
 * Every action takes `{ projectSlug, … }` and returns `{ ok: true, … }` or a `Fail`:
 *   { ok: false, error: 'unauthenticated' | 'forbidden' | CatalogueTaxonomyErrorCode, capability?, detail? }
 * `capability` names the missing permission on a refusal (C8 §8.6, never role/project/ids).
 * User-intent operations need the `rev` the screen loaded (list → `rev`) and may send
 * `baseHashes` (list → `categories[].hash`, tags as `tag:<key>`); a concurrent change returns
 * `category_conflict` / `tag_conflict` with `detail: { rev, tree, tags, changedKeys }`.
 *
 * Signatures (input → success payload):
 *   listCatalogueTaxonomyAction        {}                                              → { taxonomy: CatalogueTaxonomyView }      item.read
 *   createCatalogueCategoryAction      { labels, parentKey: string|null, index?, locale? } → { category, path, created, rev }     taxonomy.write
 *   updateCatalogueCategoryAction      { key, labels, rev, baseHashes? }               → { category, rev }                        taxonomy.write
 *   reorderCatalogueCategoriesAction   { parentKey: string|null, keys, rev, baseHashes? } → { order, rev }                       taxonomy.write
 *   previewCatalogueCategoryMoveAction { key, newParentKey, index? }                   → { impact: MoveImpact }                   setup.manage
 *   moveCatalogueCategoryAction        { key, newParentKey, index?, rev, baseHashes? } → { category, impact, rev }                setup.manage
 *   archiveCatalogueCategoryAction     { key, archived: boolean }                      → { category, rev }                        setup.manage
 *   setCatalogueCategoryDefaultsAction { key, defaultOptionListIds, rev, baseHashes? } → { category, rev }                        setup.manage
 *   previewCatalogueCategoryRuleAction { key, channel, rule: {state, overrides[]}|null } → { preview: RuleChangePreview }          setup.manage
 *   setCatalogueCategoryRuleAction     { key, channel, rule|null, rev, baseHashes? }   → { preview, category, rev }               setup.manage
 *   catalogueCategoryUsageAction       { key }                                         → { usage: { blockers, route } }           item.read
 *   previewCatalogueCategoryDeletionAction { key, reassignTo?, promoteChildrenTo? }    → { preview: { blockers, route, plan } }   taxonomy.write | setup.manage
 *   deleteCatalogueCategoryAction      { key, rev?, reassignTo?, promoteChildrenTo? }  → { result: DeleteCategoryResult }         unused leaf: taxonomy.write; otherwise setup.manage
 *   reassignCatalogueCategoryAction    { from, to, promoteChildrenTo?, rev? }          → { result: DeleteCategoryResult }         setup.manage
 *   createCatalogueTagAction           { labels }                                      → { tag, created, rev }                    taxonomy.write
 *   updateCatalogueTagAction           { key, labels, rev, baseHashes? }               → { tag, rev }                             taxonomy.write
 *   reorderCatalogueTagsAction         { keys, rev, baseHashes? }                      → { order, rev }                           taxonomy.write
 *   archiveCatalogueTagAction          { key, archived: boolean }                      → { tag, rev }                             taxonomy.write
 *   deleteCatalogueTagAction           { key }                                         → { key, deleted, rev }                    taxonomy.write
 *   createCatalogueTermInlineAction    { kind: 'category'|'tag', labels, parentKey? }  → { term: { key, label, color: null } }    the TermPicker bridge (category: top level unless parentKey)
 */
import { revalidatePath } from 'next/cache'
import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { catalogueRefusal } from '@/lib/api/catalogue-capability-guard'
import type { CatalogueCapability } from '@/lib/modules/catalogue/capabilities'
import {
  CatalogueTaxonomyError,
  archiveCategory,
  archiveTag,
  categoryUsage,
  createCategory,
  createTag,
  deleteCategory,
  deleteTag,
  listTaxonomy,
  moveCategory,
  previewCategoryDeletion,
  previewCategoryMove,
  previewCategoryRule,
  reassignCategory,
  reorderChildren,
  reorderTags,
  setCategoryDefaults,
  setCategoryRule,
  unarchiveCategory,
  unarchiveTag,
  updateCategory,
  updateTag,
  type CatalogueTaxonomyErrorCode,
  type CatalogueTaxonomyErrorDetail,
  type CatalogueTaxonomyView,
  type CategoryUsage,
  type CreateCategoryResult,
  type DeleteCategoryResult,
  type DeletionOptions,
  type DeletionPreview,
  type MoveImpact,
  type RuleChangePreview,
  type TagResult,
  type UserOpBase,
} from '@/lib/modules/catalogue/taxonomy/service'
import type { CategoryNode } from '@/lib/modules/catalogue/taxonomy/types'

export type CatalogueTaxonomyActionError = 'unauthenticated' | 'forbidden' | 'failed' | CatalogueTaxonomyErrorCode
export type CatalogueTaxonomyFail = { ok: false; error: CatalogueTaxonomyActionError; capability?: CatalogueCapability; detail?: CatalogueTaxonomyErrorDetail }
type Result<T> = ({ ok: true } & T) | CatalogueTaxonomyFail
type Scoped<T = object> = { projectSlug: string } & T

async function run<T>(projectSlug: unknown, fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>, opts: { write?: boolean } = {}): Promise<Result<T>> {
  const access = await resolveProjectAction(projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  try {
    const value = await fn(access.ctx, access.grant.projectId)
    if (opts.write) refresh()
    return { ok: true, ...value }
  } catch (error) {
    if (error instanceof CatalogueTaxonomyError) return { ok: false, error: error.code, ...(error.detail && { detail: error.detail }) }
    const refusal = catalogueRefusal(error)
    if (refusal) return refusal
    return { ok: false, error: 'failed' }
  }
}

/** The Catalogue screens read categories and tags; render them fresh next time. Never fails the write. */
function refresh() {
  try {
    revalidatePath('/[locale]/[tenant]/catalogue', 'layout')
  } catch {
    /* not in a request (tests) */
  }
}

export async function listCatalogueTaxonomyAction(input: Scoped): Promise<Result<{ taxonomy: CatalogueTaxonomyView }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ taxonomy: await listTaxonomy(ctx, pid) }))
}

export async function createCatalogueCategoryAction(input: Scoped<{ labels: Record<string, string>; parentKey: string | null; index?: number; locale?: string }>): Promise<Result<CreateCategoryResult>> {
  return run(input?.projectSlug, (ctx, pid) => createCategory(ctx, pid, { labels: input.labels, parentKey: input.parentKey, index: input.index, locale: input.locale }), { write: true })
}

export async function updateCatalogueCategoryAction(input: Scoped<UserOpBase & { key: string; labels: Record<string, string | null> }>): Promise<Result<{ category: CategoryNode; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => updateCategory(ctx, pid, { key: input.key, labels: input.labels, rev: input.rev, baseHashes: input.baseHashes }), { write: true })
}

export async function reorderCatalogueCategoriesAction(input: Scoped<UserOpBase & { parentKey: string | null; keys: string[] }>): Promise<Result<{ order: { key: string; order: number }[]; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => reorderChildren(ctx, pid, { parentKey: input.parentKey, keys: input.keys, rev: input.rev, baseHashes: input.baseHashes }), { write: true })
}

export async function previewCatalogueCategoryMoveAction(input: Scoped<{ key: string; newParentKey: string | null; index?: number }>): Promise<Result<{ impact: MoveImpact }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ impact: await previewCategoryMove(ctx, pid, { key: input.key, newParentKey: input.newParentKey, index: input.index }) }))
}

export async function moveCatalogueCategoryAction(input: Scoped<UserOpBase & { key: string; newParentKey: string | null; index?: number }>): Promise<Result<{ category: CategoryNode; impact: MoveImpact; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => moveCategory(ctx, pid, { key: input.key, newParentKey: input.newParentKey, index: input.index, rev: input.rev, baseHashes: input.baseHashes }), { write: true })
}

export async function archiveCatalogueCategoryAction(input: Scoped<{ key: string; archived: boolean }>): Promise<Result<{ category: CategoryNode; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => (input.archived === false ? unarchiveCategory(ctx, pid, { key: input.key }) : archiveCategory(ctx, pid, { key: input.key })), { write: true })
}

export async function setCatalogueCategoryDefaultsAction(input: Scoped<UserOpBase & { key: string; defaultOptionListIds: string[] }>): Promise<Result<{ category: CategoryNode; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => setCategoryDefaults(ctx, pid, { key: input.key, defaultOptionListIds: input.defaultOptionListIds, rev: input.rev, baseHashes: input.baseHashes }), { write: true })
}

export async function previewCatalogueCategoryRuleAction(input: Scoped<{ key: string; channel: string; rule: unknown | null }>): Promise<Result<{ preview: RuleChangePreview }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ preview: await previewCategoryRule(ctx, pid, { key: input.key, channel: input.channel, rule: input.rule }) }))
}

export async function setCatalogueCategoryRuleAction(input: Scoped<UserOpBase & { key: string; channel: string; rule: unknown | null }>): Promise<Result<{ preview: RuleChangePreview; category: CategoryNode; rev: string }>> {
  return run(
    input?.projectSlug,
    async (ctx, pid) => {
      const r = await setCategoryRule(ctx, pid, { key: input.key, channel: input.channel, rule: input.rule, rev: input.rev, baseHashes: input.baseHashes })
      return { preview: { before: r.before, after: r.after, impact: r.impact }, category: r.category, rev: r.rev }
    },
    { write: true },
  )
}

export async function catalogueCategoryUsageAction(input: Scoped<{ key: string }>): Promise<Result<{ usage: CategoryUsage }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ usage: await categoryUsage(ctx, pid, { key: input.key }) }))
}

export async function previewCatalogueCategoryDeletionAction(input: Scoped<{ key: string } & DeletionOptions>): Promise<Result<{ preview: DeletionPreview }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ preview: await previewCategoryDeletion(ctx, pid, { key: input.key, reassignTo: input.reassignTo, promoteChildrenTo: input.promoteChildrenTo }) }))
}

export async function deleteCatalogueCategoryAction(input: Scoped<{ key: string; rev?: string } & DeletionOptions>): Promise<Result<{ result: DeleteCategoryResult }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ result: await deleteCategory(ctx, pid, { key: input.key, rev: input.rev, reassignTo: input.reassignTo, promoteChildrenTo: input.promoteChildrenTo }) }), { write: true })
}

export async function reassignCatalogueCategoryAction(input: Scoped<{ from: string; to: string; promoteChildrenTo?: string | null | 'parent'; rev?: string }>): Promise<Result<{ result: DeleteCategoryResult }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ result: await reassignCategory(ctx, pid, { from: input.from, to: input.to, promoteChildrenTo: input.promoteChildrenTo, rev: input.rev }) }), { write: true })
}

export async function createCatalogueTagAction(input: Scoped<{ labels: Record<string, string> }>): Promise<Result<TagResult & { created: boolean }>> {
  return run(input?.projectSlug, (ctx, pid) => createTag(ctx, pid, { labels: input.labels }), { write: true })
}

export async function updateCatalogueTagAction(input: Scoped<UserOpBase & { key: string; labels: Record<string, string | null> }>): Promise<Result<TagResult>> {
  return run(input?.projectSlug, (ctx, pid) => updateTag(ctx, pid, { key: input.key, labels: input.labels, rev: input.rev, baseHashes: input.baseHashes }), { write: true })
}

export async function reorderCatalogueTagsAction(input: Scoped<UserOpBase & { keys: string[] }>): Promise<Result<{ order: { key: string; order: number }[]; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => reorderTags(ctx, pid, { keys: input.keys, rev: input.rev, baseHashes: input.baseHashes }), { write: true })
}

export async function archiveCatalogueTagAction(input: Scoped<{ key: string; archived: boolean }>): Promise<Result<TagResult>> {
  return run(input?.projectSlug, (ctx, pid) => (input.archived === false ? unarchiveTag(ctx, pid, { key: input.key }) : archiveTag(ctx, pid, { key: input.key })), { write: true })
}

export async function deleteCatalogueTagAction(input: Scoped<{ key: string }>): Promise<Result<{ key: string; deleted: boolean; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => deleteTag(ctx, pid, { key: input.key }), { write: true })
}

/**
 * The TermPicker bridge (src/components/client/taxonomy/TermPicker.tsx, module "catalogue"):
 * the flat picker's "+ Add" creates through the SAME service functions as Setup. A category
 * created here goes to the top level unless `parentKey` is given (the parent-choosing tree
 * picker of the item editor replaces this path; until then "top level" is the explicit choice).
 * Returns the TermPicker's term shape.
 */
export async function createCatalogueTermInlineAction(
  input: Scoped<{ kind: 'category' | 'tag'; labels: Record<string, string>; parentKey?: string | null }>,
): Promise<Result<{ term: { key: string; label: Record<string, string>; color: null } }>> {
  return run(
    input?.projectSlug,
    async (ctx, pid) => {
      if (input.kind === 'tag') {
        const r = await createTag(ctx, pid, { labels: input.labels })
        return { term: { key: r.tag.key, label: r.tag.label, color: null } }
      }
      const r = await createCategory(ctx, pid, { labels: input.labels, parentKey: input.parentKey ?? null })
      return { term: { key: r.category.key, label: r.category.label, color: null } }
    },
    { write: true },
  )
}
