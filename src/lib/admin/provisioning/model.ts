/**
 * New client / New project wizard — the pure half (no I/O; safe for client
 * components). The server half lives in `./runner.ts`, `./store.ts` and
 * `./options.ts`. See docs/engineering/new-project-wizard.md.
 */
import { LOCALE_CODES, type SupportedLocale } from '@/lib/i18n/locales'
import { isReservedSlug } from '@/lib/platform/reserved-slugs'

// ── Slugs ─────────────────────────────────────────────────────────────────────

export const SLUG_MIN = 2
export const SLUG_MAX = 40
export const NAME_MAX = 120

export type SlugError = 'required' | 'tooShort' | 'tooLong' | 'invalidChars' | 'mustStartWithLetter' | 'hyphenEdges' | 'doubleHyphen' | 'reserved'

/**
 * Format + reserved-word check for a project or client slug. Uniqueness
 * (Supabase AND Sanity) is a server check — `checkSlugAvailability()`.
 *
 * Rules: 2–40 characters, lowercase letters, digits and hyphens, starts with
 * a letter, no hyphen at either end, no "--", not a reserved platform word.
 * The value is checked as typed: an uppercase or padded slug is an error, not
 * silently fixed, so what the admin sees is what gets stored.
 */
export function validateSlug(slug: string): SlugError | null {
  if (!slug) return 'required'
  if (slug.length < SLUG_MIN) return 'tooShort'
  if (slug.length > SLUG_MAX) return 'tooLong'
  if (!/^[a-z0-9-]+$/.test(slug)) return 'invalidChars'
  if (!/^[a-z]/.test(slug)) return 'mustStartWithLetter'
  if (slug.endsWith('-')) return 'hyphenEdges'
  if (slug.includes('--')) return 'doubleHyphen'
  if (isReservedSlug(slug)) return 'reserved'
  return null
}

/** A slug suggestion from a name: "Studio Dentistico Müller" → "studio-dentistico-muller". */
export function slugFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
}

// ── Wizard input ──────────────────────────────────────────────────────────────

export type ClientChoice = { mode: 'existing'; tenantId: string } | { mode: 'new'; name: string; slug: string }

export type WizardInput = {
  client: ClientChoice
  project: { name: string; slug: string; defaultLocale: string; supportedLocales: string[] }
  /** A published `designSystem` document id — a template, or another project's active system. */
  designSystemId: string
  /** The client's first Owner. Required for a new client; optional for an existing one. */
  owner: { name: string; email: string } | null
}

export type ValidWizardInput = {
  client: ClientChoice
  project: { name: string; slug: string; defaultLocale: SupportedLocale; supportedLocales: SupportedLocale[] }
  designSystemId: string
  owner: { name: string; email: string } | null
}

export type WizardField =
  | 'client'
  | 'clientName'
  | 'clientSlug'
  | 'projectName'
  | 'projectSlug'
  | 'defaultLocale'
  | 'supportedLocales'
  | 'designSystem'
  | 'ownerName'
  | 'ownerEmail'

export type WizardFieldError = SlugError | 'invalid' | 'taken' | 'notFound'

export type WizardErrors = Partial<Record<WizardField, WizardFieldError>>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/** A published Sanity document id (never a draft). */
export const isPublishedDocId = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v) && !v.startsWith('drafts.')

const isLocale = (v: unknown): v is SupportedLocale => typeof v === 'string' && (LOCALE_CODES as readonly string[]).includes(v)

/** Trimmed, single-line display text. */
export function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim() : ''
}

/** Same plausibility rule as invitations (`normalizeEmail` in src/lib/invitations/service.ts). */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const email = v.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(email)) return null
  return email
}

/** Default language first, then the others in registry order, no duplicates. */
export function orderLocales(defaultLocale: SupportedLocale, supported: readonly string[]): SupportedLocale[] {
  const set = new Set(supported.filter(isLocale))
  set.add(defaultLocale)
  return [defaultLocale, ...LOCALE_CODES.filter((c) => c !== defaultLocale && set.has(c))]
}

/**
 * Validates everything that can be validated without I/O. The server runs the
 * same function first, then the availability checks.
 */
