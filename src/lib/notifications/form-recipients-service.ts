/**
 * Form notifications on the client dashboard's Settings page (Tom, 2026-10-28)
 * — the server half. Server-only: it imports the token-carrying Sanity write
 * client and the service-role audit writer.
 *
 * Who receives a form's emails lives on the Sanity `project` document,
 * `notifications.recipients[]` (ADR-019), and sending reads it at send time by
 * `projectId` (`./recipients.ts`). This module lets the client change ONLY the
 * `emails` list of a group that already exists; topics, the on/off switch and
 * every other notification setting stay with Abluo in Studio.
 *
 * Every function, in this order:
 *   1. the caller's grant for THIS project must hold `site.details.read` /
 *      `site.details.write` — the Settings page's own permissions (ADR-028:
 *      Owner and Site admin write, Editor reads). A view-only support visit has
 *      write stripped upstream by the resolver;
 *   2. reads go through `tenantScopedSanityClient` (forces `$projectSlug`) and
 *      also match `projectId` — the exact document sending reads;
 *      `assertSingleSanityProject` runs before the mutation;
 *   3. the write is a key-level patch of one group's `emails`
 *      (`notifications.recipients[_key=="…"].emails`) with `ifRevisionID` on the
 *      published document and, when Studio holds a draft containing the same
 *      group, the same change on the draft — otherwise the next Studio Publish
 *      would bring the old list back. A revision mismatch is `conflict`.
 *
 * After a successful change: one row in the internal audit log (who, what,
 * when — `notifications.recipient.add|remove`), and for an added address a
 * short notice email to that address, sent from production only (like the
 * form emails themselves, ADR-019). Neither can fail the change.
 */
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError, tenantScopedSanityClient, type TenantScopedSanityClient } from '@/lib/api/tenant-scoped-sanity'
import { recordAdminAudit, type AdminAuditEntry } from '@/lib/admin/audit'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { getAppEnvironment, isProductionEnvironment, type AppEnvironment } from './environment'
import { sendEmail, type SendResult } from './resend'
import {
  addRecipient,
  isAllFormsTopic,
  removeRecipient,
  topicLabel,
  type FormForLabel,
  type RecipientChangeError,
} from './form-recipients'

export const FORM_NOTIFICATIONS_READ = 'site.details.read'
export const FORM_NOTIFICATIONS_WRITE = 'site.details.write'

export type FormNotificationsErrorCode = RecipientChangeError | 'not_editable' | 'conflict' | 'failed'

export class FormNotificationsError extends Error {
  constructor(readonly code: FormNotificationsErrorCode, message?: string) {
    super(message ?? code)
  }
}

export type RecipientGroupView = {
  /** The group's Sanity `_key`; null = cannot be addressed safely (read-only). */
  key: string | null
  topic: string
  /** The every-form group (topic "all" or blank). */
  allForms: boolean
  /** The form title(s) sending under this topic, or the topic made readable; null for the every-form group. */
  label: string | null
  emails: string[]
  /** Switched off by Abluo in Studio: nothing is sent for it. */
  paused: boolean
  /** This person may add / remove addresses here now. */
  editable: boolean
}

export type FormNotificationsView = {
  /** Opaque: the published project document's revision. Pass back unchanged. */
  rev: string
  groups: RecipientGroupView[]
  canWrite: boolean
}

/** What happened to the notice email after an address was added. */
export type NoticeOutcome = 'sent' | 'not_production' | 'failed' | 'none'

type Client = Pick<typeof sanityWriteClient, 'fetch' | 'transaction'>
export type FormNotificationsDeps = {
  client?: Client
  audit?: (entry: AdminAuditEntry) => Promise<void>
  send?: (params: Parameters<typeof sendEmail>[0]) => Promise<SendResult>
  environment?: () => AppEnvironment
}

