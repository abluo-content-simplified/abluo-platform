/**
 * Translate on People fields — the dashboard path of ADR-023 (§1, §6).
 *
 * Same engine as POST /api/translate (`runTranslate`): provider and monthly
 * quota come from the Translate module's config, API keys from the environment
 * only, every call is metered in `translation_usage`, and the provider is never
 * reached when the quota is spent or usage cannot be recorded. What differs is
 * who may call it:
 *
 *   1. `people.person.write` on the GRANT (People installed, role owner/editor).
 *   2. The Translate module is installed (enabled) for that project.
 *      The site is always the GRANT's projectSlug, never the caller's.
 *
 * The SOURCE TEXT is read from the saved person, never taken from the browser,
 * so a caller cannot use the endpoint to translate arbitrary text with the
 * account's provider credit. The browser flushes its autosave first.
 *
 * One click never overwrites `original` or `reviewed` text: a target is
 * translated only when it is empty or an untouched `machine` value
 * (`isWritableTarget`). Nothing is written here; the editor shows the result
 * and saves it through `savePersonDraft` together with its `translationStatus`
 * (paths `<field>.<loc>` + `translation.<field>.<loc>`), so the draft/rev
 * discipline stays in one place.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { PEOPLE_WRITE_PERMISSION, PersonError, isPersonId } from '@/lib/api/persons-lifecycle'
import { PERSON_LIMITS, PERSON_TRANSLATABLE_FIELDS, translationMetaOf, type PersonTranslatableField } from '@/lib/api/persons'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { loadTranslateConfig } from '@/lib/translate/config'
import { getTranslationProvider } from '@/lib/translate/providers'
import { runTranslate, type TranslateDeps } from '@/lib/translate/service'
import { isWritableTarget, machineMeta, type TranslationMeta } from '@/lib/translate/status'
import { TranslateError, type TranslateUsageSummary } from '@/lib/translate/types'
import { currentEnvironment, getMonthToDateCharacters, projectIsMeterable, recordUsage } from '@/lib/translate/usage'
import { validateTranslateRequest } from '@/lib/translate/validate'

export const TRANSLATE_MODULE = 'translate'

export type PersonTranslateResult = {
  /** Per field, per target language: the text and the status to store beside it. */
  results: Partial<Record<PersonTranslatableField, Record<string, { text: string; meta: TranslationMeta }>>>
  /** Targets left alone: already written or reviewed by a person (or too long for the field). */
  skipped: Array<{ field: PersonTranslatableField; locale: string; reason: 'protected' | 'too_long' }>
  usage: TranslateUsageSummary | null
}

type Doc = Record<string, unknown> & { projectSlug?: string; _type?: string; archivedAt?: unknown; anonymisedAt?: unknown }
export type PersonTranslateDeps = {
  getDocument?: (id: string) => Promise<Doc | undefined>
  translate?: Partial<TranslateDeps>
  now?: () => Date
}

const FIELD_MAX: Record<PersonTranslatableField, number> = { honorific: PERSON_LIMITS.short, jobTitle: PERSON_LIMITS.short, shortBio: PERSON_LIMITS.shortBio }

export function defaultTranslateDeps(): TranslateDeps {
  return {
    loadConfig: loadTranslateConfig,
    getProvider: getTranslationProvider,
    getMonthToDate: (projectId) => getMonthToDateCharacters(projectId),
    projectIsMeterable,
    recordUsage,
    environment: currentEnvironment(),
    logError: (message, err) => console.error(message, err),
  }
}

export async function translatePersonFields(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; fields: PersonTranslatableField[]; sourceLocale: string },
  deps: PersonTranslateDeps = {}
): Promise<PersonTranslateResult> {
  assertModuleAction(ctx, projectId, PEOPLE_WRITE_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  if (!grant.enabledModuleIds.includes(TRANSLATE_MODULE)) throw new TranslateError('module_disabled', 'translate is not installed')
  if (!isPersonId(input?.id)) throw new PersonError('not_found', 'Unknown person.')
  const fields = [...new Set(input.fields ?? [])]
  if (!fields.length || !fields.every((f) => (PERSON_TRANSLATABLE_FIELDS as readonly string[]).includes(f))) throw new TranslateError('invalid_request', 'fields')

  const get = deps.getDocument ?? ((id: string) => sanityWriteClient.getDocument(id) as Promise<Doc | undefined>)
  const [draft, published] = await Promise.all([get(`drafts.${input.id}`), get(input.id)])
  for (const d of [draft, published]) if (d && (d._type !== 'person' || d.projectSlug !== grant.projectSlug)) throw new PersonError('not_found', 'Unknown person.')
  const doc = draft ?? published
  if (!doc) throw new PersonError('not_found', 'Unknown person.')
  if (published?.anonymisedAt || draft?.anonymisedAt) throw new PersonError('anonymised', 'This person was anonymised.')
  if ((published ?? draft)?.archivedAt) throw new PersonError('archived', 'Restore this person to edit them.')

  const config = await (deps.translate?.loadConfig ?? loadTranslateConfig)(grant.projectSlug)
  if (!config) throw new TranslateError('project_not_found', grant.projectSlug)
  if (!config.enabled) throw new TranslateError('module_disabled', grant.projectSlug)

  const out: PersonTranslateResult = { results: {}, skipped: [], usage: null }
  const now = deps.now?.() ?? new Date()
  const run = { ...defaultTranslateDeps(), ...deps.translate }
  let ranAny = false
  for (const field of fields) {
    const value = doc[field] as Record<string, unknown> | undefined
    const source = typeof value?.[input.sourceLocale] === 'string' ? (value[input.sourceLocale] as string).trim() : ''
    if (!source) continue
    const metas = translationMetaOf(value)
    const targets: string[] = []
    for (const loc of config.supportedLocales) {
      if (loc === input.sourceLocale) continue
      const current = typeof value?.[loc] === 'string' ? (value[loc] as string) : ''
      if (isWritableTarget(current, metas[loc])) targets.push(loc)
      else out.skipped.push({ field, locale: loc, reason: 'protected' })
    }
    if (!targets.length) continue
    const req = validateTranslateRequest({ projectSlug: grant.projectSlug, sourceLocale: input.sourceLocale, targetLocales: targets, texts: [source], format: 'text', documentId: input.id })
    const outcome = await runTranslate(req, ctx.userId, run)
    ranAny = true
    out.usage = outcome.usage
    for (const loc of req.targetLocales) {
      // Cleaned exactly like savePersonDraft's cleanText, so the stored hash matches the saved text.
      const raw = outcome.translations[loc]?.[0] ?? ''
      const text = field === 'shortBio' ? raw.replace(/\r\n/g, '\n').trim() : raw.trim().replace(/\s+/g, ' ')
      if (!text) continue
      if (text.length > FIELD_MAX[field]) {
        out.skipped.push({ field, locale: loc, reason: 'too_long' })
        continue
      }
      ;(out.results[field] ??= {})[loc] = { text, meta: machineMeta({ text, source, sourceLocale: input.sourceLocale, provider: outcome.provider, now }) }
    }
  }
  if (!ranAny && !out.skipped.length) throw new TranslateError('invalid_request', 'nothing to translate')
  return out
}
