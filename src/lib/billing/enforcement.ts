// Server-only. Billing enforcement switch + context step (ADR-041 D8).
import { applyBillingLocksToContext } from './locks'
import { isBillingLocked, type ProjectBillingStatus } from './lifecycle'

export type BillingEnforcementMode = 'off' | 'observe' | 'on'

/** BILLING_ENFORCEMENT=off|observe|on. Default, and any unknown value: off. */
export function billingEnforcementMode(): BillingEnforcementMode {
  const v = (process.env.BILLING_ENFORCEMENT ?? '').trim().toLowerCase()
  return v === 'observe' || v === 'on' ? v : 'off'
}

type Loader = (projectIds: readonly string[], now?: Date) => Promise<Map<string, ProjectBillingStatus>>

/**
 * The LAST step of context assembly. off → returned as-is, no read.
 * observe → `billing` attached to grants, permissions untouched, would-be locks logged.
 * on → locked projects stripped to reads + the allowlist (support visits excepted, see locks.ts).
 * Any load error → fail OPEN: context unchanged.
 */
export async function applyBillingEnforcement<C extends { projects: ReadonlyArray<{ projectId: string; permissions: string[] }>; support?: unknown }>(
  ctx: C,
  load: Loader,
  mode: BillingEnforcementMode = billingEnforcementMode()
): Promise<C> {
  if (mode === 'off' || ctx.projects.length === 0) return ctx
  let statuses: Map<string, ProjectBillingStatus>
  try {
    statuses = await load(ctx.projects.map((p) => p.projectId))
  } catch (error) {
    console.error(`billing enforcement: could not load statuses — failing open. ${error instanceof Error ? error.message : String(error)}`)
    return ctx
  }
  if (mode === 'observe') {
    const would = ctx.projects.filter((p) => !ctx.support && statuses.get(p.projectId) && isBillingLocked(statuses.get(p.projectId)!.state)).map((p) => p.projectId)
    if (would.length) console.info(`billing enforcement (observe): would lock project(s) ${would.join(', ')}`)
    return { ...ctx, projects: ctx.projects.map((p) => (statuses.has(p.projectId) ? { ...p, billing: statuses.get(p.projectId) } : p)) }
  }
  return applyBillingLocksToContext(ctx, statuses) as unknown as C
}
