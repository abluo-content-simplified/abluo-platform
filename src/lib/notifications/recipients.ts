/**
 * Recipient resolution — ADR-019. Studio-managed, read at send time.
 *
 * Recipients live on the Sanity project document (`notifications.recipients`),
 * edited by an admin in Project Settings → Notifications, filtered by topic +
 * enabled.
 *
 * ── Grain: PROJECT, resolved by project ID ───────────────────────────────────
 * Until 2026-08-31 this resolved the Sanity project by feeding the event's
 * Supabase PROJECT slug into `tryTenantToProjectSlug()` — a map keyed by TENANT
 * slug. That worked only because every tenant had exactly one project and
 * Supabase seeded `projects.slug` with the tenant slug, so the two namespaces
 * were identical strings. Once one tenant owns two projects the map is wrong in
 * two directions at once:
 *
 *   - a second project (`t42`) has no entry → `[]` recipients → the customer's
 *     notification was silently dropped, and the outbox row was finalized
 *     `skipped` (terminal), so nothing ever retried it; and
 *   - a project slug that collides with a DIFFERENT tenant's slug resolves
 *     successfully to the wrong project — mailing one customer's form
 *     submission to another customer's recipients. `nologo` is already both a
 *     Supabase project slug and a `TENANT_TO_PROJECT` key, so this was live.
 *
 * The fix removes the slug round-trip entirely: the Sanity `project` document
 * carries `projectId`, the Supabase `projects.id` it was linked to (written by
 * ProjectLinker, `Rule.required()`). A UUID is unambiguous across grains — it
 * cannot be a tenant slug by accident — so the lookup is now keyed on the
 * SUBMISSION's own project id. `ProjectSlug` is carried alongside for logs and
 * error messages only, branded so it can never drift back into a lookup key.
 *
 * ── Failure mode: loud, retryable ────────────────────────────────────────────
 * A scope that cannot be resolved THROWS (`NotificationScopeError`). It is not
 * an empty recipient list: "this project has no notification config" and "we do
 * not know which project this is" are different facts, and only the first is a
 * legitimate reason not to send. The consumer turns the throw into a retryable
 * `failed`/`dead` outbox row carrying the message, so a misconfiguration pages
 * someone instead of vanishing.
 *
 * Resolving at SEND time (not emit time) means recipient changes take effect
 * for events already sitting in the outbox.
 */
import { sanityClient } from '@/lib/sanity/client'
import type { SupabaseProjectSlug } from '@/lib/tenancy/ids'

/**
 * The project a notification is addressed to.
 *
 * `projectId` is the Supabase `projects.id` and the ONLY lookup key — see the
 * header. `projectSlug` is diagnostic: it makes log lines and outbox
 * `last_error` values readable, and is branded so the compiler refuses to let
 * it be used as a tenant-grain key again.
 *
 * (Shape lives here, the lower-level of the two notification config modules, so
 * `branding.ts` can import it without a cycle. If a third consumer appears it
 * should move to its own `notifications/scope.ts`.)
 */
export interface NotificationScope {
  projectId: string
  projectSlug: SupabaseProjectSlug | null
}

/** Human-readable identity of a scope, for logs and outbox `last_error`. */
export function describeScope(scope: NotificationScope): string {
  return scope.projectSlug ? `${scope.projectSlug} (${scope.projectId})` : scope.projectId
}

/**
 * A notification could not be addressed to a project with confidence.
 *
 * Thrown — never swallowed into an empty result — because the alternative is a
 * customer's form submission disappearing with no error anywhere, or being
 * delivered to somebody else.
 */
export class NotificationScopeError extends Error {
  readonly scope: NotificationScope
  constructor(scope: NotificationScope, detail: string) {
    super(`[notifications] ${detail} for project ${describeScope(scope)}`)
    this.name = 'NotificationScopeError'
    this.scope = scope
  }
}

/**
 * Recipients on the Sanity project linked to a Supabase project id.
 *
 * Keyed on `projectId`, not on any slug: see the header. Belongs in
 * `@/lib/sanity/queries` — it is here only because that module is owned by
 * another workstream this change may not touch.
 */
const projectNotificationsByIdQuery = /* groq */ `
  *[_type == "project" && projectId == $projectId][0]{
    "found": true,
    "recipients": notifications.recipients[]{ topic, emails, enabled }
  }
`

export interface RecipientGroup {
  /** Topic this group applies to; 'all' matches every topic. */
  topic?: string
  emails?: string[]
  enabled?: boolean
}

/**
 * Pure filter — testable without Sanity. Returns a deduped, lowercased email
 * list for `topic` across all enabled groups (a group with topic 'all' or no
 * topic matches every topic).
 */
export function filterRecipientGroups(groups: RecipientGroup[] | null | undefined, topic: string): string[] {
  const out = new Set<string>()
  for (const g of groups ?? []) {
    if (!g || g.enabled === false) continue
    if (g.topic && g.topic !== 'all' && g.topic !== topic) continue
    for (const raw of g.emails ?? []) {
      const e = (raw ?? '').trim().toLowerCase()
      if (e) out.add(e)
    }
  }
  return [...out]
}


/**
 * Resolves recipients for (project, topic) from Studio config.
 *
 * Returns `[]` ONLY for the legitimate case: the project resolved and has no
 * enabled group matching `topic`. Every other outcome — no Sanity project
 * linked to this id, or a failed read — throws, so the caller retries loudly
 * rather than dropping the mail.
 */
export async function resolveRecipients(scope: NotificationScope, topic: string): Promise<string[]> {
  let row: { found?: boolean; recipients?: RecipientGroup[] | null } | null = null
  try {
    row = await sanityClient.fetch<{ found?: boolean; recipients?: RecipientGroup[] | null } | null>(
      projectNotificationsByIdQuery,
      { projectId: scope.projectId },
    )
  } catch (error) {
    throw new NotificationScopeError(
      scope,
      `failed to read recipients: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!row?.found) {
    throw new NotificationScopeError(
      scope,
      'no Sanity project is linked to this project id (check the project document\'s projectId)',
    )
  }
  return filterRecipientGroups(row.recipients, topic)
}
