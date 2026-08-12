/**
 * Internal notification email — personalization config (ADR-019 Amendment A).
 *
 * Resolves the tenant/project-level identity + copy for the internal "new
 * submission" email, read at SEND time from the Sanity project document
 * (`notifications.internalEmail`). Kept at the tenant/project level (not on the
 * form) so a tenant's mail is consistent across all their forms and safe under
 * form clone/reuse — see the amendment's A2 rationale.
 *
 * Pass 1 (this slice): fromName (identity), subjectTemplate, localized intro,
 * replyToSubmitter. Logo + accent (pulled from the Design System) are Pass 2.
 * Pure helpers here are unit-tested without Sanity.
 */
import { tryTenantToProjectSlug, sanityClient } from '@/lib/sanity/client'
import { projectInternalEmailQuery } from '@/lib/sanity/queries'

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
 * Resolves the internal-email config for a project at a given locale. Never
 * throws — on any miss returns a safe default (no personalization, reply-to on).
 */
export async function resolveInternalEmailConfig(
  projectSlug: string,
  locale: string,
): Promise<ResolvedInternalEmail> {
  const fallback: ResolvedInternalEmail = { replyToSubmitter: true }
  const sanitySlug = tryTenantToProjectSlug(projectSlug)
  if (!sanitySlug) return fallback
  try {
    const row = await sanityClient.fetch<{ internalEmail?: InternalEmailConfig; clientName?: string; logoUrl?: string } | null>(
      projectInternalEmailQuery,
      { projectSlug: sanitySlug, locale, defaultLocale: 'en' },
    )
    const cfg = row?.internalEmail ?? {}
    return {
      fromName: resolveFromName(cfg.fromName, row?.clientName),
      subjectTemplate: cfg.subjectTemplate,
      intro: cfg.intro,
      replyToSubmitter: cfg.replyToSubmitter !== false, // default true
      logoUrl: safeLogoUrl(row?.logoUrl),
    }
  } catch (err) {
    console.warn(
      `[notifications] internalEmail config read failed for "${sanitySlug}": ${err instanceof Error ? err.message : String(err)}`,
    )
    return fallback
  }
}
