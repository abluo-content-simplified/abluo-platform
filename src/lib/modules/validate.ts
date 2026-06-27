// ── Build-time manifest validation ───────────────────────────────────────────
// ADR-011 Phase A3 — initial nine rules.
// ADR-011 Phase D3 — extended to validate the `collections` structure.
// ADR-011 Phase D4 — extended to validate permission IDs.
//
// Validates every entry in MODULE_REGISTRY against all structural rules.
// Called at module load time from registry.ts — a failure throws immediately,
// which propagates as a build error in Next.js and Sanity Studio.
//
// Design: collect-all errors before throwing. A single build run reveals every
// violation, not just the first one. Each diagnostic names the module, the
// rule, the actual invalid value, and a concrete Fix instruction.

import type { ModuleManifest } from './types'

// ── Internal error record ─────────────────────────────────────────────────────

type ManifestError = {
  /** Module id — null for registry-level (cross-module) rules 6, 7, 8. */
  moduleId: string | null
  rule: number
  message: string
  fix: string
}

// ── Validation constants ──────────────────────────────────────────────────────

/**
 * Lowercase kebab-case: starts with a letter, followed by letters, digits,
 * or hyphens. Rejects uppercase, spaces, underscores, and leading hyphens.
 */
const KEBAB_ID_RE = /^[a-z][a-z0-9-]*$/

/**
 * Semver: MAJOR.MINOR.PATCH with optional pre-release (-alpha.1) and build
 * metadata (+build.1). Rejects "v" prefix, two-part versions, and "latest".
 */
const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/

const VALID_STATUSES = new Set<string>(['released', 'deprecated', 'archived'])
const VALID_DATA_STORES = new Set<string>(['content', 'operational', 'hybrid'])

// ── Compiler-style formatter ──────────────────────────────────────────────────

function formatErrors(errors: ManifestError[]): string {
  const count = errors.length
  const lines: string[] = [
    `MODULE_REGISTRY validation failed (${count} ${count === 1 ? 'error' : 'errors'}):`,
    '',
  ]

  for (const err of errors) {
    // Registry-level rules have no module prefix; module-scoped rules include [id].
    const tag =
      err.moduleId !== null
        ? `[${err.moduleId}] Rule ${err.rule}`
        : `Rule ${err.rule}`

    // Fix line indented to align with the start of the message text.
    const prefix = `  ${tag} — `
    const fixIndent = ' '.repeat(prefix.length)

    lines.push(`${prefix}${err.message}`)
    lines.push(`${fixIndent}Fix: ${err.fix}`)
    lines.push('')
  }

  return lines.join('\n')
}

// ── validateRegistry ──────────────────────────────────────────────────────────

/**
 * Validates all entries in MODULE_REGISTRY against all structural rules.
 *
 * Rules:
 *   1.  All id values are unique.
 *   2.  All id values are lowercase kebab-case.
 *   3.  version is a valid semver string.
 *   4.  status is one of: released, deprecated, archived.
 *   5.  platformContract.pageType, if set, is a non-empty string.
 *   6.  platformContract.sectionTypes contains no duplicates across the registry.
 *   7.  platformContract.schemaTypes contains no duplicates across the registry.
 *   8.  dependencies.requires references IDs present in the registry.
 *   9.  dataStore.primary is one of: content, operational, hybrid.
 *   10. platformContract.collections structure is valid (Phase D3).
 *   11. platformContract.permissions IDs are non-empty, unique across the
 *       registry, and start with the declaring module's id (Phase D4).
 *
 * @throws {Error} If any rule is violated. The message lists all violations.
 */
