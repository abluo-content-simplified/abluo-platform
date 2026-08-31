/**
 * Internal notification email — personalization config (ADR-019 Amendment A).
 *
 * Resolves the identity + copy for the internal "new submission" email, read at
 * SEND time from the Sanity project document (`notifications.internalEmail`).
 *
 * ── Grain: PROJECT, not tenant ───────────────────────────────────────────────
 * Amendment A's A2 rationale reads "kept at the tenant/project level (not on
 * the form) so a tenant's mail is consistent across all their forms". That
 * sentence settles the right question (config belongs above the form, so it
 * survives form clone/reuse) while conflating two grains in the answer. With
 * one tenant owning N websites they come apart, and the grain is PROJECT:
 *
 *   - the config is STORED per project (`project.notifications.internalEmail`),
 *     and the logo is read from that project's `siteConfig`;
 *   - `freeriders` owns `nologo` and `t42`, which are different brands. A
 *     `t42` enquiry arriving under the No!Logo sender name and logo is a
 *     visible cross-brand leak to the customer's own inbox, not a cosmetic
 *     slip.
 *
 * "Consistent across all their forms" therefore means across all forms OF A
 * PROJECT. Recipients (`./recipients`) may legitimately be either grain — a
 * tenant may well want one shared inbox — but that is expressed by configuring
 * the same address on each project, not by resolving at tenant grain.
 *
 * So this resolves the Sanity project by the SUBMISSION's Supabase project id
 * (`project.projectId`), never by translating a slug through a tenant-keyed
 * map. See `./recipients` for the full history of that defect.
 *
 * Pass 1: fromName (identity), subjectTemplate, localized intro,
 * replyToSubmitter. Pass 2 added logo + accent (from the Design System).
 * Pure helpers here are unit-tested without Sanity.
 */
import { sanityClient } from '@/lib/sanity/client'
import { NotificationScopeError, describeScope, type NotificationScope } from '@/lib/notifications/recipients'

/**
 * Identity + copy for the project linked to a Supabase project id.
 *
 * `logoUrl` still joins `siteConfig` on the Sanity project's OWN `projectSlug`
 * (`^.projectSlug`) — that is a Sanity-internal edge at project grain, which is
 * correct; only the ENTRY key changed from a translated slug to the project id.
 * Belongs in `@/lib/sanity/queries`; it is here only because that module is
 * owned by another workstream this change may not touch.
 */
const projectInternalEmailByIdQuery = /* groq */ `
  *[_type == "project" && projectId == $projectId][0]{
    "found": true,
    "internalEmail": notifications.internalEmail{
      fromName,
      subjectTemplate,
      replyToSubmitter,
      "intro": coalesce(intro[$locale], intro[$defaultLocale], intro.en)
    },
    "clientName": clientRef->displayName,
    "logoUrl": *[_type == "siteConfig" && projectSlug == ^.projectSlug][0].logo.asset->url
  }
`

/** Raw config as stored on the project doc (all fields optional). */
export interface InternalEmailConfig {
  fromName?: string
  subjectTemplate?: string
  /** Already locale-resolved by the query. */
  intro?: string
  replyToSubmitter?: boolean
}

/** Resolved config the consumer sends with. `replyToSubmitter` defaults to true. */
export interface ResolvedInternalEmail {
  fromName?: string
  subjectTemplate?: string
  intro?: string
  replyToSubmitter: boolean
  /** Tenant logo CDN URL (ADR-019 Amendment A, Pass 2) — https only, else undefined. */
  logoUrl?: string
}

/** Sender display name: explicit config → client display name → undefined (generic default). */
export function resolveFromName(
  configFromName: string | undefined,
  clientName: string | undefined,
): string | undefined {
  return (configFromName && configFromName.trim()) || (clientName && clientName.trim()) || undefined
}

/** Only accept an https CDN URL for the email logo (defensive — it goes into an <img src>). */
export function safeLogoUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined
  const u = url.trim()
  return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : undefined
}

/** A minimally-valid email for use as Reply-To (never trust arbitrary submission data into a header). */
export function safeReplyTo(email: unknown): string | undefined {
  if (typeof email !== 'string') return undefined
  const e = email.trim()
  // Simple, strict-enough check; also rejects header-injection characters.
  if (!/^[^\s@,<>"]+@[^\s@,<>"]+\.[^\s@,<>"]+$/.test(e)) return undefined
  return e
}

/**
 * Resolves the internal-email config for a project at a given locale.
 *
 * Failure split, deliberately asymmetric:
 *   - NO Sanity project linked to this id → THROWS `NotificationScopeError`.
 *     We do not know whose brand this mail carries, and guessing is the defect
 *     this change exists to remove. (In practice `resolveRecipients` throws on
 *     the same condition first; this is defence in depth for any other caller.)
 *   - a transient READ failure → hard-logged `console.error` + the generic
 *     default. The project is known and only its personalization is missing, so
 *     the mail goes out plain rather than not at all — unbranded is not
 *     mis-branded. It is logged at error level, never silently.
 */
export async function resolveInternalEmailConfig(
  scope: NotificationScope,
  locale: string,
): Promise<ResolvedInternalEmail> {
  const fallback: ResolvedInternalEmail = { replyToSubmitter: true }
  type InternalEmailRow = { found?: boolean; internalEmail?: InternalEmailConfig; clientName?: string; logoUrl?: string }
  let row: InternalEmailRow | null = null
  try {
    row = await sanityClient.fetch<InternalEmailRow | null>(projectInternalEmailByIdQuery, {
      projectId: scope.projectId,
      locale,
      defaultLocale: 'en',
    })
  } catch (err) {
    console.error(
      `[notifications] internalEmail config read failed for ${describeScope(scope)} — sending without personalization: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return fallback
  }
  if (!row?.found) {
    throw new NotificationScopeError(scope, 'no Sanity project is linked to this project id (branding unresolvable)')
  }
  const cfg = row.internalEmail ?? {}
  return {
    fromName: resolveFromName(cfg.fromName, row.clientName),
    subjectTemplate: cfg.subjectTemplate,
    intro: cfg.intro,
    replyToSubmitter: cfg.replyToSubmitter !== false, // default true
    logoUrl: safeLogoUrl(row.logoUrl),
  }
}
