// ── Catalogue readiness — the engine (C6 §6.3; pure, browser-safe) ───────────
//
// Normative semantics (C6 §6.3): rules whose level is null in the context are
// skipped; overrides silence RECOMMENDED findings only; state = blocked when a
// required finding exists, readyWithWarnings when only recommended ones do;
// findings are in registry order, then format, then locale order; total, never
// throws; no clock, no randomness, no I/O.

import { DEFAULT_RULES, DEFAULT_STANDARD, activeRules, offeringContextFor } from './rules'
import { filterKeys } from '../taxonomy/tree'
import type { OfferingContext } from '../commerce/commerce-types'
import type {
  ContextKey,
  Finding,
  ItemReadinessInput,
  OverriddenFinding,
  PublicationContext,
  ReadinessCode,
  ReadinessOverride,
  ReadinessResult,
  ReadinessRule,
  RuleFailure,
  RuleFamily,
  RuleLevel,
  RuleScope,
} from './types'

export { DEFAULT_STANDARD } from './rules'

export const WEBSITE: PublicationContext = Object.freeze({ kind: 'website' })

export function contextKey(ctx: PublicationContext): ContextKey {
  switch (ctx.kind) {
    case 'website':
      return 'website'
    case 'channel':
      return `channel:${ctx.channel}`
    case 'export':
      return `export:${ctx.profile}`
    case 'print':
      return ['print', ctx.template, ctx.channel, ctx.locale].filter(Boolean).join(':')
    case 'marketplace':
      return `marketplace:${ctx.connection}@${ctx.policyVersion}`
  }
}

/** C6 §6.4a — the one mapping from a publication context to the C4/C5 offering context. */
export function offeringContextOf(ctx: PublicationContext): OfferingContext {
  return offeringContextFor(ctx)
}

export type EvaluateOptions = {
  /** Default ['standard']; the server gate and Studio validation pass ['standard', 'integrity']. */
  families?: ReadonlyArray<RuleFamily>
  /** Release flag of the allergen slice (C13 writers). Off in R1. */
  allergenSlice?: boolean
  /** Test seam (R-31): the rule registry to run. Defaults to the built-in standard. */
  rules?: readonly ReadinessRule[]
}

const stricter = (a: RuleLevel | null, b: RuleLevel | null | undefined): RuleLevel | null => (a === 'required' || b === 'required' ? 'required' : a ?? b ?? null)

function scopeMatches(scope: RuleScope | undefined, input: ItemReadinessInput, ctx: PublicationContext): boolean {
  if (!scope) return true
  if (scope.contexts && !scope.contexts.includes(ctx.kind)) return false
  if (scope.channels) {
    const ch = 'channel' in ctx ? ctx.channel : undefined
    if (!ch || !scope.channels.includes(ch)) return false
  }
  if (scope.profiles && (!input.profile || !scope.profiles.includes(input.profile))) return false
  if (scope.primaryCategorySubtree) {
    // C1 `filterKeys(tree, subtree).includes(primary)`.
    const primary = input.categories.primary
    if (!primary || !input.categoryTree) return false
    if (!filterKeys(input.categoryTree, scope.primaryCategorySubtree).includes(primary)) return false
  }
  if (scope.collection) return false // placement-by-collection facts land with the Catalogue UI slice
  return true
}

/**
 * The effective level of a built-in rule for this item in this context, after
 * tenant standards (§6.8): stricter wins — a tenant standard may raise a
 * recommended rule to required, never lower a required one.
 */
function levelFor(rule: ReadinessRule, input: ItemReadinessInput, ctx: PublicationContext): RuleLevel | null {
  let level = rule.levelIn(ctx, input)
  for (const std of input.standards?.extra ?? []) {
    if (!scopeMatches(std.scope, input, ctx)) continue
    for (const ref of std.rules) {
      if (ref.code !== rule.code || !ref.level || !scopeMatches(ref.scope, input, ctx)) continue
      level = stricter(level, ref.level)
    }
  }
  return level
}

/** Rules of the default standard + resolved extras whose scope matches, active for the item's project, in registry order. */
export function applicableRules(input: ItemReadinessInput, ctx: PublicationContext, opts: EvaluateOptions = {}): ReadinessRule[] {
  const families = opts.families ?? ['standard']
  const active = activeRules(input.migrations, { allergenSlice: opts.allergenSlice })
  return (opts.rules ?? DEFAULT_RULES).filter((r) => families.includes(r.family) && active.has(r.code) && scopeMatches(r.scope, input, ctx) && levelFor(r, input, ctx) !== null)
}

/** Pure: the stable id of "this finding as it stands" — the override fingerprint (§6.9). */
export function findingFingerprint(f: Pick<Finding, 'code' | 'target' | 'values'> & { rule: Finding['rule'] }): string {
  const t = f.target
  const values = f.values ? Object.keys(f.values).sort().map((k) => [k, f.values![k]]) : []
  return JSON.stringify([f.code, f.rule.standard, t.kind, t.id, t.formatKey ?? null, t.locale ?? null, values])
}

/** Registry index for deterministic ordering, whatever order a caller passed the rules in (R-31). */
const REGISTRY_INDEX = new Map<ReadinessCode, number>(DEFAULT_RULES.map((r, i) => [r.code, i]))

/** Judge one item in one context. Total: a rule that throws on malformed facts yields no finding instead of breaking the caller. */
export function evaluateItem(input: ItemReadinessInput, ctx: PublicationContext, opts: EvaluateOptions = {}): ReadinessResult {
  const ctxKey = contextKey(ctx)
  const rules = applicableRules(input, ctx, opts).sort((a, b) => (REGISTRY_INDEX.get(a.code) ?? 1e6) - (REGISTRY_INDEX.get(b.code) ?? 1e6))
  const required: Finding[] = []
  const recommended: Finding[] = []
  const overridden: OverriddenFinding[] = []
  const usedOverrides = new Set<ReadinessOverride>()
  const overrides = input.overrides.filter((o) => o.context === ctxKey)
  for (const rule of rules) {
    const level = levelFor(rule, input, ctx)!
    let failures: RuleFailure[]
    try {
      failures = rule.check(input, ctx)
    } catch {
      failures = []
    }
    for (const f of failures) {
      const finding: Finding = {
        ...f,
        code: rule.code,
        level,
        rule: { code: rule.code, standard: DEFAULT_STANDARD.key, standardVersion: DEFAULT_STANDARD.version },
        ...(level === 'required' && rule.gate && { gate: rule.gate }),
        ...(level === 'recommended' && { overridable: rule.overridable ?? true }),
      }
      if (level === 'required') {
        required.push(finding)
        continue
      }
      const fp = findingFingerprint(finding)
      const match = finding.overridable
        ? overrides.find((o) => o.ruleCode === rule.code && o.standard === finding.rule.standard && o.standardVersion === finding.rule.standardVersion && o.fingerprint === fp)
        : undefined
      if (match) {
        usedOverrides.add(match)
        overridden.push({ finding, override: match })
      } else recommended.push(finding)
    }
  }
  // An override of THIS context that silenced nothing is stale (resolved, changed, standard bumped, or never overridable).
  const staleOverrides = overrides.filter((o) => !usedOverrides.has(o))
  return {
    context: ctxKey,
    subject: { kind: 'item', id: input.id },
    state: required.length ? 'blocked' : recommended.length ? 'readyWithWarnings' : 'ready',
    required,
    recommended,
    overridden,
    staleOverrides,
  }
}