export function validateRegistry(manifests: ModuleManifest[]): void {
  const errors: ManifestError[] = []

  // Pre-build the full ID set once — Rule 8 checks against this.
  const registryIds = new Set(manifests.map((m) => m.id))

  // Track first-seen positions for Rule 1.
  const seenIds = new Map<string, number>()

  // Track type owners for Rules 6 and 7.
  const sectionTypeOwners = new Map<string, string>()
  const schemaTypeOwners = new Map<string, string>()

  // Track permission ID owners for cross-registry uniqueness (Phase D4).
  const permissionIdOwners = new Map<string, string>()

  for (let i = 0; i < manifests.length; i++) {
    const m = manifests[i]
    // Use the manifest's id as the diagnostic label. Fall back to positional
    // index for manifests with a missing or empty id (also caught by Rules 1–2).
    const mid: string = m.id || `[index ${i}]`

    // ── Rule 1: unique IDs ───────────────────────────────────────────────────
    if (seenIds.has(m.id)) {
      errors.push({
        moduleId: null,
        rule: 1,
        message: `id "${m.id}" is declared at positions ${seenIds.get(m.id)} and ${i}.`,
        fix: `Each module must have a unique id.`,
      })
    } else {
      seenIds.set(m.id, i)
    }

    // ── Rule 2: lowercase kebab-case ─────────────────────────────────────────
    if (!KEBAB_ID_RE.test(m.id)) {
      errors.push({
        moduleId: mid,
        rule: 2,
        message: `id "${m.id}" is not lowercase kebab-case.`,
        fix: `Use only lowercase letters (a–z), digits (0–9), and hyphens. Must start with a letter (e.g. "my-module").`,
      })
    }

    // ── Rule 3: valid semver ─────────────────────────────────────────────────
    if (!SEMVER_RE.test(m.version)) {
      errors.push({
        moduleId: mid,
        rule: 3,
        message: `version "${m.version}" is not a valid semver string.`,
        fix: `Use semver format, e.g. "1.0.0" or "1.0.0-alpha.1".`,
      })
    }

    // ── Rule 4: valid status ─────────────────────────────────────────────────
    if (!VALID_STATUSES.has(m.status)) {
      errors.push({
        moduleId: mid,
        rule: 4,
        message: `status "${m.status}" is not a valid value.`,
        fix: `Set status to one of: "released", "deprecated", "archived".`,
      })
    }

    // ── Rule 5: pageType, if set, must be non-empty ──────────────────────────
    const pageType = m.platformContract.pageType
    if (pageType !== undefined && pageType.trim().length === 0) {
      errors.push({
        moduleId: mid,
        rule: 5,
        message: `platformContract.pageType is set but is an empty string.`,
        fix: `Provide a non-empty Sanity document type name, or remove the pageType field entirely.`,
      })
    }

    // ── Rule 6: sectionTypes — no cross-registry duplicates ──────────────────
    for (const st of m.platformContract.sectionTypes) {
      if (sectionTypeOwners.has(st)) {
        errors.push({
          moduleId: null,
          rule: 6,
          message: `sectionType "${st}" is declared by both "${sectionTypeOwners.get(st)}" and "${mid}".`,
          fix: `Each sectionType must be owned by exactly one module.`,
        })
      } else {
        sectionTypeOwners.set(st, mid)
      }
    }

    // ── Rule 7: schemaTypes — no cross-registry duplicates ───────────────────
    for (const st of m.platformContract.schemaTypes) {
      if (schemaTypeOwners.has(st)) {
        errors.push({
          moduleId: null,
          rule: 7,
          message: `schemaType "${st}" is declared by both "${schemaTypeOwners.get(st)}" and "${mid}".`,
          fix: `Each schemaType must be owned by exactly one module.`,
        })
      } else {
        schemaTypeOwners.set(st, mid)
      }
    }

    // ── Rule 8: requires references valid registry IDs ────────────────────────
    for (const dep of m.dependencies.requires) {
      if (!registryIds.has(dep.moduleId)) {
        errors.push({
          moduleId: mid,
          rule: 8,
          message: `dependencies.requires references unknown module id "${dep.moduleId}".`,
          fix: `Ensure "${dep.moduleId}" is registered in MODULE_REGISTRY, or remove this dependency.`,
        })
      }
    }

    // ── Rule 9: valid dataStore.primary ──────────────────────────────────────
    if (!VALID_DATA_STORES.has(m.dataStore.primary)) {
      errors.push({
        moduleId: mid,
        rule: 9,
        message: `dataStore.primary "${m.dataStore.primary}" is not a valid value.`,
        fix: `Set dataStore.primary to one of: "content", "operational", "hybrid".`,
      })
    }

    // ── Rule 10: collections structure validity ───────────────────────────────
    // Added in Phase D3 (Navigation Derivation). Validates the declarative
    // collections array that replaced the imperative collectionItems() lambda.
    const seenGroupIds = new Set<string>()
    for (const group of m.platformContract.collections) {
      if (!group.id || group.id.trim().length === 0) {
        errors.push({
          moduleId: mid,
          rule: 10,
          message: `platformContract.collections contains a group with an empty id.`,
          fix: `Each collection group must have a non-empty id string.`,
        })
        continue
      }
      if (!group.label || group.label.trim().length === 0) {
        errors.push({
          moduleId: mid,
          rule: 10,
          message: `platformContract.collections group "${group.id}" has an empty label.`,
          fix: `Set a non-empty label on group "${group.id}".`,
        })
      }
      if (seenGroupIds.has(group.id)) {
        errors.push({
          moduleId: mid,
          rule: 10,
          message: `platformContract.collections group id "${group.id}" is declared more than once.`,
          fix: `Each group id must be unique within a module's collections.`,
        })
      } else {
        seenGroupIds.add(group.id)
      }
      for (const item of group.items) {
        if (!item.id || item.id.trim().length === 0) {
          errors.push({
            moduleId: mid,
            rule: 10,
            message: `platformContract.collections group "${group.id}" contains an item with an empty id.`,
            fix: `Each collection item must have a non-empty id string.`,
          })
          continue
        }
        if (!item.label || item.label.trim().length === 0) {
          errors.push({
            moduleId: mid,
            rule: 10,
            message: `platformContract.collections group "${group.id}" item "${item.id}" has an empty label.`,
            fix: `Set a non-empty label on item "${item.id}".`,
          })
        }
        if (!item.schemaType || item.schemaType.trim().length === 0) {
          errors.push({
            moduleId: mid,
            rule: 10,
            message: `platformContract.collections group "${group.id}" item "${item.id}" has an empty schemaType.`,
            fix: `Set a non-empty Sanity document type name on item "${item.id}".`,
          })
        }
        if (!item.filter || item.filter.trim().length === 0) {
          errors.push({
            moduleId: mid,
            rule: 10,
            message: `platformContract.collections group "${group.id}" item "${item.id}" has an empty filter.`,
            fix: `Set a non-empty GROQ filter string on item "${item.id}".`,
          })
        }
      }
    }

    // ── Permission ID validation ────────────────────────────────────────────
    // Extended in Phase D4 (Permission Derivation).
    //
    // Three checks per permission:
    //   1. ID is non-empty.
    //   2. ID starts with the declaring module's id — enforces the ownership
    //      convention "{moduleId}.{noun}.{verb}" and prevents cross-module
    //      permission collisions at declaration time.
    //   3. ID is unique across the entire registry.
    //
    // Naming semantics beyond ownership are not validated — both
    // "blog.post.write" and "blog.posts.write" are accepted.
    for (const perm of m.platformContract.permissions) {
      if (!perm.id || perm.id.trim().length === 0) {
        errors.push({
          moduleId: mid,
          rule: 11,
          message: `platformContract.permissions contains an entry with an empty id.`,
          fix: `Every permission must have a non-empty id string.`,
        })
        continue
      }

      // Ownership: permission id must begin with "{moduleId}."
      const expectedPrefix = `${m.id}.`
      if (!perm.id.startsWith(expectedPrefix)) {
        errors.push({
          moduleId: mid,
          rule: 11,
          message: `permission id "${perm.id}" does not start with the module id "${m.id}".`,
          fix: `Permission IDs must begin with the owning module's id followed by a dot. ` +
               `Rename this permission to start with "${expectedPrefix}" (e.g. "${expectedPrefix}noun.verb").`,
        })
      }

      // Cross-registry uniqueness.
      if (permissionIdOwners.has(perm.id)) {
        errors.push({
          moduleId: null,
          rule: 11,
          message: `permission id "${perm.id}" is declared by both "${permissionIdOwners.get(perm.id)}" and "${mid}".`,
          fix: `Each permission id must be unique across the entire registry.`,
        })
      } else {
        permissionIdOwners.set(perm.id, mid)
      }
    }
  }

  if (errors.length === 0) return

  throw new Error(formatErrors(errors))
}
