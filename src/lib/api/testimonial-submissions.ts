/**
 * Testimonials — submissions from the module-owned form (ADR-048 D4, phase 2).
 *
 * The Testimonial form is a normal Forms form (formId `testimonial`), so its
 * submissions live in `form_submissions` — but they are NOT contact requests:
 * the general inbox excludes them (client-dashboard.ts) and this file lists
 * them for the Testimonials area instead.
 *
 *   listTestimonialSubmissions       the inbox (testimonials.private.read —
 *                                    a submission holds name, email, phone)
 *   createTestimonialFromSubmission  copies a submission into a DRAFT
 *                                    testimonial + its private row, sets
 *                                    `permissionToPublish` ONLY when the
 *                                    visitor ticked the consent box, and marks
 *                                    the submission `processed`
 *   rejectTestimonialSubmission      marks it `archived` (the existing status)
 *
 * Nothing a visitor writes is ever published automatically: the draft still
 * goes through the editor and `publishTestimonialDraft`.
 *
 * Reads and status changes use the caller's own RLS-backed session
 * (projectDataClient), exactly like the contact-requests inbox.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { projectDataClient } from '@/lib/support/data-client'
import type { SubmissionsReader } from '@/lib/api/client-dashboard'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import {
  TESTIMONIAL_FORM_ID,
  TESTIMONIAL_FORM_KEYS,
  TESTIMONIAL_LIMITS,
  TESTIMONIAL_RATING,
} from '@/lib/modules/testimonials/model'
import {
  TESTIMONIAL_PRIVATE_READ_PERMISSION,
  TESTIMONIAL_WRITE_PERMISSION,
  TestimonialError,
} from '@/lib/api/testimonials-lifecycle'
import {
  createTestimonial,
  readTestimonialSite,
  type TestimonialDeps,
  type TestimonialInitial,
} from '@/lib/api/testimonials'
import { createSupabaseTestimonialPrivateStore, type TestimonialPrivateStore, type TestimonialPrivateWrite } from '@/lib/api/testimonials-private'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUMNS = 'id, form_id, submission_data, locale, status, created_at, gdpr_consent, gdpr_consent_at'

export type TestimonialSubmissionDeps = TestimonialDeps & {
  /** Supabase reader for form_submissions (tests inject a fake). */
  submissions?: SubmissionsReader
}

export interface TestimonialSubmission {
  id: string
  createdAt: string
  status: 'new' | 'processed' | 'archived'
  locale: string | null
  /** The name the visitor wants shown. */
  displayName: string
  /** Private: the visitor's full name. */
  fullName: string
  email: string
  phone: string
  text: string
  rating: number | null
  /** The visitor ticked the consent box. */
  consent: boolean
  consentAt: string | null
  /** The testimonial created from it, if any. `id` is the Sanity document id. */
  testimonial: { id: string; publicId: string } | null
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function ratingOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isInteger(n) && n >= TESTIMONIAL_RATING.min && n <= TESTIMONIAL_RATING.max ? n : null
}

/** Pure: one `form_submissions` row → what the inbox shows. Exported for tests. */
export function mapTestimonialSubmission(row: Record<string, unknown>): Omit<TestimonialSubmission, 'testimonial'> {
  const data = row.submission_data && typeof row.submission_data === 'object' && !Array.isArray(row.submission_data) ? (row.submission_data as Record<string, unknown>) : {}
  const K = TESTIMONIAL_FORM_KEYS
  const status = row.status === 'processed' || row.status === 'archived' ? row.status : 'new'
  return {
    id: String(row.id),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    status,
    locale: typeof row.locale === 'string' && row.locale ? row.locale : null,
    displayName: text(data[K.displayName], TESTIMONIAL_LIMITS.displayName),
    fullName: text(data[K.fullName], 200),
    email: text(data[K.email], 320),
    phone: text(data[K.phone], 60),
    text: text(data[K.text], TESTIMONIAL_LIMITS.body),
    rating: ratingOf(data[K.rating]),
    consent: row.gdpr_consent === true,
    consentAt: typeof row.gdpr_consent_at === 'string' && row.gdpr_consent_at ? row.gdpr_consent_at : null,
  }
}

