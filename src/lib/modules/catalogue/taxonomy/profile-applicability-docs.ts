// ── Profile applicability over STORED documents (C1.12.4; pure) ──────────────
//
// Adapters from stored Sanity shapes to the one rule in profile-applicability.ts:
// the Studio critical validation of `catalogueItem`, and the read-only report
// script (`scripts/catalogue/report-profile-applicability.mjs`). No rule lives
// here — only reading.

import { isItemProfile, type ItemProfile } from '../profiles'
import { itemCategoryAssignment, readCategoryNodes, readTagNodes } from './read'
import { buildTree, pathOf } from './tree'
import {
  describeProfileFinding,
  incompatibleAssignments,
  optionListIdsOf,
  optionListUseForOf,
  tagKeysOf,
  type ApplicabilityItem,
  type ApplicabilityTaxonomy,
  type ProfileFinding,
} from './profile-applicability'

export type RawTaxonomyDoc = { categories?: unknown; tags?: unknown } | null | undefined
export type RawOptionListRow = { _id?: unknown; useFor?: unknown; name?: unknown }

/** A stored taxonomy document → what the rule needs. */
export function taxonomyOfDoc(doc: RawTaxonomyDoc): ApplicabilityTaxonomy {
  return { tree: buildTree(readCategoryNodes(doc?.categories)), tags: readTagNodes(doc?.tags) }
}

/** A stored item (draft or published) → the rule's item. Category assignment through the R1 dual-read. */
export function applicabilityItemOfDoc(doc: Record<string, unknown>, taxonomy: ApplicabilityTaxonomy): ApplicabilityItem {
  return {
    profile: isItemProfile(doc.itemProfile) ? doc.itemProfile : null,
    assignment: itemCategoryAssignment(doc, taxonomy.tree),
    tags: tagKeysOf(doc),
    optionListIds: optionListIdsOf(doc),
  }
}

/** GROQ for the Studio rule: the project's taxonomy document and the attached option lists (drafts included). */
export const STUDIO_PROFILE_APPLICABILITY_QUERY = /* groq */ `{
  "taxonomy": *[_type == "catalogueTaxonomy" && _id == $taxonomyId && projectSlug == $projectSlug][0]{ categories, tags },
  "lists": *[_type == "catalogueOptionList" && projectSlug == $projectSlug && (_id in $ids || _id in $draftIds)]{ _id, useFor }
}`

/**
 * Studio critical validation of `catalogueItem` (C1.12.4): true, or the first finding as an English
 * sentence naming the term (Studio is admin-only, English).
 */
export function studioProfileProblem(doc: Record<string, unknown>, data: { taxonomy?: RawTaxonomyDoc; lists?: readonly RawOptionListRow[] | null } | null | undefined): true | string {
  const taxonomy = taxonomyOfDoc(data?.taxonomy)
  const item = applicabilityItemOfDoc(doc, taxonomy)
  const findings = incompatibleAssignments(item, taxonomy, optionListUseForOf(data?.lists ?? []))
  if (!findings.length || !item.profile) return true
  const label = (f: ProfileFinding) =>
    f.kind === 'primary' || f.kind === 'additional' ? pathOf(taxonomy.tree, f.key, { locale: 'en', defaultLocale: 'en', locales: ['en'] }).text || f.key : f.key
  return describeProfileFinding(findings[0], item.profile, label) + (findings.length > 1 ? ` (${findings.length - 1} more.)` : '')
}

// ── read-only report (scripts/catalogue/report-profile-applicability.mjs) ────

export type ProfileReportRow = { id: string; draft: boolean; profile: ItemProfile | null; findings: ProfileFinding[] }
export type ProfileReport = { project: string; items: number; withoutProfile: number; profiles: Record<string, number>; rows: ProfileReportRow[] }

/**
 * Every catalogueItem copy (published and drafts.*; versions.* skipped) of each project with its
 * incompatible assignments — the same pure rule the gate runs. Read-only by construction.
 */
export function profileApplicabilityReport(docs: readonly Record<string, unknown>[], opts: { project?: string } = {}): ProfileReport[] {
  const projects = new Set<string>()
  for (const d of docs) if (d._type === 'catalogueItem' && typeof d.projectSlug === 'string') projects.add(d.projectSlug)
  const out: ProfileReport[] = []
  for (const project of [...projects].sort()) {
    if (opts.project && project !== opts.project) continue
    const taxonomy = taxonomyOfDoc(docs.find((d) => d._type === 'catalogueTaxonomy' && d.projectSlug === project) as RawTaxonomyDoc)
    const lists = optionListUseForOf(docs.filter((d) => d._type === 'catalogueOptionList' && d.projectSlug === project) as RawOptionListRow[])
    const items = docs.filter((d) => d._type === 'catalogueItem' && d.projectSlug === project && typeof d._id === 'string' && !String(d._id).startsWith('versions.'))
    const report: ProfileReport = { project, items: items.length, withoutProfile: 0, profiles: {}, rows: [] }
    for (const d of items) {
      const item = applicabilityItemOfDoc(d, taxonomy)
      if (!item.profile) report.withoutProfile++
      else report.profiles[item.profile] = (report.profiles[item.profile] ?? 0) + 1
      const findings = incompatibleAssignments(item, taxonomy, lists)
      if (findings.length) report.rows.push({ id: String(d._id), draft: String(d._id).startsWith('drafts.'), profile: item.profile, findings })
    }
    out.push(report)
  }
  return out
}