type StoredGroup = { _key?: string | null; topic?: string | null; emails?: Array<string | null> | null; enabled?: boolean | null } | null
type ProjectDoc = { _id: string; _rev: string; projectName?: string | null; groups?: StoredGroup[] | null }
type SiteDoc = { siteName?: string | null; customDomain?: string | null; defaultLocale?: string | null } | null

// Published + draft of the ONE project document sending reads (projectId).
export const PROJECT_NOTIFICATIONS_QUERY = /* groq */ `*[_type == "project" && projectSlug == $projectSlug && projectId == $projectId]{ _id, _rev, projectName, "groups": notifications.recipients[]{ _key, topic, emails, enabled } }`
// Active forms of the client that owns this project (formDefinition is tenant-owned; same tenant lookup as lib/sanity/queries.ts PROJECT_TENANT_SLUG).
export const FORMS_QUERY = /* groq */ `*[_type == "formDefinition" && role == "active" && !(_id in path("drafts.**")) && tenantSlug == coalesce(*[_type == "project" && projectSlug == $projectSlug][0].tenantSlug, *[_type == "project" && projectSlug == $projectSlug][0].clientRef->tenantSlug)]{ formId, notificationTopic, title }`
export const SITE_QUERY = /* groq */ `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ siteName, defaultLocale, "customDomain": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].customDomain }`

const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/
const isDraft = (id: string) => id.startsWith('drafts.')

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  const grant = ctx.projects.find((p) => p.projectId === projectId)
  if (!grant || !grant.permissions.includes(permission)) throw new TenantAuthorizationError(`Missing ${permission} on project.`)
  return grant
}

function scopedClient(ctx: TenantAuthorizationContext, projectId: string, client: Client): TenantScopedSanityClient {
  return tenantScopedSanityClient(ctx, projectId, {
    fetch: <T>(query: string, params?: Record<string, unknown>) => client.fetch(query, params ?? {}) as Promise<T>,
  })
}

async function readAll(scoped: TenantScopedSanityClient, projectId: string) {
  const [projects, forms, site] = await Promise.all([
    scoped.fetch<ProjectDoc[] | null>(PROJECT_NOTIFICATIONS_QUERY, { projectId }),
    scoped.fetch<FormForLabel[] | null>(FORMS_QUERY),
    scoped.fetch<SiteDoc>(SITE_QUERY),
  ])
  const all = projects ?? []
  return {
    published: all.find((d) => !isDraft(d._id)) ?? null,
    draft: all.find((d) => isDraft(d._id)) ?? null,
    forms: forms ?? [],
    site: site ?? null,
  }
}

const emailsOf = (g: StoredGroup): string[] => (g?.emails ?? []).filter((e): e is string => typeof e === 'string' && e.trim() !== '')

function toView(doc: ProjectDoc, forms: readonly FormForLabel[], locales: string[], canWrite: boolean): FormNotificationsView {
  const groups = (doc.groups ?? []).filter(Boolean).map((g): RecipientGroupView => {
    const key = typeof g!._key === 'string' && KEY_RE.test(g!._key) ? g!._key : null
    const topic = (g!.topic ?? '').trim()
    const paused = g!.enabled === false
    return {
      key,
      topic,
      allForms: isAllFormsTopic(topic),
      label: topicLabel(topic, forms, locales),
      emails: emailsOf(g),
      paused,
      editable: canWrite && key !== null && !paused,
    }
  })
  return { rev: doc._rev, groups, canWrite }
}

/** The Settings block's data. `locale` = the dashboard language (form titles in it when they exist). */
export async function loadFormNotifications(
  ctx: TenantAuthorizationContext,
  projectId: string,
  opts: { locale: string },
  deps: FormNotificationsDeps = {},
): Promise<FormNotificationsView | null> {
  const grant = grantFor(ctx, projectId, FORM_NOTIFICATIONS_READ)
  const client = deps.client ?? sanityWriteClient
  const { published, forms, site } = await readAll(scopedClient(ctx, projectId, client), projectId)
  if (!published) return null
  return toView(published, forms, [opts.locale, site?.defaultLocale || 'en'], grant.permissions.includes(FORM_NOTIFICATIONS_WRITE))
}