/**
 * Pure: a submission → the DRAFT testimonial and its private row.
 *
 *   public   displayName (falls back to the full name), body in the visitor's
 *            language (`originalLocale` = that language), rating, source
 *            'website', givenOn = the submission date, and
 *            `permissionToPublish` = the visitor ticked the consent box
 *   private  fullName, email, phone, the submission id, and — only with
 *            consent — permissionGivenAt = when they ticked it
 *
 * `fallbackLocale` (the site's default) is used when the submission's own
 * language is not a platform language. Exported for tests.
 */
export function mapSubmissionToTestimonial(
  row: Record<string, unknown>,
  fallbackLocale: string,
  now: Date
): { initial: TestimonialInitial; private: TestimonialPrivateWrite; permissionToPublish: boolean } {
  const s = mapTestimonialSubmission(row)
  const locale = s.locale && (LOCALE_CODES as readonly string[]).includes(s.locale) ? s.locale : fallbackLocale
  const permissionToPublish = s.consent
  const initial: TestimonialInitial = {
    ...((s.displayName || s.fullName) && { displayName: s.displayName || s.fullName }),
    ...(s.text && { body: { [locale]: s.text } }),
    originalLocale: locale,
    ...(s.rating !== null && { rating: s.rating }),
    ...(s.createdAt && { givenOn: s.createdAt.slice(0, 10) }),
    source: 'website',
    permissionToPublish,
  }
  const priv: TestimonialPrivateWrite = {
    fullName: s.fullName || null,
    email: s.email || null,
    phone: s.phone || null,
    submissionId: s.id,
    permissionGivenAt: permissionToPublish ? (s.consentAt ?? now.toISOString()) : null,
  }
  return { initial, private: priv, permissionToPublish }
}

function gate(ctx: TenantAuthorizationContext, projectId: string) {
  assertModuleAction(ctx, projectId, TESTIMONIAL_PRIVATE_READ_PERMISSION)
  assertModuleAction(ctx, projectId, TESTIMONIAL_WRITE_PERMISSION)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

const storeOf = (deps: { privateStore?: TestimonialPrivateStore }) => deps.privateStore ?? createSupabaseTestimonialPrivateStore()

/**
 * The testimonial submissions of this project, newest first (complete, non-spam).
 * Needs testimonials.private.read. Each row says whether a testimonial was
 * already created from it.
 */
export async function listTestimonialSubmissions(
  ctx: TenantAuthorizationContext,
  projectId: string,
  params: { limit?: number } = {},
  deps: TestimonialSubmissionDeps = {}
): Promise<TestimonialSubmission[]> {
  assertModuleAction(ctx, projectId, TESTIMONIAL_PRIVATE_READ_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  const db: SubmissionsReader = deps.submissions ?? (await projectDataClient(ctx, projectId))
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 200), 1), 500)
  const { data, error } = await db
    .from('form_submissions')
    .select(COLUMNS)
    .eq('project_id', projectId)
    .eq('form_id', TESTIMONIAL_FORM_ID)
    .eq('completion_state', 'complete')
    .neq('status', 'spam')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new TestimonialError('failed', 'Could not read the submissions.')
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map(mapTestimonialSubmission)

  // Which of them already became a testimonial: publicId (Supabase) → document id (Sanity).
  const created = new Map<string, { id: string; publicId: string }>()
  const links = await storeOf(deps).bySubmissions(projectId, rows.map((r) => r.id))
  if (links.available && links.links.size) {
    const client = deps.client ?? sanityWriteClient
    const found = await client.fetch<Array<{ _id: string; publicId: string }> | null>(
      `*[_type == "testimonial" && projectSlug == $projectSlug && publicId in $publicIds && !(_id in path("versions.**"))]{ _id, publicId }`,
      { projectSlug: grant.projectSlug, publicIds: [...links.links.values()] },
      { perspective: 'raw' }
    )
    const byPublic = new Map<string, string>()
    for (const f of found ?? []) byPublic.set(f.publicId, f._id.replace(/^drafts\./, ''))
    for (const [submissionId, publicId] of links.links) {
      const id = byPublic.get(publicId)
      if (id) created.set(submissionId, { id, publicId })
    }
  }
  return rows.map((r) => ({ ...r, testimonial: created.get(r.id) ?? null }))
}