export function validateWizardInput(raw: unknown): { ok: true; value: ValidWizardInput } | { ok: false; errors: WizardErrors } {
  const errors: WizardErrors = {}
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const c = (r.client && typeof r.client === 'object' ? r.client : {}) as Record<string, unknown>
  const p = (r.project && typeof r.project === 'object' ? r.project : {}) as Record<string, unknown>

  let client: ClientChoice | null = null
  if (c.mode === 'existing') {
    if (isUuid(c.tenantId)) client = { mode: 'existing', tenantId: c.tenantId.toLowerCase() }
    else errors.client = 'required'
  } else if (c.mode === 'new') {
    const name = cleanName(c.name)
    const slug = typeof c.slug === 'string' ? c.slug : ''
    if (!name) errors.clientName = 'required'
    else if (name.length > NAME_MAX) errors.clientName = 'tooLong'
    const se = validateSlug(slug)
    if (se) errors.clientSlug = se
    client = { mode: 'new', name, slug }
  } else {
    errors.client = 'required'
  }

  const projectName = cleanName(p.name)
  if (!projectName) errors.projectName = 'required'
  else if (projectName.length > NAME_MAX) errors.projectName = 'tooLong'
  const projectSlug = typeof p.slug === 'string' ? p.slug : ''
  const pse = validateSlug(projectSlug)
  if (pse) errors.projectSlug = pse

  const defaultLocale = isLocale(p.defaultLocale) ? p.defaultLocale : null
  if (!defaultLocale) errors.defaultLocale = 'required'
  const supportedRaw = Array.isArray(p.supportedLocales) ? p.supportedLocales : []
  if (supportedRaw.some((l) => !isLocale(l))) errors.supportedLocales = 'invalid'

  const designSystemId = isPublishedDocId(r.designSystemId) ? r.designSystemId : ''
  if (!designSystemId) errors.designSystem = 'required'

  let owner: ValidWizardInput['owner'] = null
  const o = r.owner && typeof r.owner === 'object' ? (r.owner as Record<string, unknown>) : null
  const ownerGiven = !!o && (cleanName(o.name) !== '' || (typeof o.email === 'string' && o.email.trim() !== ''))
  if (ownerGiven) {
    const name = cleanName(o!.name)
    const email = cleanEmail(o!.email)
    if (!name) errors.ownerName = 'required'
    else if (name.length > NAME_MAX) errors.ownerName = 'tooLong'
    if (!email) errors.ownerEmail = typeof o!.email === 'string' && o!.email.trim() ? 'invalid' : 'required'
    if (name && email) owner = { name, email }
  } else if (client?.mode === 'new') {
    // A new client has nobody who can manage it until its first Owner accepts (ADR-028 §4).
    errors.ownerEmail = 'required'
    errors.ownerName = 'required'
  }

  if (Object.keys(errors).length || !client || !defaultLocale) return { ok: false, errors }
  return {
    ok: true,
    value: {
      client,
      project: { name: projectName, slug: projectSlug, defaultLocale, supportedLocales: orderLocales(defaultLocale, supportedRaw as string[]) },
      designSystemId,
      owner,
    },
  }
}

/** Which wizard step a field belongs to (the screen jumps back to the first step with an error). */
export const FIELD_STEP: Record<WizardField, WizardStepId> = {
  client: 'client',
  clientName: 'client',
  clientSlug: 'client',
  projectName: 'project',
  projectSlug: 'project',
  defaultLocale: 'project',
  supportedLocales: 'project',
  designSystem: 'design',
  ownerName: 'owner',
  ownerEmail: 'owner',
}

export const WIZARD_STEPS = ['client', 'project', 'design', 'owner', 'review'] as const
export type WizardStepId = (typeof WIZARD_STEPS)[number]

// ── Provisioning steps ────────────────────────────────────────────────────────

/** The ordered, idempotent provisioning steps. Order matters: a referent is always created before its referrer. */
export const PROVISION_STEPS = [
  'supabase.tenant',
  'supabase.project',
  'sanity.client',
  'sanity.designSystem',
  'sanity.project',
  'sanity.siteConfig',
  'sanity.homePage',
  'invite.owner',
] as const
export type ProvisionStepId = (typeof PROVISION_STEPS)[number]

export type StepState = {
  status: 'done' | 'failed' | 'skipped'
  at: string
  /** Short machine code on failure (`conflict`, `failed`, …). */
  error?: string
  /** Technical detail for the admin (never shown to clients). */
  message?: string
  /** Step output worth keeping, e.g. the invitation id. */
  result?: Record<string, unknown>
}

export type RunStatus = 'pending' | 'running' | 'failed' | 'completed'

export type ProvisioningRunView = {
  id: string
  status: RunStatus
  tenantMode: 'existing' | 'new'
  tenantSlug: string
  tenantName: string
  projectSlug: string
  projectName: string
  ownerEmail: string | null
  steps: Partial<Record<ProvisionStepId, StepState>>
  /** The steps this run has (invite.owner only when an Owner was given). */
  plannedSteps: ProvisionStepId[]
  lastError: string | null
  createdAt: string
  completedAt: string | null
}

/** The first planned step that is not done (or skipped) — where a retry resumes. */
export function nextStep(planned: readonly ProvisionStepId[], steps: Partial<Record<ProvisionStepId, StepState>>): ProvisionStepId | null {
  return planned.find((s) => steps[s]?.status !== 'done' && steps[s]?.status !== 'skipped') ?? null
}

/** The status a new project starts in: served on its preview URL only, never on a custom domain (host-scope.ts ladder). */
export const NEW_PROJECT_STATUS = 'preview' as const

// ── Deterministic ids ─────────────────────────────────────────────────────────

/**
 * Sanity document ids for a new project. Deterministic so every step can use
 * `createIfNotExists` and a retry never makes a second copy. Same scheme as
 * the No!Logo bootstrap (`client-freeriders`, `project-nologo`, `page-nologo-home`).
 */
export function sanityDocIds(projectSlug: string, tenantSlug: string) {
  return {
    client: `client-${tenantSlug}`,
    designSystem: `ds-${projectSlug}`,
    project: `project-${projectSlug}`,
    siteConfig: `siteconfig-${projectSlug}`,
    homePage: `page-${projectSlug}-home`,
  }
}

/**
 * The invitation link's origin: the client dashboard host, not the admin
 * host the wizard runs on (the Owner signs in to abluo.app). Other hosts
 * (dev, localhost) are kept so a test invitation lands where it was made;
 * `invitationOrigin()` still restricts the result to Abluo hosts.
 */
export function ownerInviteOrigin(origin: string | null): string | null {
  if (!origin) return null
  try {
    const u = new URL(origin)
    if (u.hostname === 'admin.abluo.app') return 'https://abluo.app'
    return u.origin
  } catch {
    return null
  }
}
