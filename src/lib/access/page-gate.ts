/**
 * Site Access — the page gate (ADR-040 §9, B2.2). Decides, BEFORE any page
 * content is loaded, whether this request may see a page.
 *
 *   open     — the page and every page above its path are public. No session
 *              lookup, no database call: public pages behave exactly as before.
 *   granted  — restricted, and the visitor holds a matching live group.
 *   denied   — restricted and not granted, for any reason. Deny by default:
 *              module off or not resolvable, unknown project, undeterminable
 *              environment, no or foreign cookie, store unreachable, a group
 *              list that names nobody, a malformed policy.
 *
 * The decision core (`decidePageGate`) is pure apart from its injected deps,
 * so every branch is unit-tested; `src/app/.../[...slug]/page.tsx` wires the
 * real deps through `loadGatedPage()` in ./page-gate.server.ts.
 */
import type { AccessEnvironment } from './environment'
import { ACCESS_MODULE_ID } from './model'
import {
  evaluateAccess,
  isRestricted,
  parseAccessPolicy,
  parseNavigationMode,
  type AccessDecision,
  type AccessPolicy,
  type NavigationMode,
  type VisitorGrants,
} from './policy'

/** The access part of a pageBySlugQuery result (PAGE_ACCESS_PROJECTION). */
export type PageAccessFields = {
  access?: unknown
  ancestorAccess?: Array<{ access?: unknown }> | null
  contentWithheld?: boolean | null
}

export type PageGate =
  | { kind: 'open' }
  | { kind: 'granted'; chain: AccessPolicy[] }
  | {
      kind: 'denied'
      reason: Extract<AccessDecision, { allowed: false }>['reason'] | 'unknown_project' | 'inconsistent'
      navigation: NavigationMode
      /**
       * What the prompt may say about the visitor (never about the page):
       * none — no access cookie; ended — a cookie whose session no longer
       * opens anything here (expired, signed out everywhere, rotated, another
       * environment, or the service is unreachable); other_groups — a live
       * session whose groups do not include this page.
       */
      visitor: 'none' | 'ended' | 'other_groups'
    }

/** Own policy first, then every closed path ancestor. */
export function pagePolicyChain(page: PageAccessFields): AccessPolicy[] {
  return [parseAccessPolicy(page.access), ...(page.ancestorAccess ?? []).map((a) => parseAccessPolicy(a?.access))]
}

export type PageGateDeps = {
  /** The request's project UUID (generated route table), or null. */
  projectIdFor: (projectSegment: string) => string | null
  environment: () => AccessEnvironment | null
  /** The access cookie for this project on this request, if any. Only called for a restricted page. */
  readToken: (projectId: string) => Promise<string | null | undefined> | string | null | undefined
  /** Live grants for the token; MUST return null on any failure (never throw). */
  resolveVisitor: (projectId: string, environment: AccessEnvironment | null, token: string | null | undefined) => Promise<VisitorGrants | null>
}

export async function decidePageGate(
  page: PageAccessFields,
  ctx: { projectSegment: string; enabledModuleIds: readonly string[] | null },
  deps: PageGateDeps
): Promise<PageGate> {
  const chain = pagePolicyChain(page)
  const navigation = parseNavigationMode(page.access)
  const restricted = isRestricted(chain)

  if (!restricted) {
    // GROQ says withheld but TypeScript sees nothing restricted → the two rules
    // disagree. Never serve content on a disagreement.
    if (page.contentWithheld) return { kind: 'denied', reason: 'inconsistent', navigation, visitor: 'none' }
    return { kind: 'open' }
  }

  // Module off, or the installation list could not be read (null) → closed.
  const moduleEnabled = Array.isArray(ctx.enabledModuleIds) && ctx.enabledModuleIds.includes(ACCESS_MODULE_ID)
  const preliminary = evaluateAccess({ chain, visitor: null, moduleEnabled })
  if (!preliminary.allowed && preliminary.reason !== 'no_session') {
    return { kind: 'denied', reason: preliminary.reason, navigation, visitor: 'none' }
  }

  const projectId = deps.projectIdFor(ctx.projectSegment)
  if (!projectId) return { kind: 'denied', reason: 'unknown_project', navigation, visitor: 'none' }

  let token: string | null | undefined = null
  let visitor: VisitorGrants | null = null
  try {
    token = await deps.readToken(projectId)
    visitor = await deps.resolveVisitor(projectId, deps.environment(), token)
  } catch {
    visitor = null
  }
  const decision = evaluateAccess({ chain, visitor, moduleEnabled })
  if (decision.allowed) return { kind: 'granted', chain }
  return { kind: 'denied', reason: decision.reason, navigation, visitor: visitor ? 'other_groups' : token ? 'ended' : 'none' }
}