async function readOwnSubmission(db: SubmissionsReader, projectId: string, submissionId: string): Promise<Record<string, unknown>> {
  if (typeof submissionId !== 'string' || !UUID_RE.test(submissionId)) throw new TestimonialError('submission_not_found', 'Unknown submission.')
  const { data, error } = await db
    .from('form_submissions')
    .select(COLUMNS)
    .eq('project_id', projectId)
    .eq('id', submissionId)
    .eq('form_id', TESTIMONIAL_FORM_ID)
    .eq('completion_state', 'complete')
    .neq('status', 'spam')
    .maybeSingle()
  if (error) throw new TestimonialError('failed', 'Could not read the submission.')
  if (!data) throw new TestimonialError('submission_not_found', 'Unknown submission.')
  return data as Record<string, unknown>
}

async function setStatus(db: SubmissionsReader, projectId: string, submissionId: string, status: 'processed' | 'archived'): Promise<boolean> {
  const { error } = await db.from('form_submissions').update({ status }).eq('project_id', projectId).eq('id', submissionId).neq('status', 'spam')
  return !error
}

export interface CreatedFromSubmission {
  id: string
  publicId: string
  rev: string
  /** The visitor's consent box was ticked, so `permissionToPublish` is on. */
  permissionToPublish: boolean
  /** The submission was marked `processed` (false when that update failed — the draft exists anyway). */
  submissionMarked: boolean
}

/**
 * Creates a DRAFT testimonial from a testimonial submission and marks the
 * submission `processed`. Needs testimonials.write AND testimonials.private.read.
 *
 * Errors: `submission_not_found` (unknown, not this project's, not a testimonial
 * submission, spam); `conflict` (a testimonial was already created from it);
 * `private_unavailable` (migration 067 not applied — nothing is created).
 */
export async function createTestimonialFromSubmission(
  ctx: TenantAuthorizationContext,
  projectId: string,
  submissionId: string,
  deps: TestimonialSubmissionDeps = {}
): Promise<CreatedFromSubmission> {
  const grant = gate(ctx, projectId)
  const db: SubmissionsReader = deps.submissions ?? (await projectDataClient(ctx, projectId))
  const row = await readOwnSubmission(db, projectId, submissionId)

  const store = storeOf(deps)
  const existing = await store.bySubmissions(projectId, [submissionId])
  if (!existing.available) throw new TestimonialError('private_unavailable', 'Private details cannot be stored yet.')
  if (existing.links.has(submissionId)) throw new TestimonialError('conflict', 'A testimonial was already created from this submission.')

  const client = deps.client ?? sanityWriteClient
  const site = await readTestimonialSite(client, grant.projectSlug)
  const now = (deps.now ?? (() => new Date()))()
  const mapped = mapSubmissionToTestimonial(row, site.defaultLocale, now)
  const created = await createTestimonial(ctx, projectId, { ...mapped.initial, private: mapped.private }, { ...deps, privateStore: store })
  const submissionMarked = await setStatus(db, projectId, submissionId, 'processed')
  return { ...created, permissionToPublish: mapped.permissionToPublish, submissionMarked }
}

/** Declines a submission: marks it `archived` (the existing status). Needs testimonials.write AND testimonials.private.read. */
export async function rejectTestimonialSubmission(
  ctx: TenantAuthorizationContext,
  projectId: string,
  submissionId: string,
  deps: Pick<TestimonialSubmissionDeps, 'submissions'> = {}
): Promise<void> {
  gate(ctx, projectId)
  const db: SubmissionsReader = deps.submissions ?? (await projectDataClient(ctx, projectId))
  await readOwnSubmission(db, projectId, submissionId)
  if (!(await setStatus(db, projectId, submissionId, 'archived'))) throw new TestimonialError('failed', 'Could not update the submission.')
}