function isConflict(error: unknown): boolean {
  const e = error as { statusCode?: number; response?: { statusCode?: number }; message?: string } | null
  return e?.statusCode === 409 || e?.response?.statusCode === 409 || /revision/i.test(String(e?.message ?? ''))
}

export type RecipientChangeInput = { rev: unknown; groupKey: unknown; email: unknown; op: 'add' | 'remove'; locale: string }

/**
 * Adds or removes one address on one existing group. Returns the fresh view
 * and, for an add, what happened to the notice email.
 */
export async function changeFormRecipient(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: RecipientChangeInput,
  deps: FormNotificationsDeps = {},
): Promise<{ view: FormNotificationsView; notice: NoticeOutcome }> {
  const grant = grantFor(ctx, projectId, FORM_NOTIFICATIONS_WRITE)
  const op = input?.op
  if (op !== 'add' && op !== 'remove') throw new FormNotificationsError('failed', 'Unknown change.')
  const rev = typeof input.rev === 'string' ? input.rev : ''
  const groupKey = typeof input.groupKey === 'string' && KEY_RE.test(input.groupKey) ? input.groupKey : null
  if (!rev || !groupKey) throw new FormNotificationsError('not_found')
  // The address is checked before any I/O.
  const pre = op === 'add' ? addRecipient([], input.email) : removeRecipient([String(input.email ?? '')], input.email)
  if (!pre.ok) throw new FormNotificationsError(pre.error)

  const client = deps.client ?? sanityWriteClient
  const scoped = scopedClient(ctx, projectId, client)
  await assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug)
  const { published, draft, forms, site } = await readAll(scoped, projectId)
  if (!published) throw new FormNotificationsError('not_found')
  if (published._rev !== rev) throw new FormNotificationsError('conflict', 'This was changed elsewhere.')
  const group = (published.groups ?? []).find((g) => g?._key === groupKey) ?? null
  if (!group) throw new FormNotificationsError('not_found')
  if (group.enabled === false) throw new FormNotificationsError('not_editable')

  const current = emailsOf(group)
  const change = op === 'add' ? addRecipient(current, input.email) : removeRecipient(current, input.email)
  if (!change.ok) throw new FormNotificationsError(change.error)

  const path = `notifications.recipients[_key=="${groupKey}"].emails`
  const tx = client.transaction()
  tx.patch(published._id, { ifRevisionID: published._rev, set: { [path]: change.emails } })
  const draftGroup = draft ? (draft.groups ?? []).find((g) => g?._key === groupKey) ?? null : null
  if (draft && draftGroup) {
    const d = emailsOf(draftGroup)
    const next = op === 'add' ? (d.some((e) => e.toLowerCase() === change.email) ? d : [...d, change.email]) : d.filter((e) => e.trim().toLowerCase() !== change.email)
    tx.patch(draft._id, { ifRevisionID: draft._rev, set: { [path]: next } })
  }
  try {
    await tx.commit()
  } catch (error) {
    throw new FormNotificationsError(isConflict(error) ? 'conflict' : 'failed', isConflict(error) ? 'This was changed elsewhere.' : 'Could not save.')
  }

  const topic = (group.topic ?? '').trim()
  await (deps.audit ?? recordAdminAudit)({
    actorId: ctx.userId,
    action: op === 'add' ? 'notifications.recipient.add' : 'notifications.recipient.remove',
    projectId,
    detail: { topic: topic || 'all', groupKey, email: change.email, count: change.emails.length, by: ctx.support ? 'support' : 'client' },
  })

  let notice: NoticeOutcome = 'none'
  if (op === 'add') {
    const siteLocale = site?.defaultLocale || 'en'
    notice = await sendRecipientNotice(
      {
        to: change.email,
        siteName: site?.siteName?.trim() || published.projectName?.trim() || site?.customDomain?.trim() || grant.projectSlug,
        formLabel: topicLabel(topic, forms, [siteLocale]),
        locale: siteLocale,
      },
      deps,
    )
  }

  const after = await readAll(scoped, projectId)
  if (!after.published) throw new FormNotificationsError('failed')
  return { view: toView(after.published, after.forms, [input.locale, after.site?.defaultLocale || 'en'], grant.permissions.includes(FORM_NOTIFICATIONS_WRITE)), notice }
}

// ── The notice email ─────────────────────────────────────────────────────────

const NOTICE_COPY: Record<string, { subject: (site: string) => string; form: (site: string, form: string) => string; all: (site: string) => string; why: string }> = {
  en: {
    subject: (site) => `You'll now receive messages from the ${site} website`,
    form: (site, form) => `You'll now receive messages from the ${site} website's “${form}” form.`,
    all: (site) => `You'll now receive messages from every form on the ${site} website.`,
    why: 'Someone who manages the website added this address. If you were not expecting this, please let them know.',
  },
  it: {
    subject: (site) => `Da ora questo indirizzo riceve i messaggi del sito ${site}`,
    form: (site, form) => `Da ora questo indirizzo riceve i messaggi inviati con il modulo “${form}” del sito ${site}.`,
    all: (site) => `Da ora questo indirizzo riceve i messaggi inviati con tutti i moduli del sito ${site}.`,
    why: 'L’indirizzo è stato aggiunto da chi gestisce il sito. Se non era previsto, avvisi chi gestisce il sito.',
  },
  de: {
    subject: (site) => `Du erhältst ab jetzt Nachrichten der Website ${site}`,
    form: (site, form) => `Du erhältst ab jetzt die Nachrichten aus dem Formular „${form}“ der Website ${site}.`,
    all: (site) => `Du erhältst ab jetzt die Nachrichten aus allen Formularen der Website ${site}.`,
    why: 'Diese Adresse wurde von jemandem hinzugefügt, der die Website verwaltet. Falls du das nicht erwartet hast, gib bitte Bescheid.',
  },
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Pure: subject, text and HTML of the notice. Exported for tests. */
export function recipientNoticeEmail(p: { siteName: string; formLabel: string | null; locale: string }) {
  const copy = NOTICE_COPY[p.locale] ?? NOTICE_COPY[p.locale.split('-')[0]] ?? NOTICE_COPY.en
  const line = p.formLabel ? copy.form(p.siteName, p.formLabel) : copy.all(p.siteName)
  return {
    subject: copy.subject(p.siteName),
    text: `${line}\n\n${copy.why}\n`,
    html: `<p>${escapeHtml(line)}</p><p style="color:#555">${escapeHtml(copy.why)}</p>`,
  }
}

/** Sends the notice from production only (ADR-019 gate); never throws. */
export async function sendRecipientNotice(
  p: { to: string; siteName: string; formLabel: string | null; locale: string },
  deps: Pick<FormNotificationsDeps, 'send' | 'environment'> = {},
): Promise<NoticeOutcome> {
  if (!isProductionEnvironment((deps.environment ?? getAppEnvironment)())) return 'not_production'
  try {
    const mail = recipientNoticeEmail(p)
    const r = await (deps.send ?? sendEmail)({ to: [p.to], subject: mail.subject, text: mail.text, html: mail.html, fromName: p.siteName })
    if (!r.ok) console.warn(`[notifications] recipient notice not sent: ${r.error ?? 'unknown error'}`)
    return r.ok ? 'sent' : 'failed'
  } catch (e) {
    console.warn(`[notifications] recipient notice not sent: ${e instanceof Error ? e.message : String(e)}`)
    return 'failed'
  }
}
